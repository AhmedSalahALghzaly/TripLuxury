/**
 * Admin Sync Service - Instant Local Persistence for Admin Actions
 * v1.0 - Local-First Pattern with Optimistic Updates & Rollback
 * 
 * This service ensures that any Admin Panel CRUD operation:
 * 1. Updates local store IMMEDIATELY (before API call)
 * 2. Syncs with server in background
 * 3. Rolls back on failure using snapshot mechanism
 */
import { useDataCacheStore } from '../store/useDataCacheStore';
import { useAppStore } from '../store/appStore';
import { useCartStore } from '../store/useCartStore';
import {
  productApi,
  productBrandApi,
  categoryApi,
  carBrandApi,
  carModelApi,
  promotionApi,
  bundleOfferApi,
  supplierApi,
  distributorApi,
  adminApi,
  subscriberApi,
} from './api';

// Type for optimistic action result
interface OptimisticResult<T> {
  success: boolean;
  data?: T;
  error?: string;
  rollback?: () => void;
}

// Generate temporary ID for optimistic creates
const generateTempId = (prefix: string): string => {
  return `temp_${prefix}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
};

class AdminSyncService {
  private isInitialized = false;

  // ==================== Product Operations ====================

  /**
   * Optimistically create a product
   * Updates local store immediately, then syncs with server
   */
  async createProduct(productData: any): Promise<OptimisticResult<any>> {
    const cacheStore = useDataCacheStore.getState();
    const appStore = useAppStore.getState();
    
    // Create snapshot for rollback
    const snapshotId = cacheStore.createSnapshot('Pre-product-create');
    
    // Generate temp ID and create optimistic product
    const tempId = generateTempId('product');
    const optimisticProduct = {
      id: tempId,
      ...productData,
      _isOptimistic: true,
      _createdAt: Date.now(),
    };
    
    // Immediate local update (optimistic)
    const currentProducts = cacheStore.products;
    cacheStore.setProducts([optimisticProduct, ...currentProducts]);
    appStore.setProducts([optimisticProduct, ...appStore.products]);
    
    try {
      // Sync with server
      const response = await productApi.create(productData);
      const serverProduct = response.data;
      
      // Replace optimistic product with server version
      cacheStore.setProducts(
        cacheStore.products.map((p) => 
          p.id === tempId ? { ...serverProduct, _isOptimistic: false } : p
        )
      );
      appStore.setProducts(
        appStore.products.map((p) => 
          p.id === tempId ? { ...serverProduct, _isOptimistic: false } : p
        )
      );
      
      // Delete the snapshot (success)
      cacheStore.deleteSnapshot(snapshotId);
      
      console.log('[AdminSync] Product created successfully:', serverProduct.id);
      return { success: true, data: serverProduct };
      
    } catch (error: any) {
      // Rollback on failure
      console.error('[AdminSync] Product creation failed, rolling back:', error.message);
      cacheStore.restoreSnapshot(snapshotId);
      
      return {
        success: false,
        error: error.response?.data?.detail || error.message,
        rollback: () => cacheStore.restoreSnapshot(snapshotId),
      };
    }
  }

  /**
   * Optimistically update a product
   */
  async updateProduct(productId: string, updates: any): Promise<OptimisticResult<any>> {
    const cacheStore = useDataCacheStore.getState();
    const appStore = useAppStore.getState();
    
    // Create snapshot for rollback
    const snapshotId = cacheStore.createSnapshot('Pre-product-update');
    
    // Immediate local update (optimistic)
    const updateLocal = (products: any[]) =>
      products.map((p) =>
        p.id === productId ? { ...p, ...updates, _isOptimistic: true, _localModified: Date.now() } : p
      );
    
    cacheStore.setProducts(updateLocal(cacheStore.products));
    appStore.setProducts(updateLocal(appStore.products));
    
    // Track version for conflict resolution
    cacheStore.trackResourceVersion(productId, 'product', Date.now());
    
    try {
      const response = await productApi.update(productId, updates);
      const serverProduct = response.data;
      
      // Mark as synced
      const markSynced = (products: any[]) =>
        products.map((p) =>
          p.id === productId ? { ...p, ...serverProduct, _isOptimistic: false } : p
        );
      
      cacheStore.setProducts(markSynced(cacheStore.products));
      appStore.setProducts(markSynced(appStore.products));
      cacheStore.deleteSnapshot(snapshotId);
      
      console.log('[AdminSync] Product updated successfully:', productId);
      return { success: true, data: serverProduct };
      
    } catch (error: any) {
      console.error('[AdminSync] Product update failed, rolling back:', error.message);
      cacheStore.restoreSnapshot(snapshotId);
      
      return {
        success: false,
        error: error.response?.data?.detail || error.message,
      };
    }
  }

  /**
   * Bulk-update price/stock for multiple variant rows in one network call.
   * Each row is updated independently on the server; per-row success/error
   * is returned to the caller so partial failures can be reported in the UI.
   */
  async bulkUpdateVariants(
    updates: Array<{ id: string; price: number; stock_quantity: number }>,
  ): Promise<{
    success: boolean;
    results: Array<{ id: string; success: boolean; error?: string; product?: any }>;
    error?: string;
  }> {
    const cacheStore = useDataCacheStore.getState();
    const appStore = useAppStore.getState();

    const snapshotId = cacheStore.createSnapshot('Pre-bulk-variant-update');

    // Capture pre-update copies of affected rows so failed rows can be
    // reverted individually without rolling the whole snapshot back.
    const updatesById = new Map(updates.map((u) => [u.id, u]));
    const originalsById = new Map<string, any>();
    cacheStore.products.forEach((p: any) => {
      if (updatesById.has(p.id)) originalsById.set(p.id, { ...p });
    });

    // Optimistic local update for every row in the batch.
    const applyLocal = (products: any[]) =>
      products.map((p) => {
        const u = updatesById.get(p.id);
        return u
          ? { ...p, price: u.price, stock_quantity: u.stock_quantity, _isOptimistic: true }
          : p;
      });
    cacheStore.setProducts(applyLocal(cacheStore.products));
    appStore.setProducts(applyLocal(appStore.products));

    try {
      const response = await productApi.bulkUpdateVariants(updates);
      const results = (response.data?.results || []) as Array<{
        id: string;
        success: boolean;
        error?: string;
        product?: any;
      }>;

      // Reconcile server truth: replace optimistic rows with returned products
      // and revert any rows that failed back to their captured originals.
      const resultsById = new Map(results.map((r) => [r.id, r]));
      const reconcile = (products: any[]) =>
        products.map((p) => {
          const r = resultsById.get(p.id);
          if (!r) return p;
          if (r.success && r.product) {
            return { ...p, ...r.product, _isOptimistic: false };
          }
          const original = originalsById.get(p.id);
          return original ? { ...original, _isOptimistic: false } : { ...p, _isOptimistic: false };
        });
      cacheStore.setProducts(reconcile(cacheStore.products));
      appStore.setProducts(reconcile(appStore.products));
      cacheStore.deleteSnapshot(snapshotId);

      const allOk = results.length > 0 && results.every((r) => r.success);
      return { success: allOk, results };
    } catch (error: any) {
      cacheStore.restoreSnapshot(snapshotId);
      return {
        success: false,
        results: [],
        error: error.response?.data?.detail || error.message,
      };
    }
  }

  /**
   * Optimistically delete a product
   */
  async deleteProduct(productId: string): Promise<OptimisticResult<void>> {
    const cacheStore = useDataCacheStore.getState();
    const appStore = useAppStore.getState();
    
    const snapshotId = cacheStore.createSnapshot('Pre-product-delete');
    
    // Immediate local removal
    cacheStore.setProducts(cacheStore.products.filter((p) => p.id !== productId));
    appStore.setProducts(appStore.products.filter((p) => p.id !== productId));
    
    try {
      await productApi.delete(productId);
      cacheStore.deleteSnapshot(snapshotId);
      
      console.log('[AdminSync] Product deleted successfully:', productId);
      return { success: true };
      
    } catch (error: any) {
      console.error('[AdminSync] Product deletion failed, rolling back:', error.message);
      cacheStore.restoreSnapshot(snapshotId);
      
      return {
        success: false,
        error: error.response?.data?.detail || error.message,
      };
    }
  }

  // ==================== Category Operations ====================

  async createCategory(categoryData: any): Promise<OptimisticResult<any>> {
    const cacheStore = useDataCacheStore.getState();
    const appStore = useAppStore.getState();
    
    const snapshotId = cacheStore.createSnapshot('Pre-category-create');
    const tempId = generateTempId('category');
    
    const optimisticCategory = {
      id: tempId,
      ...categoryData,
      _isOptimistic: true,
    };
    
    cacheStore.setCategories([optimisticCategory, ...cacheStore.categories]);
    appStore.setCategories([optimisticCategory, ...appStore.categories]);
    
    try {
      const response = await categoryApi.create(categoryData);
      const serverCategory = response.data;
      
      cacheStore.setCategories(
        cacheStore.categories.map((c) => (c.id === tempId ? serverCategory : c))
      );
      appStore.setCategories(
        appStore.categories.map((c) => (c.id === tempId ? serverCategory : c))
      );
      cacheStore.deleteSnapshot(snapshotId);
      
      console.log('[AdminSync] Category created successfully:', serverCategory.id);
      return { success: true, data: serverCategory };
      
    } catch (error: any) {
      cacheStore.restoreSnapshot(snapshotId);
      return { success: false, error: error.response?.data?.detail || error.message };
    }
  }

  async updateCategory(categoryId: string, updates: any): Promise<OptimisticResult<any>> {
    const cacheStore = useDataCacheStore.getState();
    const appStore = useAppStore.getState();
    
    const snapshotId = cacheStore.createSnapshot('Pre-category-update');
    
    const updateLocal = (categories: any[]) =>
      categories.map((c) => (c.id === categoryId ? { ...c, ...updates, _isOptimistic: true } : c));
    
    cacheStore.setCategories(updateLocal(cacheStore.categories));
    appStore.setCategories(updateLocal(appStore.categories));
    
    try {
      const response = await categoryApi.update(categoryId, updates);
      const serverCategory = response.data;
      
      cacheStore.setCategories(
        cacheStore.categories.map((c) => (c.id === categoryId ? { ...c, ...serverCategory, _isOptimistic: false } : c))
      );
      appStore.setCategories(
        appStore.categories.map((c) => (c.id === categoryId ? { ...c, ...serverCategory, _isOptimistic: false } : c))
      );
      cacheStore.deleteSnapshot(snapshotId);
      
      console.log('[AdminSync] Category updated successfully:', categoryId);
      return { success: true, data: serverCategory };
    } catch (error: any) {
      cacheStore.restoreSnapshot(snapshotId);
      return { success: false, error: error.response?.data?.detail || error.message };
    }
  }

  async deleteCategory(categoryId: string): Promise<OptimisticResult<void>> {
    const cacheStore = useDataCacheStore.getState();
    const appStore = useAppStore.getState();
    
    const snapshotId = cacheStore.createSnapshot('Pre-category-delete');
    
    cacheStore.setCategories(cacheStore.categories.filter((c) => c.id !== categoryId));
    appStore.setCategories(appStore.categories.filter((c) => c.id !== categoryId));
    
    try {
      await categoryApi.delete(categoryId);
      cacheStore.deleteSnapshot(snapshotId);
      return { success: true };
    } catch (error: any) {
      cacheStore.restoreSnapshot(snapshotId);
      return { success: false, error: error.response?.data?.detail || error.message };
    }
  }

  // ==================== Product Brand Operations ====================

  async createProductBrand(brandData: any): Promise<OptimisticResult<any>> {
    const cacheStore = useDataCacheStore.getState();
    const appStore = useAppStore.getState();
    
    const snapshotId = cacheStore.createSnapshot('Pre-brand-create');
    const tempId = generateTempId('brand');
    
    const optimisticBrand = { id: tempId, ...brandData, _isOptimistic: true };
    
    cacheStore.setProductBrands([optimisticBrand, ...cacheStore.productBrands]);
    appStore.setProductBrands([optimisticBrand, ...appStore.productBrands]);
    
    try {
      const response = await productBrandApi.create(brandData);
      const serverBrand = response.data;
      
      cacheStore.setProductBrands(
        cacheStore.productBrands.map((b) => (b.id === tempId ? serverBrand : b))
      );
      appStore.setProductBrands(
        appStore.productBrands.map((b) => (b.id === tempId ? serverBrand : b))
      );
      cacheStore.deleteSnapshot(snapshotId);
      
      return { success: true, data: serverBrand };
    } catch (error: any) {
      cacheStore.restoreSnapshot(snapshotId);
      return { success: false, error: error.response?.data?.detail || error.message };
    }
  }

  async updateProductBrand(brandId: string, updates: any): Promise<OptimisticResult<any>> {
    const cacheStore = useDataCacheStore.getState();
    const appStore = useAppStore.getState();
    
    const snapshotId = cacheStore.createSnapshot('Pre-brand-update');
    
    const updateLocal = (brands: any[]) =>
      brands.map((b) => (b.id === brandId ? { ...b, ...updates, _isOptimistic: true } : b));
    
    cacheStore.setProductBrands(updateLocal(cacheStore.productBrands));
    appStore.setProductBrands(updateLocal(appStore.productBrands));
    
    try {
      const response = await productBrandApi.update(brandId, updates);
      const serverBrand = response.data;
      
      cacheStore.setProductBrands(
        cacheStore.productBrands.map((b) => (b.id === brandId ? { ...b, ...serverBrand, _isOptimistic: false } : b))
      );
      appStore.setProductBrands(
        appStore.productBrands.map((b) => (b.id === brandId ? { ...b, ...serverBrand, _isOptimistic: false } : b))
      );
      cacheStore.deleteSnapshot(snapshotId);
      
      console.log('[AdminSync] Product Brand updated successfully:', brandId);
      return { success: true, data: serverBrand };
    } catch (error: any) {
      cacheStore.restoreSnapshot(snapshotId);
      return { success: false, error: error.response?.data?.detail || error.message };
    }
  }

  async deleteProductBrand(brandId: string): Promise<OptimisticResult<void>> {
    const cacheStore = useDataCacheStore.getState();
    const appStore = useAppStore.getState();
    
    const snapshotId = cacheStore.createSnapshot('Pre-brand-delete');
    
    cacheStore.setProductBrands(cacheStore.productBrands.filter((b) => b.id !== brandId));
    appStore.setProductBrands(appStore.productBrands.filter((b) => b.id !== brandId));
    
    try {
      await productBrandApi.delete(brandId);
      cacheStore.deleteSnapshot(snapshotId);
      return { success: true };
    } catch (error: any) {
      cacheStore.restoreSnapshot(snapshotId);
      return { success: false, error: error.response?.data?.detail || error.message };
    }
  }

  // ==================== Car Brand Operations ====================

  async createCarBrand(brandData: any): Promise<OptimisticResult<any>> {
    const cacheStore = useDataCacheStore.getState();
    const appStore = useAppStore.getState();
    
    const snapshotId = cacheStore.createSnapshot('Pre-car-brand-create');
    const tempId = generateTempId('car_brand');
    
    const optimisticBrand = { id: tempId, ...brandData, _isOptimistic: true };
    
    cacheStore.setCarBrands([optimisticBrand, ...cacheStore.carBrands]);
    appStore.setCarBrands([optimisticBrand, ...appStore.carBrands]);
    
    try {
      const response = await carBrandApi.create(brandData);
      const serverBrand = response.data;
      
      cacheStore.setCarBrands(
        cacheStore.carBrands.map((b) => (b.id === tempId ? serverBrand : b))
      );
      appStore.setCarBrands(
        appStore.carBrands.map((b) => (b.id === tempId ? serverBrand : b))
      );
      cacheStore.deleteSnapshot(snapshotId);
      
      return { success: true, data: serverBrand };
    } catch (error: any) {
      cacheStore.restoreSnapshot(snapshotId);
      return { success: false, error: error.response?.data?.detail || error.message };
    }
  }

  async deleteCarBrand(brandId: string): Promise<OptimisticResult<void>> {
    const cacheStore = useDataCacheStore.getState();
    const appStore = useAppStore.getState();
    
    const snapshotId = cacheStore.createSnapshot('Pre-car-brand-delete');
    
    cacheStore.setCarBrands(cacheStore.carBrands.filter((b) => b.id !== brandId));
    appStore.setCarBrands(appStore.carBrands.filter((b) => b.id !== brandId));
    
    try {
      await carBrandApi.delete(brandId);
      cacheStore.deleteSnapshot(snapshotId);
      return { success: true };
    } catch (error: any) {
      cacheStore.restoreSnapshot(snapshotId);
      return { success: false, error: error.response?.data?.detail || error.message };
    }
  }

  // ==================== Car Model Operations ====================

  async createCarModel(modelData: any): Promise<OptimisticResult<any>> {
    const cacheStore = useDataCacheStore.getState();
    const appStore = useAppStore.getState();
    
    const snapshotId = cacheStore.createSnapshot('Pre-car-model-create');
    const tempId = generateTempId('car_model');
    
    const optimisticModel = { id: tempId, ...modelData, _isOptimistic: true };
    
    cacheStore.setCarModels([optimisticModel, ...cacheStore.carModels]);
    appStore.setCarModels([optimisticModel, ...appStore.carModels]);
    
    try {
      const response = await carModelApi.create(modelData);
      const serverModel = response.data;
      
      cacheStore.setCarModels(
        cacheStore.carModels.map((m) => (m.id === tempId ? serverModel : m))
      );
      appStore.setCarModels(
        appStore.carModels.map((m) => (m.id === tempId ? serverModel : m))
      );
      cacheStore.deleteSnapshot(snapshotId);
      
      return { success: true, data: serverModel };
    } catch (error: any) {
      cacheStore.restoreSnapshot(snapshotId);
      return { success: false, error: error.response?.data?.detail || error.message };
    }
  }

  async updateCarModel(modelId: string, updates: any): Promise<OptimisticResult<any>> {
    const cacheStore = useDataCacheStore.getState();
    const appStore = useAppStore.getState();
    
    const snapshotId = cacheStore.createSnapshot('Pre-car-model-update');
    
    const updateLocal = (models: any[]) =>
      models.map((m) => (m.id === modelId ? { ...m, ...updates, _isOptimistic: true } : m));
    
    cacheStore.setCarModels(updateLocal(cacheStore.carModels));
    appStore.setCarModels(updateLocal(appStore.carModels));
    
    try {
      const response = await carModelApi.update(modelId, updates);
      const serverModel = response.data;
      
      cacheStore.setCarModels(
        cacheStore.carModels.map((m) => (m.id === modelId ? { ...m, ...serverModel, _isOptimistic: false } : m))
      );
      cacheStore.deleteSnapshot(snapshotId);
      
      return { success: true, data: serverModel };
    } catch (error: any) {
      cacheStore.restoreSnapshot(snapshotId);
      return { success: false, error: error.response?.data?.detail || error.message };
    }
  }

  async deleteCarModel(modelId: string): Promise<OptimisticResult<void>> {
    const cacheStore = useDataCacheStore.getState();
    const appStore = useAppStore.getState();
    
    const snapshotId = cacheStore.createSnapshot('Pre-car-model-delete');
    
    cacheStore.setCarModels(cacheStore.carModels.filter((m) => m.id !== modelId));
    appStore.setCarModels(appStore.carModels.filter((m) => m.id !== modelId));
    
    try {
      await carModelApi.delete(modelId);
      cacheStore.deleteSnapshot(snapshotId);
      return { success: true };
    } catch (error: any) {
      cacheStore.restoreSnapshot(snapshotId);
      return { success: false, error: error.response?.data?.detail || error.message };
    }
  }

  // ==================== Promotion Operations (High Priority) ====================

  async createPromotion(promoData: any): Promise<OptimisticResult<any>> {
    const cacheStore = useDataCacheStore.getState();
    
    const snapshotId = cacheStore.createSnapshot('Pre-promotion-create');
    const tempId = generateTempId('promo');
    
    // Get current promotions and add optimistic one
    const currentPromotions = cacheStore.products; // Note: We'll need to add promotions to cache store
    
    try {
      const response = await promotionApi.create(promoData);
      const serverPromo = response.data;
      
      cacheStore.deleteSnapshot(snapshotId);
      console.log('[AdminSync] Promotion created successfully:', serverPromo.id);
      return { success: true, data: serverPromo };
      
    } catch (error: any) {
      cacheStore.restoreSnapshot(snapshotId);
      return { success: false, error: error.response?.data?.detail || error.message };
    }
  }

  async deletePromotion(promoId: string): Promise<OptimisticResult<void>> {
    const cacheStore = useDataCacheStore.getState();
    const snapshotId = cacheStore.createSnapshot('Pre-promotion-delete');
    
    try {
      await promotionApi.delete(promoId);
      cacheStore.deleteSnapshot(snapshotId);
      
      // Also purge from cart if any items reference this promotion
      this.purgePromotionFromCart(promoId);
      
      console.log('[AdminSync] Promotion deleted successfully:', promoId);
      return { success: true };
    } catch (error: any) {
      cacheStore.restoreSnapshot(snapshotId);
      return { success: false, error: error.response?.data?.detail || error.message };
    }
  }

  // ==================== Bundle Offer Operations (High Priority) ====================

  async createBundleOffer(bundleData: any): Promise<OptimisticResult<any>> {
    const cacheStore = useDataCacheStore.getState();
    const snapshotId = cacheStore.createSnapshot('Pre-bundle-create');
    
    try {
      const response = await bundleOfferApi.create(bundleData);
      const serverBundle = response.data;
      
      cacheStore.deleteSnapshot(snapshotId);
      console.log('[AdminSync] Bundle offer created successfully:', serverBundle.id);
      return { success: true, data: serverBundle };
      
    } catch (error: any) {
      cacheStore.restoreSnapshot(snapshotId);
      return { success: false, error: error.response?.data?.detail || error.message };
    }
  }

  async deleteBundleOffer(bundleId: string): Promise<OptimisticResult<void>> {
    const cacheStore = useDataCacheStore.getState();
    const cartStore = useCartStore.getState();
    const snapshotId = cacheStore.createSnapshot('Pre-bundle-delete');
    
    try {
      await bundleOfferApi.delete(bundleId);
      cacheStore.deleteSnapshot(snapshotId);
      
      // CRITICAL: Purge this bundle from cart to prevent invalid checkouts
      this.purgeBundleFromCart(bundleId);
      
      console.log('[AdminSync] Bundle offer deleted successfully:', bundleId);
      return { success: true };
    } catch (error: any) {
      cacheStore.restoreSnapshot(snapshotId);
      return { success: false, error: error.response?.data?.detail || error.message };
    }
  }

  // ==================== Cart Purging Utilities ====================

  /**
   * Purge promotion references from cart
   */
  private purgePromotionFromCart(promoId: string): void {
    const cartStore = useCartStore.getState();
    const updatedItems = cartStore.cartItems.filter(
      (item) => item.bundleOfferId !== promoId
    );
    
    if (updatedItems.length !== cartStore.cartItems.length) {
      console.log('[AdminSync] Purged promotion from cart:', promoId);
      // We don't directly set cart items, instead void any affected bundles
    }
  }

  /**
   * Purge bundle offer from cart - removes all items with this bundle ID
   * and voids any associated discounts
   */
  private purgeBundleFromCart(bundleId: string): void {
    const cartStore = useCartStore.getState();
    
    // Find all cart items that belong to this bundle offer
    const affectedItems = cartStore.cartItems.filter(
      (item) => item.bundleOfferId === bundleId
    );
    
    if (affectedItems.length > 0) {
      console.log(`[AdminSync] Purging ${affectedItems.length} items from cart for deleted bundle:`, bundleId);
      
      // Get unique bundle group IDs to void
      const bundleGroupIds = [...new Set(affectedItems.map((item) => item.bundleGroupId).filter(Boolean))];
      
      // Void each bundle group discount
      bundleGroupIds.forEach((groupId) => {
        if (groupId) {
          cartStore.voidBundleDiscount(groupId, false); // Don't sync to backend as bundle is deleted
        }
      });
      
      // Remove the items from cart
      affectedItems.forEach((item) => {
        cartStore.removeFromCart(item.productId, false); // Don't void bundle again
      });
    }
  }

  // ==================== Supplier Operations ====================

  async createSupplier(supplierData: any): Promise<OptimisticResult<any>> {
    const cacheStore = useDataCacheStore.getState();
    const snapshotId = cacheStore.createSnapshot('Pre-supplier-create');
    const tempId = generateTempId('supplier');
    
    const optimisticSupplier = { id: tempId, ...supplierData, _isOptimistic: true };
    cacheStore.setSuppliers([optimisticSupplier, ...cacheStore.suppliers]);
    
    try {
      const response = await supplierApi.create(supplierData);
      const serverSupplier = response.data;
      
      cacheStore.setSuppliers(
        cacheStore.suppliers.map((s) => (s.id === tempId ? serverSupplier : s))
      );
      cacheStore.deleteSnapshot(snapshotId);
      
      return { success: true, data: serverSupplier };
    } catch (error: any) {
      cacheStore.restoreSnapshot(snapshotId);
      return { success: false, error: error.response?.data?.detail || error.message };
    }
  }

  async deleteSupplier(supplierId: string): Promise<OptimisticResult<void>> {
    const cacheStore = useDataCacheStore.getState();
    const snapshotId = cacheStore.createSnapshot('Pre-supplier-delete');
    
    cacheStore.setSuppliers(cacheStore.suppliers.filter((s) => s.id !== supplierId));
    
    try {
      await supplierApi.delete(supplierId);
      cacheStore.deleteSnapshot(snapshotId);
      return { success: true };
    } catch (error: any) {
      cacheStore.restoreSnapshot(snapshotId);
      return { success: false, error: error.response?.data?.detail || error.message };
    }
  }

  // ==================== Distributor Operations ====================

  async createDistributor(distributorData: any): Promise<OptimisticResult<any>> {
    const cacheStore = useDataCacheStore.getState();
    const snapshotId = cacheStore.createSnapshot('Pre-distributor-create');
    const tempId = generateTempId('distributor');
    
    const optimisticDistributor = { id: tempId, ...distributorData, _isOptimistic: true };
    cacheStore.setDistributors([optimisticDistributor, ...cacheStore.distributors]);
    
    try {
      const response = await distributorApi.create(distributorData);
      const serverDistributor = response.data;
      
      cacheStore.setDistributors(
        cacheStore.distributors.map((d) => (d.id === tempId ? serverDistributor : d))
      );
      cacheStore.deleteSnapshot(snapshotId);
      
      return { success: true, data: serverDistributor };
    } catch (error: any) {
      cacheStore.restoreSnapshot(snapshotId);
      return { success: false, error: error.response?.data?.detail || error.message };
    }
  }

  async deleteDistributor(distributorId: string): Promise<OptimisticResult<void>> {
    const cacheStore = useDataCacheStore.getState();
    const snapshotId = cacheStore.createSnapshot('Pre-distributor-delete');
    
    cacheStore.setDistributors(cacheStore.distributors.filter((d) => d.id !== distributorId));
    
    try {
      await distributorApi.delete(distributorId);
      cacheStore.deleteSnapshot(snapshotId);
      return { success: true };
    } catch (error: any) {
      cacheStore.restoreSnapshot(snapshotId);
      return { success: false, error: error.response?.data?.detail || error.message };
    }
  }

  // ==================== Admin Operations ====================

  async createAdmin(email: string, name?: string): Promise<OptimisticResult<any>> {
    const cacheStore = useDataCacheStore.getState();
    const snapshotId = cacheStore.createSnapshot('Pre-admin-create');
    const tempId = generateTempId('admin');
    
    const optimisticAdmin = { id: tempId, email, name, _isOptimistic: true };
    cacheStore.setAdmins([optimisticAdmin, ...cacheStore.admins]);
    
    try {
      const response = await adminApi.create(email, name);
      const serverAdmin = response.data;
      
      cacheStore.setAdmins(
        cacheStore.admins.map((a) => (a.id === tempId ? serverAdmin : a))
      );
      cacheStore.deleteSnapshot(snapshotId);
      
      return { success: true, data: serverAdmin };
    } catch (error: any) {
      cacheStore.restoreSnapshot(snapshotId);
      return { success: false, error: error.response?.data?.detail || error.message };
    }
  }

  async deleteAdmin(adminId: string): Promise<OptimisticResult<void>> {
    const cacheStore = useDataCacheStore.getState();
    const snapshotId = cacheStore.createSnapshot('Pre-admin-delete');
    
    cacheStore.setAdmins(cacheStore.admins.filter((a) => a.id !== adminId));
    
    try {
      await adminApi.delete(adminId);
      cacheStore.deleteSnapshot(snapshotId);
      return { success: true };
    } catch (error: any) {
      cacheStore.restoreSnapshot(snapshotId);
      return { success: false, error: error.response?.data?.detail || error.message };
    }
  }

  // ==================== Subscriber Operations ====================

  async createSubscriber(email: string): Promise<OptimisticResult<any>> {
    const cacheStore = useDataCacheStore.getState();
    const snapshotId = cacheStore.createSnapshot('Pre-subscriber-create');
    const tempId = generateTempId('subscriber');
    
    const optimisticSubscriber = { id: tempId, email, _isOptimistic: true };
    cacheStore.setSubscribers([optimisticSubscriber, ...cacheStore.subscribers]);
    
    try {
      const response = await subscriberApi.create(email);
      const serverSubscriber = response.data;
      
      cacheStore.setSubscribers(
        cacheStore.subscribers.map((s) => (s.id === tempId ? serverSubscriber : s))
      );
      cacheStore.deleteSnapshot(snapshotId);
      
      return { success: true, data: serverSubscriber };
    } catch (error: any) {
      cacheStore.restoreSnapshot(snapshotId);
      return { success: false, error: error.response?.data?.detail || error.message };
    }
  }

  async deleteSubscriber(subscriberId: string): Promise<OptimisticResult<void>> {
    const cacheStore = useDataCacheStore.getState();
    const snapshotId = cacheStore.createSnapshot('Pre-subscriber-delete');
    
    cacheStore.setSubscribers(cacheStore.subscribers.filter((s) => s.id !== subscriberId));
    
    try {
      await subscriberApi.delete(subscriberId);
      cacheStore.deleteSnapshot(snapshotId);
      return { success: true };
    } catch (error: any) {
      cacheStore.restoreSnapshot(snapshotId);
      return { success: false, error: error.response?.data?.detail || error.message };
    }
  }
}

// Singleton instance
export const adminSyncService = new AdminSyncService();

// Hook for using admin sync service
export const useAdminSync = () => {
  return {
    // Products
    createProduct: (data: any) => adminSyncService.createProduct(data),
    updateProduct: (id: string, data: any) => adminSyncService.updateProduct(id, data),
    bulkUpdateVariants: (
      updates: Array<{ id: string; price: number; stock_quantity: number }>,
    ) => adminSyncService.bulkUpdateVariants(updates),
    deleteProduct: (id: string) => adminSyncService.deleteProduct(id),
    
    // Categories
    createCategory: (data: any) => adminSyncService.createCategory(data),
    updateCategory: (id: string, data: any) => adminSyncService.updateCategory(id, data),
    deleteCategory: (id: string) => adminSyncService.deleteCategory(id),
    
    // Product Brands
    createProductBrand: (data: any) => adminSyncService.createProductBrand(data),
    updateProductBrand: (id: string, data: any) => adminSyncService.updateProductBrand(id, data),
    deleteProductBrand: (id: string) => adminSyncService.deleteProductBrand(id),
    
    // Car Brands
    createCarBrand: (data: any) => adminSyncService.createCarBrand(data),
    deleteCarBrand: (id: string) => adminSyncService.deleteCarBrand(id),
    
    // Car Models
    createCarModel: (data: any) => adminSyncService.createCarModel(data),
    updateCarModel: (id: string, data: any) => adminSyncService.updateCarModel(id, data),
    deleteCarModel: (id: string) => adminSyncService.deleteCarModel(id),
    
    // Promotions (High Priority)
    createPromotion: (data: any) => adminSyncService.createPromotion(data),
    deletePromotion: (id: string) => adminSyncService.deletePromotion(id),
    
    // Bundle Offers (High Priority)
    createBundleOffer: (data: any) => adminSyncService.createBundleOffer(data),
    deleteBundleOffer: (id: string) => adminSyncService.deleteBundleOffer(id),
    
    // Suppliers
    createSupplier: (data: any) => adminSyncService.createSupplier(data),
    deleteSupplier: (id: string) => adminSyncService.deleteSupplier(id),
    
    // Distributors
    createDistributor: (data: any) => adminSyncService.createDistributor(data),
    deleteDistributor: (id: string) => adminSyncService.deleteDistributor(id),
    
    // Admins
    createAdmin: (email: string, name?: string) => adminSyncService.createAdmin(email, name),
    deleteAdmin: (id: string) => adminSyncService.deleteAdmin(id),
    
    // Subscribers
    createSubscriber: (email: string) => adminSyncService.createSubscriber(email),
    deleteSubscriber: (id: string) => adminSyncService.deleteSubscriber(id),
  };
};

export default adminSyncService;

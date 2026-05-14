import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, TextInput, ActivityIndicator, Image, Modal } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useTheme } from '../../src/hooks/useTheme';
import { useTranslation } from '../../src/hooks/useTranslation';
import { productsApi } from '../../src/services/api';
import { Header } from '../../src/components/Header';
import { AccessGuard as __AccessGuard__ } from '../../src/components/AccessGuard';
function PriceHideAdmin() {
  const { colors } = useTheme();
  const { language, isRTL } = useTranslation();
  const router = useRouter();

  const [products, setProducts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [priceInputs, setPriceInputs] = useState<{ [key: string]: string }>({});
  const [successId, setSuccessId] = useState<string | null>(null);

  // Modal states
  const [showActionMenu, setShowActionMenu] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState<any>(null);

  // Search state
  const [searchQuery, setSearchQuery] = useState('');

  // Filtered products based on search
  const filteredProducts = products.filter((product) => {
    if (!searchQuery.trim()) return true;
    const query = searchQuery.toLowerCase();
    const name = (product.name || '').toLowerCase();
    const nameAr = (product.name_ar || '').toLowerCase();
    const sku = (product.sku || '').toLowerCase();
    return name.includes(query) || nameAr.includes(query) || sku.includes(query);
  });

  useEffect(() => {
    fetchProducts();
  }, []);

  const fetchProducts = async () => {
    try {
      const response = await productsApi.getAllAdmin();
      const productsList = response.data?.products || [];
      setProducts(productsList);
      // Initialize price inputs
      const prices: { [key: string]: string } = {};
      productsList.forEach((p: any) => {
        prices[p.id] = p.price?.toString() || '0';
      });
      setPriceInputs(prices);
    } catch (error) {
      console.error('Error fetching products:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleUpdatePrice = async (productId: string) => {
    const newPrice = parseFloat(priceInputs[productId]);
    if (isNaN(newPrice) || newPrice < 0) {
      return;
    }

    setUpdatingId(productId);
    try {
      await productsApi.updatePrice(productId, newPrice);
      setProducts((prev) =>
        prev.map((p) => (p.id === productId ? { ...p, price: newPrice } : p))
      );
      setSuccessId(productId);
      setTimeout(() => setSuccessId(null), 1500);
    } catch (error) {
      console.error('Error updating price:', error);
    } finally {
      setUpdatingId(null);
    }
  };

  const handleToggleHidden = async (productId: string) => {
    const product = products.find((p) => p.id === productId);
    if (!product) return;

    setUpdatingId(productId);
    try {
      const newHiddenStatus = !product.hidden_status;
      await productsApi.updateHidden(productId, newHiddenStatus);
      setProducts((prev) =>
        prev.map((p) => (p.id === productId ? { ...p, hidden_status: newHiddenStatus } : p))
      );
    } catch (error) {
      console.error('Error toggling hidden status:', error);
    } finally {
      setUpdatingId(null);
      setShowActionMenu(false);
    }
  };

  const handleDelete = async () => {
    if (!selectedProduct) return;

    setUpdatingId(selectedProduct.id);
    try {
      await productsApi.delete(selectedProduct.id);
      setProducts((prev) => prev.filter((p) => p.id !== selectedProduct.id));
      setShowDeleteConfirm(false);
      setSelectedProduct(null);
    } catch (error) {
      console.error('Error deleting product:', error);
    } finally {
      setUpdatingId(null);
    }
  };

  const openActionMenu = (product: any) => {
    setSelectedProduct(product);
    setShowActionMenu(true);
  };

  const openDeleteConfirm = () => {
    setShowActionMenu(false);
    setShowDeleteConfirm(true);
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['bottom']}>
      <Header title={language === 'ar' ? 'السعر أو الإخفاء' : 'Price or Hide'} showBack showSearch={false} showCart={false} />

      <ScrollView style={styles.scrollView} contentContainerStyle={styles.contentContainer}>
        {/* Breadcrumb */}
        <View style={[styles.breadcrumb, isRTL && styles.breadcrumbRTL]}>
          <TouchableOpacity onPress={() => router.push('/admin')}>
            <Text style={[styles.breadcrumbText, { color: colors.primary }]}>
              {language === 'ar' ? 'لوحة التحكم' : 'Admin'}
            </Text>
          </TouchableOpacity>
          <Ionicons name={isRTL ? 'chevron-back' : 'chevron-forward'} size={16} color={colors.textSecondary} />
          <Text style={[styles.breadcrumbText, { color: colors.textSecondary }]}>
            {language === 'ar' ? 'السعر أو الإخفاء' : 'Price or Hide'}
          </Text>
        </View>

        {/* Info Card */}
        <View style={[styles.infoCard, { backgroundColor: colors.primary + '15', borderColor: colors.primary }]}>
          <Ionicons name="information-circle" size={20} color={colors.primary} />
          <Text style={[styles.infoText, { color: colors.primary }]}>
            {language === 'ar' 
              ? 'قم بتحديث أسعار المنتجات أو إخفائها من العرض للعملاء'
              : 'Update product prices or hide them from customer view'}
          </Text>
        </View>

        {/* Products List */}
        <View style={[styles.listCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.listTitle, { color: colors.text }]}>
            {language === 'ar' ? 'المنتجات' : 'Products'} ({filteredProducts.length})
          </Text>

          {/* Search Bar */}
          <View style={[styles.searchContainer, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Ionicons name="search" size={20} color={colors.textSecondary} />
            <TextInput
              style={[styles.searchInput, { color: colors.text }]}
              value={searchQuery}
              onChangeText={setSearchQuery}
              placeholder={language === 'ar' ? 'ابحث بالاسم أو رقم المنتج...' : 'Search by name or SKU...'}
              placeholderTextColor={colors.textSecondary}
            />
            {searchQuery.length > 0 && (
              <TouchableOpacity onPress={() => setSearchQuery('')}>
                <Ionicons name="close-circle" size={20} color={colors.textSecondary} />
              </TouchableOpacity>
            )}
          </View>

          {loading ? (
            <ActivityIndicator size="large" color={colors.primary} style={styles.loader} />
          ) : products.length === 0 ? (
            <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
              {language === 'ar' ? 'لا توجد منتجات' : 'No products found'}
            </Text>
          ) : (
            filteredProducts.map((product) => (
              <View key={product.id} style={[styles.productItem, { borderColor: colors.border }]}>
                {/* Product Image with Hidden Overlay */}
                <View style={styles.imageContainer}>
                  {product.image_url ? (
                    <Image source={{ uri: product.image_url }} style={styles.productImage} />
                  ) : (
                    <View style={[styles.productImagePlaceholder, { backgroundColor: colors.surface }]}>
                      <Ionicons name="cube" size={24} color={colors.textSecondary} />
                    </View>
                  )}
                  {product.hidden_status && (
                    <TouchableOpacity
                      style={styles.hiddenOverlay}
                      onPress={() => handleToggleHidden(product.id)}
                    >
                      <Ionicons name="eye-off" size={24} color="#FFF" />
                    </TouchableOpacity>
                  )}
                </View>

                {/* Product Info */}
                <View style={styles.productInfo}>
                  <Text style={[styles.productSku, { color: colors.textSecondary }]}>
                    SKU: {product.sku}
                  </Text>
                  <Text style={[styles.productName, { color: colors.text }]} numberOfLines={2}>
                    {language === 'ar' ? product.name_ar : product.name}
                  </Text>
                  
                  {/* Price Input */}
                  <View style={styles.priceRow}>
                    <TextInput
                      style={[
                        styles.priceInput,
                        { 
                          backgroundColor: colors.surface, 
                          borderColor: successId === product.id ? '#10b981' : colors.border,
                          color: colors.text 
                        }
                      ]}
                      value={priceInputs[product.id] || ''}
                      onChangeText={(text) => setPriceInputs({ ...priceInputs, [product.id]: text })}
                      keyboardType="decimal-pad"
                      placeholder="0.00"
                      placeholderTextColor={colors.textSecondary}
                    />
                    <Text style={[styles.currencyText, { color: colors.textSecondary }]}>ج.م</Text>
                  </View>
                </View>

                {/* Action Buttons */}
                <View style={styles.actionButtons}>
                  {/* Update Price Button - Green */}
                  <TouchableOpacity
                    style={[
                      styles.actionBtn,
                      { backgroundColor: successId === product.id ? '#10b981' : '#22c55e' }
                    ]}
                    onPress={() => handleUpdatePrice(product.id)}
                    disabled={updatingId === product.id}
                  >
                    {updatingId === product.id ? (
                      <ActivityIndicator size="small" color="#FFF" />
                    ) : (
                      <Ionicons 
                        name={successId === product.id ? "checkmark-done" : "checkmark"} 
                        size={18} 
                        color="#FFF" 
                      />
                    )}
                  </TouchableOpacity>

                  {/* Delete/Hide Button - Red */}
                  <TouchableOpacity
                    style={[styles.actionBtn, { backgroundColor: '#ef4444' }]}
                    onPress={() => openActionMenu(product)}
                  >
                    <Ionicons name="trash" size={18} color="#FFF" />
                  </TouchableOpacity>
                </View>
              </View>
            ))
          )}
        </View>
      </ScrollView>

      {/* Action Menu Modal */}
      <Modal
        visible={showActionMenu}
        transparent
        animationType="fade"
        onRequestClose={() => setShowActionMenu(false)}
      >
        <TouchableOpacity
          style={styles.modalOverlay}
          activeOpacity={1}
          onPress={() => setShowActionMenu(false)}
        >
          <View style={[styles.actionMenuCard, { backgroundColor: colors.card }]}>
            {/* Delete Option - Red Section */}
            <TouchableOpacity
              style={[styles.actionMenuItem, { backgroundColor: '#ef4444' }]}
              onPress={openDeleteConfirm}
            >
              <Ionicons name="trash" size={22} color="#FFF" />
              <Text style={styles.actionMenuText}>
                {language === 'ar' ? 'حذف المنتج' : 'Delete Product'}
              </Text>
            </TouchableOpacity>

            {/* Hide Option - Light Sky Blue Section */}
            <TouchableOpacity
              style={[styles.actionMenuItem, { backgroundColor: '#87CEEB' }]}
              onPress={() => handleToggleHidden(selectedProduct?.id)}
            >
              <Ionicons 
                name={selectedProduct?.hidden_status ? "eye" : "eye-off"} 
                size={22} 
                color="#FFF" 
              />
              <Text style={styles.actionMenuText}>
                {selectedProduct?.hidden_status 
                  ? (language === 'ar' ? 'إظهار المنتج' : 'Show Product')
                  : (language === 'ar' ? 'إخفاء المنتج' : 'Hide Product')}
              </Text>
            </TouchableOpacity>

            {/* Cancel Button */}
            <TouchableOpacity
              style={[styles.cancelBtn, { backgroundColor: colors.surface }]}
              onPress={() => setShowActionMenu(false)}
            >
              <Text style={[styles.cancelBtnText, { color: colors.text }]}>
                {language === 'ar' ? 'إلغاء' : 'Cancel'}
              </Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* Delete Confirmation Modal */}
      <Modal
        visible={showDeleteConfirm}
        transparent
        animationType="fade"
        onRequestClose={() => setShowDeleteConfirm(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.confirmDialog, { backgroundColor: colors.card }]}>
            {/* Close Button */}
            <TouchableOpacity
              style={styles.closeBtn}
              onPress={() => setShowDeleteConfirm(false)}
            >
              <Ionicons name="close" size={20} color={colors.textSecondary} />
            </TouchableOpacity>

            {/* Delete Icon */}
            <View style={[styles.deleteIconContainer, { backgroundColor: '#ef4444' + '20' }]}>
              <Ionicons name="trash" size={32} color="#ef4444" />
            </View>

            {/* Confirmation Text */}
            <Text style={[styles.confirmTitle, { color: colors.text }]}>
              {language === 'ar' 
                ? 'هل أنت متأكد من حذف هذا المنتج؟'
                : 'Are you sure you want to delete this product?'}
            </Text>
            <Text style={[styles.confirmSubtitle, { color: colors.textSecondary }]}>
              {selectedProduct?.name}
            </Text>

            {/* Action Buttons */}
            <View style={styles.confirmActions}>
              <TouchableOpacity
                style={[styles.confirmBtn, { backgroundColor: colors.surface }]}
                onPress={() => setShowDeleteConfirm(false)}
              >
                <Text style={[styles.confirmBtnText, { color: colors.text }]}>
                  {language === 'ar' ? 'إلغاء' : 'Cancel'}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.confirmBtn, { backgroundColor: '#ef4444' }]}
                onPress={handleDelete}
                disabled={updatingId === selectedProduct?.id}
              >
                {updatingId === selectedProduct?.id ? (
                  <ActivityIndicator size="small" color="#FFF" />
                ) : (
                  <Text style={[styles.confirmBtnText, { color: '#FFF' }]}>
                    {language === 'ar' ? 'حذف' : 'Delete'}
                  </Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scrollView: { flex: 1 },
  contentContainer: { padding: 16 },
  breadcrumb: { flexDirection: 'row', alignItems: 'center', marginBottom: 16, gap: 8 },
  breadcrumbRTL: { flexDirection: 'row-reverse' },
  breadcrumbText: { fontSize: 14 },
  infoCard: { 
    flexDirection: 'row', 
    alignItems: 'center', 
    padding: 12, 
    borderRadius: 10, 
    borderWidth: 1,
    marginBottom: 16,
    gap: 10,
  },
  infoText: { flex: 1, fontSize: 13 },
  listCard: { borderRadius: 12, borderWidth: 1, padding: 16 },
  listTitle: { fontSize: 18, fontWeight: '700', marginBottom: 16 },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    marginBottom: 16,
    gap: 8,
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
    paddingVertical: 0,
  },
  loader: { padding: 40 },
  emptyText: { textAlign: 'center', padding: 20 },
  productItem: { 
    flexDirection: 'row', 
    alignItems: 'center', 
    paddingVertical: 14, 
    borderBottomWidth: 1,
    gap: 12,
  },
  imageContainer: { position: 'relative' },
  productImage: { width: 190, height: 130, borderRadius: 8 },
  productImagePlaceholder: { 
    width: 60, 
    height: 60, 
    borderRadius: 8, 
    alignItems: 'center', 
    justifyContent: 'center' 
  },
  hiddenOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.5)',
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  productInfo: { flex: 1 },
  productSku: { fontSize: 15, fontWeight: '600', marginBottom: 2 , textAlign: 'center'},
  productName: { fontSize: 17, fontWeight: '500', marginBottom: 6 , textAlign: 'center' , marginTop: 7.5, },
  priceRow: { flexDirection: 'row', alignItems: 'center', gap: 6 , justifyContent: 'center' , marginTop: 7.5,},
  priceInput: { 
    width: 99, 
    height: 39, 
    borderWidth: 1, 
    borderRadius: 6, 
    paddingHorizontal: 10,
    fontSize: 17,
    fontWeight: '600',
  },
  currencyText: { fontSize: 15, fontWeight: '500' },
  actionButtons: { flexDirection: 'column', gap: 8 },
  actionBtn: { 
    width: 36, 
    height: 36, 
    borderRadius: 18,
    marginTop: 7.5,
    alignItems: 'center', 
    justifyContent: 'center' 
  },
  // Modal Styles
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  actionMenuCard: {
    width: '100%',
    maxWidth: 320,
    borderRadius: 16,
    overflow: 'hidden',
  },
  actionMenuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    gap: 12,
  },
  actionMenuText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#FFF',
  },
  cancelBtn: {
    padding: 16,
    alignItems: 'center',
  },
  cancelBtnText: {
    fontSize: 16,
    fontWeight: '600',
  },
  confirmDialog: {
    width: '100%',
    maxWidth: 320,
    borderRadius: 20,
    padding: 24,
    alignItems: 'center',
  },
  closeBtn: {
    position: 'absolute',
    top: 12,
    right: 12,
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  deleteIconContainer: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  confirmTitle: {
    fontSize: 16,
    fontWeight: '600',
    textAlign: 'center',
    marginBottom: 8,
  },
  confirmSubtitle: {
    fontSize: 14,
    textAlign: 'center',
    marginBottom: 20,
  },
  confirmActions: {
    flexDirection: 'row',
    gap: 12,
    width: '100%',
  },
  confirmBtn: {
    flex: 1,
    padding: 14,
    borderRadius: 10,
    alignItems: 'center',
  },
  confirmBtnText: {
    fontSize: 15,
    fontWeight: '600',
  },
});


/* __ACCESS_GUARD_APPLIED__ */
export default function PriceHideAdminGuarded(props: any) {
  return (
    <__AccessGuard__ scope="admin">
      <PriceHideAdmin {...props} />
    </__AccessGuard__>
  );
}

/**
 * Marketing Suite - Admin Panel
 * Manages Promotions (Banners/Sliders) and Bundle Offers
 * REFACTORED: Uses React Query for data fetching and mutations
 */
import React, { useState, useCallback, useMemo, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Image,
  ActivityIndicator,
  Alert,
  Modal,
  Switch,
  RefreshControl,
  FlatList,
} from 'react-native';
import { FlashList } from '@shopify/flash-list';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import { Video, ResizeMode } from 'expo-av';
import * as FileSystem from 'expo-file-system/legacy';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useTheme } from '../../src/hooks/useTheme';
import { useTranslation } from '../../src/hooks/useTranslation';
import { Header } from '../../src/components/Header';
import { promotionApi, bundleOfferApi, api } from '../../src/services/api';
import { ImageUploader } from '../../src/components/ui/ImageUploader';
import { Toast } from '../../src/components/ui/FormFeedback';
import { DraggablePromotionList } from '../../src/components/ui/DraggablePromotionList';
import { useConfirmModal } from '../../src/components/ConfirmModal';
import {
  useMarketingQuery,
  usePromotionMutations,
  useBundleMutations,
} from '../../src/hooks/queries';

import { AccessGuard as __AccessGuard__ } from '../../src/components/AccessGuard';
interface Promotion {
  id: string;
  title: string;
  title_ar?: string;
  image?: string;
  promotion_type: 'slider' | 'banner';
  is_active: boolean;
  target_product_id?: string;
  target_restaurant_id?: string;
  target_product?: any;
  target_restaurant?: any;
  sort_order: number;
}

interface BundleOffer {
  id: string;
  name: string;
  name_ar?: string;
  description?: string;
  discount_percentage: number;
  target_restaurant_id?: string;
  target_restaurant?: any;
  product_ids: string[];
  products?: any[];
  image?: string;
  is_active: boolean;
  original_total?: number;
  discounted_total?: number;
}

type ActiveTab = 'promotions' | 'bundles' | 'hero' | 'footer';

function MarketingSuiteScreen() {
  const { colors } = useTheme();
  const { language, isRTL } = useTranslation();
  const router = useRouter();
  const { showConfirm, ConfirmModalNode } = useConfirmModal();

  // Use React Query for data fetching
  const {
    data: marketingData,
    isLoading: loading,
    isRefetching: refreshing,
    refetch,
  } = useMarketingQuery();

  // Extract data from query (hook already maps server wire names to restaurant-themed names)
  const allPromotions = useMemo(() => marketingData?.promotions || [], [marketingData]);
  const promotions = useMemo(() => (allPromotions as any[]).filter((p: any) => p.promotion_type !== 'hero'), [allPromotions]);
  const heroPromotions = useMemo(() => (allPromotions as any[]).filter((p: any) => p.promotion_type === 'hero').sort((a: any, b: any) => a.sort_order - b.sort_order), [allPromotions]);
  const bundleOffers = useMemo(() => marketingData?.bundles || [], [marketingData]);
  const products = useMemo(() => marketingData?.products || [], [marketingData]);
  const restaurants = useMemo(() => marketingData?.restaurants || [], [marketingData]);

  const queryClient = useQueryClient();

  // Hero content config from app_settings
  const { data: heroConfigRaw } = useQuery({
    queryKey: ['heroConfig'],
    queryFn: async () => {
      try {
        const res = await api.get('/admin/settings/hero_content');
        return res.data?.value as Record<string, string> | null;
      } catch { return null; }
    },
    staleTime: 5 * 60 * 1000,
    retry: false,
  });

  // Footer config from app_settings
  const { data: footerConfigRaw, refetch: refetchFooterConfig } = useQuery({
    queryKey: ['footerConfig'],
    queryFn: async () => {
      try {
        const res = await api.get('/admin/settings/footer_config');
        return res.data?.value as Record<string, any> | null;
      } catch { return null; }
    },
    staleTime: 5 * 60 * 1000,
    retry: false,
  });

  // Mutations
  const {
    createPromotion,
    updatePromotion,
    deletePromotion: deletePromotionMutation,
    reorderPromotions,
  } = usePromotionMutations();

  const {
    createBundle,
    updateBundle,
    deleteBundle: deleteBundleMutation,
  } = useBundleMutations();

  const [activeTab, setActiveTab] = useState<ActiveTab>('promotions');

  // Modal states
  const [showPromotionModal, setShowPromotionModal] = useState(false);
  const [showBundleModal, setShowBundleModal] = useState(false);
  const [editingPromotion, setEditingPromotion] = useState<Promotion | null>(null);
  const [editingBundle, setEditingBundle] = useState<BundleOffer | null>(null);

  // Form states for promotion
  const [promoTitle, setPromoTitle] = useState('');
  const [promoTitleAr, setPromoTitleAr] = useState('');
  const [promoImage, setPromoImage] = useState('');
  const [promoType, setPromoType] = useState<'slider' | 'banner'>('slider');
  const [promoIsActive, setPromoIsActive] = useState(true);
  const [promoTargetType, setPromoTargetType] = useState<'product' | 'restaurant'>('product');
  const [promoTargetProductId, setPromoTargetProductId] = useState('');
  const [promoTargetRestaurantId, setPromoTargetRestaurantId] = useState('');

  // Form states for bundle
  const [bundleName, setBundleName] = useState('');
  const [bundleNameAr, setBundleNameAr] = useState('');
  const [bundleDescription, setBundleDescription] = useState('');
  const [bundleDiscount, setBundleDiscount] = useState('');
  const [bundleImage, setBundleImage] = useState('');
  const [bundleIsActive, setBundleIsActive] = useState(true);
  const [bundleTargetRestaurantId, setBundleTargetRestaurantId] = useState('');
  const [bundleProductIds, setBundleProductIds] = useState<string[]>([]);

  // Selector states
  const [showProductSelector, setShowProductSelector] = useState(false);
  const [showRestaurantSelector, setShowRestaurantSelector] = useState(false);
  const [selectorMode, setSelectorMode] = useState<'promo' | 'bundle'>('promo');
  const [searchQuery, setSearchQuery] = useState('');

  const [savingPromotion, setSavingPromotion] = useState(false);
  const [savingBundle, setSavingBundle] = useState(false);
  const [savingHero, setSavingHero] = useState(false);

  // Toast state
  const [toastVisible, setToastVisible] = useState(false);
  const [toastMessage, setToastMessage] = useState('');
  const [toastType, setToastType] = useState<'success' | 'error' | 'warning' | 'info'>('success');

  const showToast = (message: string, type: 'success' | 'error' | 'warning' | 'info' = 'success') => {
    setToastMessage(message);
    setToastType(type);
    setToastVisible(true);
  };

  // Handle promotion reorder using React Query mutation
  const handlePromotionReorder = async (newOrder: Promotion[]) => {
    try {
      await reorderPromotions.mutateAsync(newOrder);
      showToast(language === 'ar' ? 'تم تحديث الترتيب بنجاح' : 'Order updated successfully', 'success');
    } catch (error) {
      console.error('Error updating promotion order:', error);
      showToast(language === 'ar' ? 'فشل في تحديث الترتيب' : 'Failed to update order', 'error');
    }
  };

  // Footer config state (synced from server on load)
  const defaultFooterConfig = {
    // Social links — ordered array managed by add/remove/reorder UI
    social_links: [] as Array<{ platform: string; url: string }>,
    // Contact info (three bilingual pairs)
    info_phone: '', info_email: '',
    info_address_en: '', info_address_ar: '',
    info_hours_en: '', info_hours_ar: '',
    info_custom_en: '', info_custom_ar: '', info_custom_icon: 'information-circle',
    // App identity (bilingual)
    app_name_en: 'Al-Ghazaly', app_name_ar: 'الغزالي',
    tagline_en: 'Fine Dining', tagline_ar: 'مطبخ أصيل',
    // Copyright (bilingual)
    copyright_en: '© 2026 Al-Ghazaly Dining. All rights reserved.',
    copyright_ar: '© 2026 الغزالي. جميع الحقوق محفوظة.',
    // Video
    video_url: '', show_video: false,
    // Visibility
    show_ratings_strip: true, show_social_strip: true, show_info_rows: true,
  };
  const [footerForm, setFooterForm] = useState<Record<string, any>>(defaultFooterConfig);
  const [footerSaving, setFooterSaving] = useState(false);
  const [showSocialPicker, setShowSocialPicker] = useState(false);
  const [videoUploading, setVideoUploading] = useState(false);

  // Platform registry for the social links manager
  const SOCIAL_PLATFORMS = [
    { platform: 'facebook', icon: 'logo-facebook', label: 'Facebook', color: '#1877F2' },
    { platform: 'instagram', icon: 'logo-instagram', label: 'Instagram', color: '#E1306C' },
    { platform: 'tiktok', icon: 'logo-tiktok', label: 'TikTok', color: '#555' },
    { platform: 'twitter', icon: 'logo-twitter', label: 'X / Twitter', color: '#1DA1F2' },
    { platform: 'youtube', icon: 'logo-youtube', label: 'YouTube', color: '#FF0000' },
    { platform: 'whatsapp', icon: 'logo-whatsapp', label: 'WhatsApp', color: '#25D366' },
    { platform: 'pinterest', icon: 'logo-pinterest', label: 'Pinterest', color: '#E60023' },
    { platform: 'telegram', icon: 'paper-plane', label: 'Telegram', color: '#0088CC' },
  ] as const;

  const getSocialMeta = (platform: string) =>
    SOCIAL_PLATFORMS.find((p) => p.platform === platform);

  const socialLinks: Array<{ platform: string; url: string }> =
    footerForm.social_links ?? [];

  const addSocialLink = (platform: string) => {
    if (socialLinks.find((l) => l.platform === platform)) return;
    setFooterForm((p) => ({ ...p, social_links: [...(p.social_links ?? []), { platform, url: '' }] }));
    setShowSocialPicker(false);
  };

  const removeSocialLink = (idx: number) => {
    setFooterForm((p) => ({
      ...p,
      social_links: (p.social_links ?? []).filter((_: any, i: number) => i !== idx),
    }));
  };

  const moveSocialLink = (idx: number, dir: -1 | 1) => {
    setFooterForm((p) => {
      const arr = [...(p.social_links ?? [])];
      const target = idx + dir;
      if (target < 0 || target >= arr.length) return p;
      [arr[idx], arr[target]] = [arr[target], arr[idx]];
      return { ...p, social_links: arr };
    });
  };

  const updateSocialUrl = (idx: number, url: string) => {
    setFooterForm((p) => {
      const arr = [...(p.social_links ?? [])];
      arr[idx] = { ...arr[idx], url };
      return { ...p, social_links: arr };
    });
  };

  const availablePlatforms = SOCIAL_PLATFORMS.filter(
    (p) => !socialLinks.find((l) => l.platform === p.platform),
  );

  // Sync footer config from server once loaded
  useEffect(() => {
    if (footerConfigRaw && typeof footerConfigRaw === 'object') {
      setFooterForm({ ...defaultFooterConfig, ...footerConfigRaw });
    }
  }, [footerConfigRaw]);

  const saveFooterConfig = async () => {
    setFooterSaving(true);
    try {
      await api.put('/admin/settings/footer_config', { value: footerForm });
      await refetchFooterConfig();
      showToast(language === 'ar' ? 'تم حفظ إعدادات الفوتر' : 'Footer settings saved', 'success');
    } catch (err: any) {
      showToast(language === 'ar' ? 'فشل الحفظ' : 'Save failed', 'error');
    } finally {
      setFooterSaving(false);
    }
  };

  // Footer video upload — cloned from admin/models pickVideoFile (the
  // bullet-proof presigned-URL → GCS-PUT → finalize flow). Replaces the
  // legacy base64 /upload path which silently failed on larger videos due
  // to Express body-size limits and base64 memory pressure.
  const pickAndUploadVideo = async () => {
    try {
      const r = await DocumentPicker.getDocumentAsync({
        type: ['video/mp4', 'video/quicktime', 'video/webm', 'video/*'],
        copyToCacheDirectory: true,
      });
      if (r.canceled || !r.assets?.[0]) return;
      const file = r.assets[0];

      setVideoUploading(true);
      try {
        // Step 1: get a presigned PUT URL from the server
        const urlRes = await api.post<{ uploadURL: string; downloadURL: string; objectPath: string }>(
          '/upload-url',
        );
        const { uploadURL, objectPath } = urlRes.data;

        // Step 2: stream the local file blob directly to GCS — no base64
        // and no Express body size limit
        const fileBlob = await fetch(file.uri).then((resp) => resp.blob());
        const putResp = await fetch(uploadURL, {
          method: 'PUT',
          headers: { 'Content-Type': file.mimeType || 'video/mp4' },
          body: fileBlob,
        });
        if (!putResp.ok) throw new Error(`PUT ${putResp.status}`);

        // Step 3: finalize — set ACL to public + return stable serving URL
        const finalRes = await api.post<{ servingUrl: string }>('/finalize-upload', {
          object_path: objectPath,
        });
        setFooterForm((p) => ({ ...p, video_url: finalRes.data.servingUrl }));
        showToast(
          language === 'ar' ? 'تم رفع الفيديو بنجاح' : 'Video uploaded successfully',
          'success',
        );
      } catch (err: any) {
        const msg =
          language === 'ar'
            ? `فشل رفع الفيديو${err?.message ? ` (${err.message})` : ''}`
            : `Video upload failed${err?.message ? ` (${err.message})` : ''}`;
        showToast(msg, 'error');
      } finally {
        setVideoUploading(false);
      }
    } catch {
      showToast(language === 'ar' ? 'فشل اختيار الفيديو' : 'Failed to select video', 'error');
    }
  };

  // Hero sub-tab
  const [heroSubTab, setHeroSubTab] = useState<'images' | 'content'>('images');

  // Hero form states
  const [showHeroModal, setShowHeroModal] = useState(false);
  const [editingHeroPromo, setEditingHeroPromo] = useState<Promotion | null>(null);
  const [heroImage, setHeroImage] = useState('');
  const [heroTitle, setHeroTitle] = useState('');
  const [heroTitleAr, setHeroTitleAr] = useState('');
  const [heroIsActive, setHeroIsActive] = useState(true);

  // Hero content config states
  const [cfgEyebrowAr, setCfgEyebrowAr] = useState('اليوم في الغزالي');
  const [cfgEyebrowEn, setCfgEyebrowEn] = useState('TONIGHT AT AL-GHAZALY');
  const [cfgHeadlineAr, setCfgHeadlineAr] = useState('مائدة مضاءة بالشموع');
  const [cfgHeadlineEn, setCfgHeadlineEn] = useState('A candle-lit table awaits');
  const [cfgSublineAr, setCfgSublineAr] = useState('وصفات الشيف لهذا المساء، من المطبخ إلى مائدتكم.');
  const [cfgSublineEn, setCfgSublineEn] = useState("Tonight's chef-curated tasting, from the kitchen to your table.");
  const [cfgCtaPrimaryAr, setCfgCtaPrimaryAr] = useState('احجز طاولة');
  const [cfgCtaPrimaryEn, setCfgCtaPrimaryEn] = useState('Reserve a Table');
  const [cfgCtaPrimaryIcon, setCfgCtaPrimaryIcon] = useState('restaurant');
  const [cfgCtaSecondaryAr, setCfgCtaSecondaryAr] = useState('اكتشف القائمة');
  const [cfgCtaSecondaryEn, setCfgCtaSecondaryEn] = useState('Explore the menu');
  const [showIconPicker, setShowIconPicker] = useState(false);
  const [savingConfig, setSavingConfig] = useState(false);

  const resetHeroForm = () => {
    setHeroImage('');
    setHeroTitle('');
    setHeroTitleAr('');
    setHeroIsActive(true);
    setEditingHeroPromo(null);
  };

  const openEditHero = (promo: Promotion) => {
    setEditingHeroPromo(promo);
    setHeroImage(promo.image || '');
    setHeroTitle(promo.title || '');
    setHeroTitleAr(promo.title_ar || '');
    setHeroIsActive(promo.is_active);
    setShowHeroModal(true);
  };

  const saveHero = async () => {
    if (!heroImage.trim()) {
      Alert.alert('خطأ', language === 'ar' ? 'يرجى إدخال رابط الصورة' : 'Image URL is required');
      return;
    }
    setSavingHero(true);
    try {
      const data = {
        title: heroTitle || 'Hero Backdrop',
        title_ar: heroTitleAr || null,
        image: heroImage,
        promotion_type: 'hero',
        is_active: heroIsActive,
        sort_order: editingHeroPromo?.sort_order ?? (heroPromotions as any[]).length,
      };
      if (editingHeroPromo) {
        await updatePromotion.mutateAsync({ id: editingHeroPromo.id, data });
      } else {
        await createPromotion.mutateAsync(data);
      }
      setShowHeroModal(false);
      resetHeroForm();
      showToast(language === 'ar' ? 'تم حفظ صورة الهيرو بنجاح' : 'Hero image saved', 'success');
    } catch (error) {
      Alert.alert('Error', language === 'ar' ? 'فشل في حفظ الصورة' : 'Failed to save hero image');
    } finally {
      setSavingHero(false);
    }
  };

  const deleteHero = (id: string) => {
    showConfirm({
      title: language === 'ar' ? 'حذف صورة الهيرو' : 'Delete Hero Image',
      message: language === 'ar' ? 'هل أنت متأكد من حذف هذه الصورة؟' : 'Are you sure you want to delete this hero image?',
      confirmText: language === 'ar' ? 'حذف' : 'Delete',
      cancelText: language === 'ar' ? 'إلغاء' : 'Cancel',
      onConfirm: async () => {
        try {
          await deletePromotionMutation.mutateAsync(id);
          showToast(language === 'ar' ? 'تم حذف الصورة' : 'Hero image deleted', 'success');
        } catch {
          showToast(language === 'ar' ? 'فشل في الحذف' : 'Delete failed', 'error');
        }
      },
    });
  };

  // Load hero config when fetched
  useEffect(() => {
    if (!heroConfigRaw) return;
    const c = heroConfigRaw as Record<string, string>;
    if (c.eyebrow_ar) setCfgEyebrowAr(c.eyebrow_ar);
    if (c.eyebrow_en) setCfgEyebrowEn(c.eyebrow_en);
    if (c.headline_ar) setCfgHeadlineAr(c.headline_ar);
    if (c.headline_en) setCfgHeadlineEn(c.headline_en);
    if (c.subline_ar) setCfgSublineAr(c.subline_ar);
    if (c.subline_en) setCfgSublineEn(c.subline_en);
    if (c.cta_primary_ar) setCfgCtaPrimaryAr(c.cta_primary_ar);
    if (c.cta_primary_en) setCfgCtaPrimaryEn(c.cta_primary_en);
    if (c.cta_primary_icon) setCfgCtaPrimaryIcon(c.cta_primary_icon);
    if (c.cta_secondary_ar) setCfgCtaSecondaryAr(c.cta_secondary_ar);
    if (c.cta_secondary_en) setCfgCtaSecondaryEn(c.cta_secondary_en);
  }, [heroConfigRaw]);

  const saveHeroConfig = async () => {
    setSavingConfig(true);
    try {
      const value = {
        eyebrow_ar: cfgEyebrowAr,
        eyebrow_en: cfgEyebrowEn,
        headline_ar: cfgHeadlineAr,
        headline_en: cfgHeadlineEn,
        subline_ar: cfgSublineAr,
        subline_en: cfgSublineEn,
        cta_primary_ar: cfgCtaPrimaryAr,
        cta_primary_en: cfgCtaPrimaryEn,
        cta_primary_icon: cfgCtaPrimaryIcon,
        cta_secondary_ar: cfgCtaSecondaryAr,
        cta_secondary_en: cfgCtaSecondaryEn,
      };
      await api.put('/admin/settings/hero_content', { value });
      queryClient.invalidateQueries({ queryKey: ['heroConfig'] });
      showToast(language === 'ar' ? 'تم حفظ إعدادات الهيرو بنجاح' : 'Hero content saved', 'success');
    } catch (err: any) {
      Alert.alert('Error', language === 'ar' ? 'فشل في الحفظ' : 'Failed to save');
    } finally {
      setSavingConfig(false);
    }
  };

  // Refresh data function
  const onRefresh = useCallback(() => {
    refetch();
  }, [refetch]);

  // Reset promotion form
  const resetPromotionForm = () => {
    setPromoTitle('');
    setPromoTitleAr('');
    setPromoImage('');
    setPromoType('slider');
    setPromoIsActive(true);
    setPromoTargetType('product');
    setPromoTargetProductId('');
    setPromoTargetRestaurantId('');
    setEditingPromotion(null);
  };

  // Reset bundle form
  const resetBundleForm = () => {
    setBundleName('');
    setBundleNameAr('');
    setBundleDescription('');
    setBundleDiscount('');
    setBundleImage('');
    setBundleIsActive(true);
    setBundleTargetRestaurantId('');
    setBundleProductIds([]);
    setEditingBundle(null);
  };

  // Open edit promotion
  const openEditPromotion = (promo: Promotion) => {
    setEditingPromotion(promo);
    setPromoTitle(promo.title);
    setPromoTitleAr(promo.title_ar || '');
    setPromoImage(promo.image || '');
    setPromoType(promo.promotion_type);
    setPromoIsActive(promo.is_active);
    if (promo.target_product_id) {
      setPromoTargetType('product');
      setPromoTargetProductId(promo.target_product_id);
    } else if (promo.target_restaurant_id) {
      setPromoTargetType('restaurant');
      setPromoTargetRestaurantId(promo.target_restaurant_id);
    }
    setShowPromotionModal(true);
  };

  // Open edit bundle
  const openEditBundle = (bundle: BundleOffer) => {
    setEditingBundle(bundle);
    setBundleName(bundle.name);
    setBundleNameAr(bundle.name_ar || '');
    setBundleDescription(bundle.description || '');
    setBundleDiscount(bundle.discount_percentage.toString());
    setBundleImage(bundle.image || '');
    setBundleIsActive(bundle.is_active);
    setBundleTargetRestaurantId(bundle.target_restaurant_id || '');
    setBundleProductIds(bundle.product_ids || []);
    setShowBundleModal(true);
  };

  // Save promotion
  const savePromotion = async () => {
    if (!promoTitle.trim()) {
      Alert.alert('Error', 'Title is required');
      return;
    }
    if (!promoTargetProductId && !promoTargetRestaurantId) {
      Alert.alert('Error', 'Please select a target (Product or Restaurant)');
      return;
    }

    setSavingPromotion(true);
    try {
      const data = {
        title: promoTitle,
        title_ar: promoTitleAr || null,
        image: promoImage || null,
        promotion_type: promoType,
        is_active: promoIsActive,
        target_product_id: promoTargetType === 'product' ? promoTargetProductId : null,
        target_restaurant_id: promoTargetType === 'restaurant' ? promoTargetRestaurantId : null,
        sort_order: editingPromotion?.sort_order || promotions.length,
      };

      if (editingPromotion) {
        await updatePromotion.mutateAsync({ id: editingPromotion.id, data });
      } else {
        await createPromotion.mutateAsync(data);
      }

      setShowPromotionModal(false);
      resetPromotionForm();
      showToast(language === 'ar' ? 'تم الحفظ بنجاح' : 'Saved successfully', 'success');
    } catch (error) {
      console.error('Error saving promotion:', error);
      Alert.alert('Error', 'Failed to save promotion');
    } finally {
      setSavingPromotion(false);
    }
  };

  // Save bundle
  const saveBundle = async () => {
    if (!bundleName.trim()) {
      Alert.alert('Error', 'Name is required');
      return;
    }
    if (!bundleDiscount || parseFloat(bundleDiscount) <= 0) {
      Alert.alert('Error', 'Valid discount percentage is required');
      return;
    }
    if (bundleProductIds.length === 0) {
      Alert.alert('Error', 'Please select at least one product');
      return;
    }

    setSavingBundle(true);
    try {
      const data = {
        name: bundleName,
        name_ar: bundleNameAr || null,
        description: bundleDescription || null,
        discount_percentage: parseFloat(bundleDiscount),
        target_restaurant_id: bundleTargetRestaurantId || null,
        product_ids: bundleProductIds,
        image: bundleImage || null,
        is_active: bundleIsActive,
      };

      if (editingBundle) {
        await updateBundle.mutateAsync({ id: editingBundle.id, data });
      } else {
        await createBundle.mutateAsync(data);
      }

      setShowBundleModal(false);
      resetBundleForm();
      showToast(language === 'ar' ? 'تم الحفظ بنجاح' : 'Saved successfully', 'success');
    } catch (error) {
      console.error('Error saving bundle:', error);
      Alert.alert('Error', 'Failed to save bundle offer');
    } finally {
      setSavingBundle(false);
    }
  };

  // Delete promotion
  const deletePromotion = (id: string) => {
    showConfirm({
      title: language === 'ar' ? 'تأكيد الحذف' : 'Confirm Delete',
      message: language === 'ar' ? 'هل أنت متأكد من حذف هذا العرض؟' : 'Are you sure you want to delete this promotion?',
      confirmText: language === 'ar' ? 'حذف' : 'Delete',
      cancelText: language === 'ar' ? 'إلغاء' : 'Cancel',
      onConfirm: async () => {
        try {
          await deletePromotionMutation.mutateAsync(id);
          showToast(language === 'ar' ? 'تم حذف العرض بنجاح' : 'Promotion deleted successfully', 'success');
        } catch (error: any) {
          console.error('Error deleting promotion:', error);
          showToast(language === 'ar' ? 'فشل في حذف العرض' : 'Failed to delete promotion', 'error');
        }
      },
    });
  };

  // Delete bundle
  const deleteBundle = (id: string) => {
    showConfirm({
      title: language === 'ar' ? 'تأكيد الحذف' : 'Confirm Delete',
      message: language === 'ar' ? 'هل أنت متأكد من حذف هذا العرض؟' : 'Are you sure you want to delete this bundle?',
      confirmText: language === 'ar' ? 'حذف' : 'Delete',
      cancelText: language === 'ar' ? 'إلغاء' : 'Cancel',
      onConfirm: async () => {
        try {
          await deleteBundleMutation.mutateAsync(id);
          showToast(language === 'ar' ? 'تم حذف الحزمة بنجاح' : 'Bundle deleted successfully', 'success');
        } catch (error: any) {
          console.error('Error deleting bundle:', error);
          showToast(language === 'ar' ? 'فشل في حذف الحزمة' : 'Failed to delete bundle', 'error');
        }
      },
    });
  };

  // Filter items by search - use useMemo for performance
  const filteredProducts = useMemo(() => {
    const q = searchQuery.toLowerCase();
    return (products as any[]).filter((p: any) =>
      p.name?.toLowerCase().includes(q) ||
      p.name_ar?.toLowerCase().includes(q) ||
      p.sku?.toLowerCase().includes(q)
    );
  }, [products, searchQuery]);

  const filteredRestaurants = useMemo(() => {
    const q = searchQuery.toLowerCase();
    return (restaurants as any[]).filter((m: any) => m.name?.toLowerCase().includes(q) || m.name_ar?.toLowerCase().includes(q));
  }, [restaurants, searchQuery]);

  // Get selected product/restaurant names
  const getSelectedProductName = (id: string) => {
    const product = (products as any[]).find((p: any) => p.id === id);
    return product ? (language === 'ar' ? product.name_ar : product.name) || product.name : '';
  };

  const getSelectedRestaurantName = (id: string) => {
    const model = (restaurants as any[]).find((m: any) => m.id === id);
    return model ? (language === 'ar' ? model.name_ar : model.name) || model.name : '';
  };

  if (loading) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['bottom']}>
        <Header title={language === 'ar' ? 'جناح التسويق' : 'Marketing Suite'} showBack />
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['bottom']}>
      <Header title={language === 'ar' ? 'جناح التسويق' : 'Marketing Suite'} showBack />

      {/* Tabs */}
      <View style={[styles.tabContainer, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <TouchableOpacity
          style={[styles.tab, activeTab === 'hero' && { backgroundColor: '#FFD700' }]}
          onPress={() => setActiveTab('hero')}
        >
          <Ionicons name="image" size={18} color={activeTab === 'hero' ? '#000' : colors.textSecondary} />
          <Text style={[styles.tabText, { color: activeTab === 'hero' ? '#000' : colors.textSecondary }]}>
            {language === 'ar' ? 'الهيرو' : 'Hero'}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tab, activeTab === 'promotions' && { backgroundColor: colors.primary }]}
          onPress={() => setActiveTab('promotions')}
        >
          <Ionicons
            name="megaphone"
            size={18}
            color={activeTab === 'promotions' ? '#FFF' : colors.textSecondary}
          />
          <Text style={[styles.tabText, { color: activeTab === 'promotions' ? '#FFF' : colors.textSecondary }]}>
            {language === 'ar' ? 'الترويج' : 'Promotions'}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tab, activeTab === 'bundles' && { backgroundColor: colors.primary }]}
          onPress={() => setActiveTab('bundles')}
        >
          <Ionicons
            name="gift"
            size={18}
            color={activeTab === 'bundles' ? '#FFF' : colors.textSecondary}
          />
          <Text style={[styles.tabText, { color: activeTab === 'bundles' ? '#FFF' : colors.textSecondary }]}>
            {language === 'ar' ? 'المجمعة' : 'Bundles'}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tab, activeTab === 'footer' && { backgroundColor: '#C8A24A' }]}
          onPress={() => setActiveTab('footer')}
        >
          <Ionicons
            name="layers"
            size={18}
            color={activeTab === 'footer' ? '#000' : colors.textSecondary}
          />
          <Text style={[styles.tabText, { color: activeTab === 'footer' ? '#000' : colors.textSecondary }]}>
            {language === 'ar' ? 'الفوتر' : 'Footer'}
          </Text>
        </TouchableOpacity>
      </View>

      <ScrollView
        style={styles.scrollView}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        {activeTab === 'hero' ? (
          <View style={styles.section}>

            {/* ── Hero Sub-Tab Switcher ── */}
            <View style={[styles.heroSubTabRow, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <TouchableOpacity
                style={[styles.heroSubTab, heroSubTab === 'images' && { backgroundColor: '#FFD700' }]}
                onPress={() => setHeroSubTab('images')}
              >
                <Ionicons name="images-outline" size={16} color={heroSubTab === 'images' ? '#000' : colors.textSecondary} />
                <Text style={[styles.heroSubTabText, { color: heroSubTab === 'images' ? '#000' : colors.textSecondary }]}>
                  {language === 'ar' ? 'صور الخلفية' : 'Backdrops'}
                </Text>
                {(heroPromotions as any[]).length > 0 && (
                  <View style={[styles.heroSubTabBadge, { backgroundColor: heroSubTab === 'images' ? '#00000030' : '#FFD70030' }]}>
                    <Text style={{ fontSize: 10, fontWeight: '800', color: heroSubTab === 'images' ? '#000' : '#FFD700' }}>
                      {(heroPromotions as any[]).length}
                    </Text>
                  </View>
                )}
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.heroSubTab, heroSubTab === 'content' && { backgroundColor: '#FFD700' }]}
                onPress={() => setHeroSubTab('content')}
              >
                <Ionicons name="create-outline" size={16} color={heroSubTab === 'content' ? '#000' : colors.textSecondary} />
                <Text style={[styles.heroSubTabText, { color: heroSubTab === 'content' ? '#000' : colors.textSecondary }]}>
                  {language === 'ar' ? 'النصوص والأزرار' : 'Texts & Buttons'}
                </Text>
              </TouchableOpacity>
            </View>

            {heroSubTab === 'images' ? (
              <>
                {/* Tip banner */}
                <View style={[styles.heroBanner, { backgroundColor: '#FFD70012', borderColor: '#FFD70035' }]}>
                  <Ionicons name="information-circle" size={17} color="#FFD700" />
                  <Text style={[styles.heroBannerText, { color: colors.textSecondary }]}>
                    {language === 'ar'
                      ? 'تُعرض هذه الصور كخلفية متحركة في الصفحة الرئيسية. الحجم الموصى به: 1400 × 1000 بكسل.'
                      : 'These images appear as the animated parallax backdrop on the home screen. Recommended: 1400×1000 px.'}
                  </Text>
                </View>

                {/* Add Button */}
                <TouchableOpacity
                  style={[styles.heroAddBtn, { backgroundColor: '#FFD700' }]}
                  onPress={() => { resetHeroForm(); setShowHeroModal(true); }}
                  activeOpacity={0.85}
                >
                  <View style={styles.heroAddBtnInner}>
                    <View style={styles.heroAddIcon}>
                      <Ionicons name="add" size={22} color="#000" />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.heroAddBtnTitle}>
                        {language === 'ar' ? 'إضافة صورة جديدة' : 'Add New Backdrop'}
                      </Text>
                      <Text style={styles.heroAddBtnSub}>
                        {language === 'ar' ? 'ارفع صورة عالية الدقة للخلفية' : 'Upload a high-res background image'}
                      </Text>
                    </View>
                    <Ionicons name="chevron-forward" size={18} color="#00000060" />
                  </View>
                </TouchableOpacity>

                {/* Hero Images Grid */}
                {(heroPromotions as any[]).length === 0 ? (
                  <View style={[styles.heroEmptyState, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                    <Ionicons name="image-outline" size={48} color={colors.textSecondary} />
                    <Text style={[styles.heroEmptyTitle, { color: colors.text }]}>
                      {language === 'ar' ? 'لا توجد صور هيرو بعد' : 'No backdrop images yet'}
                    </Text>
                    <Text style={[styles.heroEmptySub, { color: colors.textSecondary }]}>
                      {language === 'ar'
                        ? 'يتم استخدام الصور الافتراضية حالياً — أضف صورة للبدء'
                        : 'Default backdrops are in use — add an image to override'}
                    </Text>
                  </View>
                ) : (
                  (heroPromotions as any[]).map((hero: any, idx: number) => (
                    <View key={hero.id} style={[styles.heroImgCard, { backgroundColor: colors.card, borderColor: hero.is_active ? '#FFD70040' : colors.border }]}>
                      {/* Large Preview */}
                      <View style={styles.heroImgPreviewWrap}>
                        {hero.image ? (
                          <Image source={{ uri: hero.image }} style={styles.heroImgPreview} resizeMode="cover" />
                        ) : (
                          <View style={[styles.heroImgPreview, { backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' }]}>
                            <Ionicons name="image-outline" size={36} color={colors.textSecondary} />
                          </View>
                        )}
                        {/* Order Badge */}
                        <View style={styles.heroImgOrderBadge}>
                          <Text style={styles.heroImgOrderText}>#{idx + 1}</Text>
                        </View>
                        {/* Status overlay */}
                        {!hero.is_active && (
                          <View style={styles.heroImgInactiveBanner}>
                            <Text style={styles.heroImgInactiveText}>
                              {language === 'ar' ? 'معطّل' : 'Hidden'}
                            </Text>
                          </View>
                        )}
                      </View>

                      {/* Info & Actions Row */}
                      <View style={styles.heroImgMeta}>
                        <View style={{ flex: 1, gap: 3 }}>
                          <Text style={[styles.heroImgTitle, { color: colors.text }]} numberOfLines={1}>
                            {hero.title_ar || hero.title || (language === 'ar' ? 'بدون عنوان' : 'Untitled')}
                          </Text>
                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                            <View style={[styles.heroStatusDot, { backgroundColor: hero.is_active ? '#10B981' : '#94A3B8' }]} />
                            <Text style={[styles.heroImgStatus, { color: hero.is_active ? '#10B981' : colors.textSecondary }]}>
                              {hero.is_active
                                ? (language === 'ar' ? 'نشط — يظهر في الهيرو' : 'Active — shown in hero')
                                : (language === 'ar' ? 'معطّل — مخفي' : 'Inactive — hidden')}
                            </Text>
                          </View>
                        </View>
                        <View style={{ flexDirection: 'row', gap: 8 }}>
                          <TouchableOpacity
                            style={[styles.heroImgAction, { backgroundColor: '#FFD70018', borderColor: '#FFD70040' }]}
                            onPress={() => openEditHero(hero)}
                          >
                            <Ionicons name="pencil" size={16} color="#FFD700" />
                          </TouchableOpacity>
                          <TouchableOpacity
                            style={[styles.heroImgAction, { backgroundColor: '#EF444418', borderColor: '#EF444440' }]}
                            onPress={() => deleteHero(hero.id)}
                          >
                            <Ionicons name="trash" size={16} color="#EF4444" />
                          </TouchableOpacity>
                        </View>
                      </View>
                    </View>
                  ))
                )}
              </>
            ) : (
              <>
                {/* ── Live Preview Card ── */}
                <View style={[styles.heroPreviewCard, { backgroundColor: '#0D0D1A', borderColor: '#FFD70030' }]}>
                  <View style={styles.heroPreviewBadge}>
                    <Ionicons name="eye-outline" size={11} color="#FFD700" />
                    <Text style={styles.heroPreviewBadgeText}>{language === 'ar' ? 'معاينة مباشرة' : 'Live Preview'}</Text>
                  </View>
                  <Text style={styles.heroPreviewEyebrow}>
                    {(language === 'ar' ? cfgEyebrowAr : cfgEyebrowEn) || '—'}
                  </Text>
                  <Text style={styles.heroPreviewHeadline} numberOfLines={2}>
                    {(language === 'ar' ? cfgHeadlineAr : cfgHeadlineEn) || '—'}
                  </Text>
                  <Text style={styles.heroPreviewSubline} numberOfLines={2}>
                    {(language === 'ar' ? cfgSublineAr : cfgSublineEn) || '—'}
                  </Text>
                  <View style={styles.heroPreviewBtns}>
                    <View style={[styles.heroPreviewPrimaryBtn]}>
                      <Ionicons name={cfgCtaPrimaryIcon as any} size={12} color="#000" />
                      <Text style={styles.heroPreviewPrimaryText} numberOfLines={1}>
                        {(language === 'ar' ? cfgCtaPrimaryAr : cfgCtaPrimaryEn) || '—'}
                      </Text>
                    </View>
                    <View style={styles.heroPreviewSecondaryBtn}>
                      <Text style={styles.heroPreviewSecondaryText} numberOfLines={1}>
                        {(language === 'ar' ? cfgCtaSecondaryAr : cfgCtaSecondaryEn) || '—'}
                      </Text>
                    </View>
                  </View>
                </View>

                {/* ── Section: النص العلوي ── */}
                <View style={[styles.cfgSection, { backgroundColor: colors.card, borderColor: colors.border }]}>
                  <View style={styles.cfgSectionHeader}>
                    <View style={[styles.cfgSectionIcon, { backgroundColor: '#FFD70018' }]}>
                      <Ionicons name="text" size={14} color="#FFD700" />
                    </View>
                    <Text style={[styles.cfgSectionTitle, { color: colors.text }]}>
                      {language === 'ar' ? 'النص التعريفي العلوي' : 'Eyebrow Label'}
                    </Text>
                  </View>
                  <View style={styles.cfgLangRow}>
                    <View style={styles.cfgLangField}>
                      <Text style={[styles.cfgLangTag, { color: '#FFD700', backgroundColor: '#FFD70015' }]}>AR</Text>
                      <TextInput
                        style={[styles.cfgLangInput, { backgroundColor: colors.surface, color: colors.text, borderColor: colors.border }]}
                        value={cfgEyebrowAr} onChangeText={setCfgEyebrowAr} textAlign="right"
                        placeholder="اليوم في الغزالي" placeholderTextColor={colors.textSecondary}
                      />
                    </View>
                    <View style={styles.cfgLangField}>
                      <Text style={[styles.cfgLangTag, { color: '#60A5FA', backgroundColor: '#60A5FA15' }]}>EN</Text>
                      <TextInput
                        style={[styles.cfgLangInput, { backgroundColor: colors.surface, color: colors.text, borderColor: colors.border }]}
                        value={cfgEyebrowEn} onChangeText={setCfgEyebrowEn}
                        placeholder="TONIGHT AT AL-GHAZALY" placeholderTextColor={colors.textSecondary}
                      />
                    </View>
                  </View>
                </View>

                {/* ── Section: العنوان الرئيسي ── */}
                <View style={[styles.cfgSection, { backgroundColor: colors.card, borderColor: colors.border }]}>
                  <View style={styles.cfgSectionHeader}>
                    <View style={[styles.cfgSectionIcon, { backgroundColor: '#FFD70018' }]}>
                      <Ionicons name="text" size={14} color="#FFD700" />
                    </View>
                    <Text style={[styles.cfgSectionTitle, { color: colors.text }]}>
                      {language === 'ar' ? 'العنوان الرئيسي' : 'Main Headline'}
                    </Text>
                  </View>
                  <View style={styles.cfgLangRow}>
                    <View style={styles.cfgLangField}>
                      <Text style={[styles.cfgLangTag, { color: '#FFD700', backgroundColor: '#FFD70015' }]}>AR</Text>
                      <TextInput
                        style={[styles.cfgLangInput, { backgroundColor: colors.surface, color: colors.text, borderColor: colors.border }]}
                        value={cfgHeadlineAr} onChangeText={setCfgHeadlineAr} textAlign="right"
                        placeholder="مائدة مضاءة بالشموع" placeholderTextColor={colors.textSecondary}
                      />
                    </View>
                    <View style={styles.cfgLangField}>
                      <Text style={[styles.cfgLangTag, { color: '#60A5FA', backgroundColor: '#60A5FA15' }]}>EN</Text>
                      <TextInput
                        style={[styles.cfgLangInput, { backgroundColor: colors.surface, color: colors.text, borderColor: colors.border }]}
                        value={cfgHeadlineEn} onChangeText={setCfgHeadlineEn}
                        placeholder="A candle-lit table awaits" placeholderTextColor={colors.textSecondary}
                      />
                    </View>
                  </View>
                </View>

                {/* ── Section: النص التوضيحي ── */}
                <View style={[styles.cfgSection, { backgroundColor: colors.card, borderColor: colors.border }]}>
                  <View style={styles.cfgSectionHeader}>
                    <View style={[styles.cfgSectionIcon, { backgroundColor: '#FFD70018' }]}>
                      <Ionicons name="document-text-outline" size={14} color="#FFD700" />
                    </View>
                    <Text style={[styles.cfgSectionTitle, { color: colors.text }]}>
                      {language === 'ar' ? 'النص التوضيحي' : 'Subline Description'}
                    </Text>
                  </View>
                  <View style={styles.cfgLangRow}>
                    <View style={styles.cfgLangField}>
                      <Text style={[styles.cfgLangTag, { color: '#FFD700', backgroundColor: '#FFD70015' }]}>AR</Text>
                      <TextInput
                        style={[styles.cfgLangInput, styles.cfgInputMulti, { backgroundColor: colors.surface, color: colors.text, borderColor: colors.border }]}
                        value={cfgSublineAr} onChangeText={setCfgSublineAr} multiline numberOfLines={3} textAlign="right"
                        placeholder="وصفات الشيف لهذا المساء..." placeholderTextColor={colors.textSecondary}
                      />
                    </View>
                    <View style={styles.cfgLangField}>
                      <Text style={[styles.cfgLangTag, { color: '#60A5FA', backgroundColor: '#60A5FA15' }]}>EN</Text>
                      <TextInput
                        style={[styles.cfgLangInput, styles.cfgInputMulti, { backgroundColor: colors.surface, color: colors.text, borderColor: colors.border }]}
                        value={cfgSublineEn} onChangeText={setCfgSublineEn} multiline numberOfLines={3}
                        placeholder="Tonight's chef-curated tasting..." placeholderTextColor={colors.textSecondary}
                      />
                    </View>
                  </View>
                </View>

                {/* ── Section: الزر الرئيسي ── */}
                <View style={[styles.cfgSection, { backgroundColor: colors.card, borderColor: '#FFD70030' }]}>
                  <View style={styles.cfgSectionHeader}>
                    <View style={[styles.cfgSectionIcon, { backgroundColor: '#FFD700' }]}>
                      <Ionicons name="star" size={14} color="#000" />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.cfgSectionTitle, { color: colors.text }]}>
                        {language === 'ar' ? 'الزر الرئيسي' : 'Primary Button'}
                      </Text>
                      <Text style={{ fontSize: 11, color: colors.textSecondary }}>
                        {language === 'ar' ? 'الزر الذهبي البارز' : 'Gold call-to-action button'}
                      </Text>
                    </View>
                    {/* Mini preview */}
                    <View style={[styles.cfgBtnPreview, { backgroundColor: '#FFD700' }]}>
                      <Ionicons name={cfgCtaPrimaryIcon as any} size={11} color="#000" />
                      <Text style={{ fontSize: 10, fontWeight: '800', color: '#000' }} numberOfLines={1}>
                        {cfgCtaPrimaryAr || '—'}
                      </Text>
                    </View>
                  </View>
                  <View style={styles.cfgLangRow}>
                    <View style={styles.cfgLangField}>
                      <Text style={[styles.cfgLangTag, { color: '#FFD700', backgroundColor: '#FFD70015' }]}>AR</Text>
                      <TextInput
                        style={[styles.cfgLangInput, { backgroundColor: colors.surface, color: colors.text, borderColor: colors.border }]}
                        value={cfgCtaPrimaryAr} onChangeText={setCfgCtaPrimaryAr} textAlign="right"
                        placeholder="احجز طاولة" placeholderTextColor={colors.textSecondary}
                      />
                    </View>
                    <View style={styles.cfgLangField}>
                      <Text style={[styles.cfgLangTag, { color: '#60A5FA', backgroundColor: '#60A5FA15' }]}>EN</Text>
                      <TextInput
                        style={[styles.cfgLangInput, { backgroundColor: colors.surface, color: colors.text, borderColor: colors.border }]}
                        value={cfgCtaPrimaryEn} onChangeText={setCfgCtaPrimaryEn}
                        placeholder="Reserve a Table" placeholderTextColor={colors.textSecondary}
                      />
                    </View>
                  </View>
                  {/* Icon selector */}
                  <Text style={[styles.cfgLabel, { color: colors.textSecondary, marginTop: 10 }]}>
                    {language === 'ar' ? 'أيقونة الزر' : 'Button Icon'}
                  </Text>
                  <TouchableOpacity
                    style={[styles.cfgIconRow, { backgroundColor: colors.surface, borderColor: '#FFD70040' }]}
                    onPress={() => setShowIconPicker(true)}
                  >
                    <View style={[styles.cfgIconPreviewBox, { backgroundColor: '#FFD70018' }]}>
                      <Ionicons name={cfgCtaPrimaryIcon as any} size={22} color="#FFD700" />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.cfgIconLabel, { color: colors.text }]}>{cfgCtaPrimaryIcon}</Text>
                      <Text style={{ fontSize: 11, color: colors.textSecondary }}>
                        {language === 'ar' ? 'اضغط لتغيير الأيقونة' : 'Tap to change icon'}
                      </Text>
                    </View>
                    <Ionicons name="chevron-forward" size={16} color={colors.textSecondary} />
                  </TouchableOpacity>
                </View>

                {/* ── Section: الزر الثانوي ── */}
                <View style={[styles.cfgSection, { backgroundColor: colors.card, borderColor: colors.border }]}>
                  <View style={styles.cfgSectionHeader}>
                    <View style={[styles.cfgSectionIcon, { backgroundColor: colors.surface }]}>
                      <Ionicons name="arrow-forward-circle-outline" size={14} color={colors.textSecondary} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.cfgSectionTitle, { color: colors.text }]}>
                        {language === 'ar' ? 'الزر الثانوي' : 'Secondary Button'}
                      </Text>
                      <Text style={{ fontSize: 11, color: colors.textSecondary }}>
                        {language === 'ar' ? 'رابط ثانوي شفاف' : 'Transparent link-style button'}
                      </Text>
                    </View>
                    <View style={[styles.cfgBtnPreview, { backgroundColor: '#FFFFFF18', borderColor: '#FFFFFF30', borderWidth: 1 }]}>
                      <Text style={{ fontSize: 10, fontWeight: '700', color: '#FFF' }} numberOfLines={1}>
                        {cfgCtaSecondaryAr || '—'}
                      </Text>
                    </View>
                  </View>
                  <View style={styles.cfgLangRow}>
                    <View style={styles.cfgLangField}>
                      <Text style={[styles.cfgLangTag, { color: '#FFD700', backgroundColor: '#FFD70015' }]}>AR</Text>
                      <TextInput
                        style={[styles.cfgLangInput, { backgroundColor: colors.surface, color: colors.text, borderColor: colors.border }]}
                        value={cfgCtaSecondaryAr} onChangeText={setCfgCtaSecondaryAr} textAlign="right"
                        placeholder="اكتشف القائمة" placeholderTextColor={colors.textSecondary}
                      />
                    </View>
                    <View style={styles.cfgLangField}>
                      <Text style={[styles.cfgLangTag, { color: '#60A5FA', backgroundColor: '#60A5FA15' }]}>EN</Text>
                      <TextInput
                        style={[styles.cfgLangInput, { backgroundColor: colors.surface, color: colors.text, borderColor: colors.border }]}
                        value={cfgCtaSecondaryEn} onChangeText={setCfgCtaSecondaryEn}
                        placeholder="Explore the menu" placeholderTextColor={colors.textSecondary}
                      />
                    </View>
                  </View>
                </View>

                {/* ── Save Button ── */}
                <TouchableOpacity
                  style={[styles.cfgSaveBtn, { backgroundColor: '#FFD700', opacity: savingConfig ? 0.6 : 1 }]}
                  onPress={saveHeroConfig} disabled={savingConfig}
                >
                  {savingConfig
                    ? <ActivityIndicator color="#000" size="small" />
                    : <>
                        <Ionicons name="cloud-upload-outline" size={19} color="#000" />
                        <Text style={styles.cfgSaveBtnText}>
                          {language === 'ar' ? 'حفظ وتطبيق التغييرات' : 'Save & Apply Changes'}
                        </Text>
                      </>
                  }
                </TouchableOpacity>
                <Text style={[styles.cfgSaveNote, { color: colors.textSecondary }]}>
                  {language === 'ar'
                    ? 'تُطبَّق التغييرات فوراً على الصفحة الرئيسية للمستخدمين'
                    : 'Changes are applied instantly to the home screen for all users'}
                </Text>
              </>
            )}
          </View>
        ) : activeTab === 'promotions' ? (
          <View style={styles.section}>
            {/* Add Button */}
            <TouchableOpacity
              style={[styles.addButton, { backgroundColor: colors.primary }]}
              onPress={() => {
                resetPromotionForm();
                setShowPromotionModal(true);
              }}
            >
              <Ionicons name="add" size={24} color="#FFF" />
              <Text style={styles.addButtonText}>
                {language === 'ar' ? 'إضافة عرض ترويجي' : 'Add Promotion'}
              </Text>
            </TouchableOpacity>

            {/* Draggable Promotions List */}
            <DraggablePromotionList
              promotions={promotions}
              onReorder={handlePromotionReorder}
              onEdit={openEditPromotion}
              onDelete={deletePromotion}
            />
          </View>
        ) : activeTab === 'footer' ? (
          <View style={styles.section}>
            {/* ── Visibility Toggles ── */}
            <View style={[styles.ftCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Text style={[styles.ftSectionTitle, { color: colors.text }]}>
                {language === 'ar' ? 'إعدادات الظهور' : 'Visibility'}
              </Text>
              {([
                { key: 'show_ratings_strip', label_en: 'Customer Ratings Strip', label_ar: 'شريط التقييمات' },
                { key: 'show_social_strip', label_en: 'Social Media Strip', label_ar: 'شريط التواصل الاجتماعي' },
                { key: 'show_info_rows', label_en: 'Info Rows (Phone/Email/Address)', label_ar: 'صفوف المعلومات' },
              ] as const).map((item) => (
                <View key={item.key} style={styles.ftToggleRow}>
                  <Text style={[styles.ftToggleLabel, { color: colors.text }]}>
                    {language === 'ar' ? item.label_ar : item.label_en}
                  </Text>
                  <TouchableOpacity
                    style={[
                      styles.ftToggle,
                      { backgroundColor: footerForm[item.key] ? '#C8A24A' : colors.surface, borderColor: colors.border },
                    ]}
                    onPress={() => setFooterForm((p) => ({ ...p, [item.key]: !p[item.key] }))}
                    activeOpacity={0.8}
                  >
                    <View style={[styles.ftToggleThumb, { transform: [{ translateX: footerForm[item.key] ? 18 : 2 }] }]} />
                  </TouchableOpacity>
                </View>
              ))}
            </View>

            {/* ── Social Links Manager ── */}
            <View style={[styles.ftCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Text style={[styles.ftSectionTitle, { color: colors.text }]}>
                {language === 'ar' ? 'روابط التواصل الاجتماعي' : 'Social Media Links'}
              </Text>
              <Text style={[styles.ftSectionSub, { color: colors.textSecondary }]}>
                {language === 'ar'
                  ? 'أضف المنصات بالترتيب المطلوب وادخل الروابط'
                  : 'Add platforms in display order and enter their URLs'}
              </Text>

              {/* Existing links list */}
              {socialLinks.map((link, idx) => {
                const meta = getSocialMeta(link.platform);
                if (!meta) return null;
                return (
                  <View key={`${link.platform}-${idx}`} style={[styles.socialManagerRow, { borderColor: colors.border, backgroundColor: colors.surface }]}>
                    {/* Reorder buttons */}
                    <View style={styles.socialReorderCol}>
                      <TouchableOpacity
                        onPress={() => moveSocialLink(idx, -1)}
                        disabled={idx === 0}
                        style={[styles.socialReorderBtn, { opacity: idx === 0 ? 0.25 : 1 }]}
                      >
                        <Ionicons name="chevron-up" size={14} color="#C8A24A" />
                      </TouchableOpacity>
                      <TouchableOpacity
                        onPress={() => moveSocialLink(idx, 1)}
                        disabled={idx === socialLinks.length - 1}
                        style={[styles.socialReorderBtn, { opacity: idx === socialLinks.length - 1 ? 0.25 : 1 }]}
                      >
                        <Ionicons name="chevron-down" size={14} color="#C8A24A" />
                      </TouchableOpacity>
                    </View>

                    {/* Platform icon + label */}
                    <Ionicons name={meta.icon as any} size={20} color={meta.color} style={{ marginRight: 8 }} />

                    {/* URL input */}
                    <TextInput
                      style={[styles.ftInput, { flex: 1, backgroundColor: colors.card, color: colors.text, borderColor: colors.border }]}
                      value={link.url}
                      onChangeText={(v) => updateSocialUrl(idx, v)}
                      placeholder={`${meta.label} URL`}
                      placeholderTextColor={colors.textSecondary}
                      autoCapitalize="none"
                      keyboardType="url"
                    />

                    {/* Delete button */}
                    <TouchableOpacity onPress={() => removeSocialLink(idx)} style={styles.socialDeleteBtn}>
                      <Ionicons name="trash-outline" size={16} color="#EF4444" />
                    </TouchableOpacity>
                  </View>
                );
              })}

              {/* Add Platform button */}
              {availablePlatforms.length > 0 && (
                <TouchableOpacity
                  style={[styles.addSocialBtn, { borderColor: '#C8A24A', backgroundColor: 'rgba(200,162,74,0.08)' }]}
                  onPress={() => setShowSocialPicker((v) => !v)}
                  activeOpacity={0.8}
                >
                  <Ionicons name={showSocialPicker ? 'close' : 'add'} size={16} color="#C8A24A" />
                  <Text style={[styles.addSocialBtnText, { color: '#C8A24A' }]}>
                    {showSocialPicker
                      ? (language === 'ar' ? 'إلغاء' : 'Cancel')
                      : (language === 'ar' ? 'إضافة منصة' : 'Add Platform')}
                  </Text>
                </TouchableOpacity>
              )}

              {/* Platform picker grid */}
              {showSocialPicker && availablePlatforms.length > 0 && (
                <View style={styles.socialPickerGrid}>
                  {availablePlatforms.map((p) => (
                    <TouchableOpacity
                      key={p.platform}
                      style={[styles.socialPickerItem, { borderColor: p.color + '44', backgroundColor: p.color + '14' }]}
                      onPress={() => addSocialLink(p.platform)}
                      activeOpacity={0.75}
                    >
                      <Ionicons name={p.icon as any} size={22} color={p.color} />
                      <Text style={[styles.socialPickerLabel, { color: p.color }]} numberOfLines={1}>
                        {p.label}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              )}
            </View>

            {/* ── App Identity ── */}
            <View style={[styles.ftCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Text style={[styles.ftSectionTitle, { color: colors.text }]}>
                {language === 'ar' ? 'هوية التطبيق' : 'App Identity'}
              </Text>
              <Text style={[styles.ftSectionSub, { color: colors.textSecondary }]}>
                {language === 'ar' ? 'اسم التطبيق والشعار في تذييل الصفحة' : 'App name & tagline shown in the footer brand mark'}
              </Text>
              {([
                { keyEn: 'app_name_en', keyAr: 'app_name_ar', icon: 'diamond', label_en: 'App Name', label_ar: 'اسم التطبيق' },
                { keyEn: 'tagline_en', keyAr: 'tagline_ar', icon: 'text', label_en: 'Tagline', label_ar: 'شعار' },
              ] as const).map((item) => (
                <View key={item.keyEn} style={{ marginBottom: 14 }}>
                  <View style={styles.ftInputRow}>
                    <Ionicons name={item.icon as any} size={16} color="#C8A24A" style={styles.ftInputIcon} />
                    <View style={styles.ftInputWrap}>
                      <Text style={[styles.ftInputLabel, { color: colors.textSecondary }]}>
                        {language === 'ar' ? item.label_ar : item.label_en} (EN)
                      </Text>
                      <TextInput
                        style={[styles.ftInput, { backgroundColor: colors.surface, color: colors.text, borderColor: colors.border }]}
                        value={footerForm[item.keyEn] ?? ''}
                        onChangeText={(v) => setFooterForm((p) => ({ ...p, [item.keyEn]: v }))}
                        placeholder="English"
                        placeholderTextColor={colors.textSecondary}
                      />
                    </View>
                  </View>
                  <View style={[styles.ftInputRow, { marginTop: 6 }]}>
                    <View style={{ width: 34 }} />
                    <View style={styles.ftInputWrap}>
                      <Text style={[styles.ftInputLabel, { color: colors.textSecondary }]}>
                        {language === 'ar' ? item.label_ar : item.label_en} (AR)
                      </Text>
                      <TextInput
                        style={[styles.ftInput, { backgroundColor: colors.surface, color: colors.text, borderColor: colors.border }]}
                        value={footerForm[item.keyAr] ?? ''}
                        onChangeText={(v) => setFooterForm((p) => ({ ...p, [item.keyAr]: v }))}
                        placeholder="عربي"
                        placeholderTextColor={colors.textSecondary}
                        textAlign="right"
                      />
                    </View>
                  </View>
                </View>
              ))}
            </View>

            {/* ── Contact Info — Three Bilingual Text-Area Pairs ── */}
            <View style={[styles.ftCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Text style={[styles.ftSectionTitle, { color: colors.text }]}>
                {language === 'ar' ? 'معلومات الاتصال' : 'Contact Information'}
              </Text>

              {/* Single-field: Phone */}
              <View style={styles.ftInputRow}>
                <Ionicons name="call" size={18} color="#C8A24A" style={styles.ftInputIcon} />
                <TextInput
                  style={[styles.ftInput, { backgroundColor: colors.surface, color: colors.text, borderColor: colors.border }]}
                  value={footerForm.info_phone ?? ''}
                  onChangeText={(v) => setFooterForm((p) => ({ ...p, info_phone: v }))}
                  placeholder={language === 'ar' ? 'رقم الهاتف' : 'Phone number'}
                  placeholderTextColor={colors.textSecondary}
                  keyboardType="phone-pad"
                />
              </View>

              {/* Single-field: Email */}
              <View style={styles.ftInputRow}>
                <Ionicons name="mail" size={18} color="#C8A24A" style={styles.ftInputIcon} />
                <TextInput
                  style={[styles.ftInput, { backgroundColor: colors.surface, color: colors.text, borderColor: colors.border }]}
                  value={footerForm.info_email ?? ''}
                  onChangeText={(v) => setFooterForm((p) => ({ ...p, info_email: v }))}
                  placeholder={language === 'ar' ? 'البريد الإلكتروني' : 'Email address'}
                  placeholderTextColor={colors.textSecondary}
                  keyboardType="email-address"
                />
              </View>

              {/* Bilingual pair 1: Address */}
              <Text style={[styles.ftBilingualLabel, { color: colors.textSecondary, marginTop: 10 }]}>
                <Ionicons name="location" size={12} color="#C8A24A" /> {language === 'ar' ? 'العنوان (ثنائي اللغة)' : 'Address (bilingual pair)'}
              </Text>
              <TextInput
                style={[styles.ftTextArea, { backgroundColor: colors.surface, color: colors.text, borderColor: colors.border }]}
                value={footerForm.info_address_en ?? ''}
                onChangeText={(v) => setFooterForm((p) => ({ ...p, info_address_en: v }))}
                placeholder="Address in English"
                placeholderTextColor={colors.textSecondary}
                multiline
                numberOfLines={2}
                textAlignVertical="top"
              />
              <TextInput
                style={[styles.ftTextArea, { backgroundColor: colors.surface, color: colors.text, borderColor: colors.border, textAlign: 'right', marginTop: 6 }]}
                value={footerForm.info_address_ar ?? ''}
                onChangeText={(v) => setFooterForm((p) => ({ ...p, info_address_ar: v }))}
                placeholder="العنوان بالعربية"
                placeholderTextColor={colors.textSecondary}
                multiline
                numberOfLines={2}
                textAlignVertical="top"
              />

              {/* Bilingual pair 2: Hours */}
              <Text style={[styles.ftBilingualLabel, { color: colors.textSecondary, marginTop: 10 }]}>
                <Ionicons name="time" size={12} color="#C8A24A" /> {language === 'ar' ? 'ساعات العمل (ثنائي اللغة)' : 'Hours (bilingual pair)'}
              </Text>
              <TextInput
                style={[styles.ftTextArea, { backgroundColor: colors.surface, color: colors.text, borderColor: colors.border }]}
                value={footerForm.info_hours_en ?? ''}
                onChangeText={(v) => setFooterForm((p) => ({ ...p, info_hours_en: v }))}
                placeholder="Opening hours in English"
                placeholderTextColor={colors.textSecondary}
                multiline
                numberOfLines={2}
                textAlignVertical="top"
              />
              <TextInput
                style={[styles.ftTextArea, { backgroundColor: colors.surface, color: colors.text, borderColor: colors.border, textAlign: 'right', marginTop: 6 }]}
                value={footerForm.info_hours_ar ?? ''}
                onChangeText={(v) => setFooterForm((p) => ({ ...p, info_hours_ar: v }))}
                placeholder="ساعات العمل بالعربية"
                placeholderTextColor={colors.textSecondary}
                multiline
                numberOfLines={2}
                textAlignVertical="top"
              />

              {/* Bilingual pair 3: Custom info row */}
              <Text style={[styles.ftBilingualLabel, { color: colors.textSecondary, marginTop: 10 }]}>
                <Ionicons name="information-circle" size={12} color="#C8A24A" /> {language === 'ar' ? 'صف مخصص (ثنائي اللغة)' : 'Custom row (bilingual pair)'}
              </Text>
              <TextInput
                style={[styles.ftTextArea, { backgroundColor: colors.surface, color: colors.text, borderColor: colors.border }]}
                value={footerForm.info_custom_en ?? ''}
                onChangeText={(v) => setFooterForm((p) => ({ ...p, info_custom_en: v }))}
                placeholder="Custom info in English (optional)"
                placeholderTextColor={colors.textSecondary}
                multiline
                numberOfLines={2}
                textAlignVertical="top"
              />
              <TextInput
                style={[styles.ftTextArea, { backgroundColor: colors.surface, color: colors.text, borderColor: colors.border, textAlign: 'right', marginTop: 6 }]}
                value={footerForm.info_custom_ar ?? ''}
                onChangeText={(v) => setFooterForm((p) => ({ ...p, info_custom_ar: v }))}
                placeholder="معلومات مخصصة بالعربية (اختياري)"
                placeholderTextColor={colors.textSecondary}
                multiline
                numberOfLines={2}
                textAlignVertical="top"
              />
            </View>

            {/* ── Brand Video ── */}
            <View style={[styles.ftCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Text style={[styles.ftSectionTitle, { color: colors.text }]}>
                {language === 'ar' ? 'فيديو العلامة التجارية' : 'Brand Video'}
              </Text>
              <Text style={[styles.ftSectionSub, { color: colors.textSecondary }]}>
                {language === 'ar' ? 'فيديو قصير يُعرض في التذييل (صوت مكتوم، تكرار تلقائي)' : 'Short looping muted video shown in the footer'}
              </Text>
              <View style={styles.ftToggleRow}>
                <Text style={[styles.ftToggleLabel, { color: colors.text }]}>
                  {language === 'ar' ? 'إظهار الفيديو' : 'Show Video'}
                </Text>
                <TouchableOpacity
                  style={[styles.ftToggle, { backgroundColor: footerForm.show_video ? '#C8A24A' : colors.surface, borderColor: colors.border }]}
                  onPress={() => setFooterForm((p) => ({ ...p, show_video: !p.show_video }))}
                  activeOpacity={0.8}
                >
                  <View style={[styles.ftToggleThumb, { transform: [{ translateX: footerForm.show_video ? 18 : 2 }] }]} />
                </TouchableOpacity>
              </View>
              <TouchableOpacity
                style={[styles.ftVideoUploadBtn, { backgroundColor: colors.surface, borderColor: '#C8A24A', opacity: videoUploading ? 0.6 : 1 }]}
                onPress={pickAndUploadVideo}
                disabled={videoUploading}
                activeOpacity={0.8}
              >
                {videoUploading ? (
                  <ActivityIndicator size="small" color="#C8A24A" />
                ) : (
                  <Ionicons name="cloud-upload-outline" size={18} color="#C8A24A" />
                )}
                <Text style={[styles.ftVideoUploadBtnText, { color: '#C8A24A' }]}>
                  {videoUploading
                    ? (language === 'ar' ? 'جارٍ الرفع...' : 'Uploading...')
                    : (language === 'ar' ? 'رفع ملف فيديو' : 'Upload Video File')}
                </Text>
              </TouchableOpacity>
              <Text style={[styles.ftSectionSub, { color: colors.textSecondary, marginTop: 6, marginBottom: 2 }]}>
                {language === 'ar' ? 'أو الصق رابط فيديو خارجي:' : 'Or paste an external video URL:'}
              </Text>
              <View style={[styles.ftInputRow, { marginTop: 4 }]}>
                <Ionicons name="play-circle" size={18} color="#C8A24A" style={styles.ftInputIcon} />
                <TextInput
                  style={[styles.ftInput, { backgroundColor: colors.surface, color: colors.text, borderColor: colors.border }]}
                  value={footerForm.video_url ?? ''}
                  onChangeText={(v) => setFooterForm((p) => ({ ...p, video_url: v }))}
                  placeholder="https://..."
                  placeholderTextColor={colors.textSecondary}
                  autoCapitalize="none"
                  keyboardType="url"
                />
              </View>
              {!!footerForm.video_url && (
                <View style={[styles.ftVideoPreviewContainer, { borderColor: colors.border }]}>
                  <Text style={[styles.ftVideoPreviewLabel, { color: colors.textSecondary }]}>
                    {language === 'ar' ? 'معاينة الفيديو' : 'Video Preview'}
                  </Text>
                  <View style={styles.ftVideoPreviewWrapper}>
                    <Video
                      key={footerForm.video_url}
                      source={{ uri: footerForm.video_url }}
                      style={styles.ftVideoPreview}
                      resizeMode={ResizeMode.COVER}
                      isLooping={false}
                      isMuted
                      shouldPlay={false}
                    />
                    <View style={styles.ftVideoPreviewOverlay} pointerEvents="none">
                      <Ionicons name="play-circle" size={36} color="rgba(255,255,255,0.85)" />
                    </View>
                  </View>
                </View>
              )}
            </View>

            {/* ── Copyright ── */}
            <View style={[styles.ftCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Text style={[styles.ftSectionTitle, { color: colors.text }]}>
                {language === 'ar' ? 'نص حقوق النشر' : 'Copyright Text'}
              </Text>
              {([
                { key: 'copyright_en', label: 'English' },
                { key: 'copyright_ar', label: 'Arabic / عربي' },
              ] as const).map((item) => (
                <View key={item.key} style={{ marginBottom: 10 }}>
                  <Text style={[styles.ftInputLabel, { color: colors.textSecondary, marginBottom: 4 }]}>{item.label}</Text>
                  <TextInput
                    style={[styles.ftInput, { backgroundColor: colors.surface, color: colors.text, borderColor: colors.border }]}
                    value={footerForm[item.key] ?? ''}
                    onChangeText={(v) => setFooterForm((p) => ({ ...p, [item.key]: v }))}
                    placeholder={item.label}
                    placeholderTextColor={colors.textSecondary}
                  />
                </View>
              ))}
            </View>

            {/* ── Save Button ── */}
            <TouchableOpacity
              style={[styles.ftSaveBtn, { opacity: footerSaving ? 0.6 : 1 }]}
              onPress={saveFooterConfig}
              disabled={footerSaving}
              activeOpacity={0.85}
            >
              <Ionicons name={footerSaving ? 'hourglass' : 'save'} size={18} color="#000" />
              <Text style={styles.ftSaveBtnText}>
                {footerSaving
                  ? (language === 'ar' ? 'جارٍ الحفظ…' : 'Saving…')
                  : (language === 'ar' ? 'حفظ إعدادات الفوتر' : 'Save Footer Settings')}
              </Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View style={styles.section}>
            {/* Add Button */}
            <TouchableOpacity
              style={[styles.addButton, { backgroundColor: colors.primary }]}
              onPress={() => {
                resetBundleForm();
                setShowBundleModal(true);
              }}
            >
              <Ionicons name="add" size={24} color="#FFF" />
              <Text style={styles.addButtonText}>
                {language === 'ar' ? 'إضافة عرض مجمع' : 'Add Bundle Offer'}
              </Text>
            </TouchableOpacity>

            {/* Bundle Offers List */}
            {bundleOffers.length === 0 ? (
              <View style={styles.emptyState}>
                <Ionicons name="gift-outline" size={48} color={colors.textSecondary} />
                <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
                  {language === 'ar' ? 'لا توجد عروض مجمعة' : 'No bundle offers yet'}
                </Text>
              </View>
            ) : (
              (bundleOffers as any[]).map((bundle: any) => (
                <View
                  key={bundle.id}
                  style={[styles.itemCard, { backgroundColor: colors.card, borderColor: colors.border }]}
                >
                  <View style={styles.itemHeader}>
                    {(bundle.image_url || bundle.image) ? (
                      <Image source={{ uri: bundle.image_url || bundle.image }} style={styles.itemImage} />
                    ) : (
                      <View style={[styles.itemImagePlaceholder, { backgroundColor: colors.surface }]}>
                        <Ionicons name="gift" size={24} color={colors.textSecondary} />
                      </View>
                    )}
                    <View style={styles.itemInfo}>
                      <Text style={[styles.itemTitle, { color: colors.text }]}>{bundle.name}</Text>
                      <View style={styles.itemBadges}>
                        <View style={[styles.badge, { backgroundColor: '#F59E0B' }]}>
                          <Text style={styles.badgeText}>{bundle.discount_percentage}% OFF</Text>
                        </View>
                        <View
                          style={[
                            styles.badge,
                            { backgroundColor: bundle.is_active ? '#10B981' : '#EF4444' },
                          ]}
                        >
                          <Text style={styles.badgeText}>
                            {bundle.is_active
                              ? language === 'ar'
                                ? 'نشط'
                                : 'Active'
                              : language === 'ar'
                              ? 'غير نشط'
                              : 'Inactive'}
                          </Text>
                        </View>
                      </View>
                      <Text style={[styles.itemTarget, { color: colors.textSecondary }]}>
                        {bundle.product_ids?.length || 0}{' '}
                        {language === 'ar' ? 'منتجات' : 'products'}
                        {bundle.target_restaurant && ` • ${bundle.target_restaurant.name}`}
                      </Text>
                      {bundle.original_total && bundle.discounted_total && (
                        <View style={styles.priceRow}>
                          <Text style={[styles.originalPrice, { color: colors.textSecondary }]}>
                            {(parseFloat(String(bundle.original_total || 0)) || 0).toFixed(2)} EGP
                          </Text>
                          <Text style={[styles.discountedPrice, { color: colors.success }]}>
                            {(parseFloat(String(bundle.discounted_total || 0)) || 0).toFixed(2)} EGP
                          </Text>
                        </View>
                      )}
                    </View>
                  </View>
                  <View style={styles.itemActions}>
                    <TouchableOpacity
                      style={[styles.actionButton, { backgroundColor: colors.primary + '20' }]}
                      onPress={() => openEditBundle(bundle)}
                    >
                      <Ionicons name="pencil" size={18} color={colors.primary} />
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.actionButton, { backgroundColor: colors.error + '20' }]}
                      onPress={() => deleteBundle(bundle.id)}
                    >
                      <Ionicons name="trash" size={18} color={colors.error} />
                    </TouchableOpacity>
                  </View>
                </View>
              ))
            )}
          </View>
        )}

        <View style={{ height: 100 }} />
      </ScrollView>

      {/* Promotion Modal */}
      <Modal visible={showPromotionModal} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: colors.background }]}>
            <View style={styles.modalHeader}>
              <Text style={[styles.modalTitle, { color: colors.text }]}>
                {editingPromotion
                  ? language === 'ar'
                    ? 'تعديل العرض'
                    : 'Edit Promotion'
                  : language === 'ar'
                  ? 'إضافة عرض جديد'
                  : 'Add Promotion'}
              </Text>
              <TouchableOpacity onPress={() => setShowPromotionModal(false)}>
                <Ionicons name="close" size={24} color={colors.text} />
              </TouchableOpacity>
            </View>

            <ScrollView style={styles.modalBody}>
              <Text style={[styles.label, { color: colors.text }]}>
                {language === 'ar' ? 'العنوان' : 'Title'} *
              </Text>
              <TextInput
                style={[styles.input, { backgroundColor: colors.surface, color: colors.text, borderColor: colors.border }]}
                value={promoTitle}
                onChangeText={setPromoTitle}
                placeholder={language === 'ar' ? 'أدخل العنوان' : 'Enter title'}
                placeholderTextColor={colors.textSecondary}
              />

              <Text style={[styles.label, { color: colors.text }]}>
                {language === 'ar' ? 'العنوان بالعربية' : 'Title (Arabic)'}
              </Text>
              <TextInput
                style={[styles.input, { backgroundColor: colors.surface, color: colors.text, borderColor: colors.border }]}
                value={promoTitleAr}
                onChangeText={setPromoTitleAr}
                placeholder={language === 'ar' ? 'أدخل العنوان بالعربية' : 'Enter Arabic title'}
                placeholderTextColor={colors.textSecondary}
              />

              {/* Promotion Image Upload */}
              <View style={styles.imageUploadSection}>
                <ImageUploader
                  mode="single"
                  value={promoImage}
                  onChange={(newImage) => setPromoImage(newImage as string)}
                  size="large"
                  shape="rounded"
                  aspectRatio={[16, 9]}
                  label={language === 'ar' ? 'صورة العرض الترويجي' : 'Promotion Image'}
                  hint={language === 'ar' ? 'أفضل مقاس: 1920×1080' : 'Best size: 1920×1080'}
                />
              </View>

              <Text style={[styles.label, { color: colors.text }]}>
                {language === 'ar' ? 'نوع العرض' : 'Promotion Type'}
              </Text>
              <View style={styles.typeSelector}>
                <TouchableOpacity
                  style={[
                    styles.typeOption,
                    { backgroundColor: promoType === 'slider' ? colors.primary : colors.surface, borderColor: colors.border },
                  ]}
                  onPress={() => setPromoType('slider')}
                >
                  <Text style={{ color: promoType === 'slider' ? '#FFF' : colors.text }}>
                    {language === 'ar' ? 'سلايدر' : 'Slider'}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[
                    styles.typeOption,
                    { backgroundColor: promoType === 'banner' ? colors.primary : colors.surface, borderColor: colors.border },
                  ]}
                  onPress={() => setPromoType('banner')}
                >
                  <Text style={{ color: promoType === 'banner' ? '#FFF' : colors.text }}>
                    {language === 'ar' ? 'بانر' : 'Banner'}
                  </Text>
                </TouchableOpacity>
              </View>

              <View style={styles.switchRow}>
                <Text style={[styles.label, { color: colors.text, marginBottom: 0 }]}>
                  {language === 'ar' ? 'نشط' : 'Active'}
                </Text>
                <Switch value={promoIsActive} onValueChange={setPromoIsActive} />
              </View>

              <Text style={[styles.label, { color: colors.text }]}>
                {language === 'ar' ? 'الاستهداف' : 'Targeting'} *
              </Text>
              <View style={styles.typeSelector}>
                <TouchableOpacity
                  style={[
                    styles.typeOption,
                    { backgroundColor: promoTargetType === 'product' ? colors.primary : colors.surface, borderColor: colors.border },
                  ]}
                  onPress={() => {
                    setPromoTargetType('product');
                    setPromoTargetRestaurantId('');
                  }}
                >
                  <Text style={{ color: promoTargetType === 'product' ? '#FFF' : colors.text }}>
                    {language === 'ar' ? 'منتج' : 'Product'}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[
                    styles.typeOption,
                    { backgroundColor: promoTargetType === 'restaurant' ? colors.primary : colors.surface, borderColor: colors.border },
                  ]}
                  onPress={() => {
                    setPromoTargetType('restaurant');
                    setPromoTargetProductId('');
                  }}
                >
                  <Text style={{ color: promoTargetType === 'restaurant' ? '#FFF' : colors.text }}>
                    {language === 'ar' ? 'مطعم' : 'Restaurant'}
                  </Text>
                </TouchableOpacity>
              </View>

              {promoTargetType === 'product' ? (
                <TouchableOpacity
                  style={[styles.selectorButton, { backgroundColor: colors.surface, borderColor: colors.border }]}
                  onPress={() => {
                    setSelectorMode('promo');
                    setSearchQuery('');
                    setShowProductSelector(true);
                  }}
                >
                  <Text style={{ color: promoTargetProductId ? colors.text : colors.textSecondary }}>
                    {promoTargetProductId
                      ? getSelectedProductName(promoTargetProductId)
                      : language === 'ar'
                      ? 'اختر منتج'
                      : 'Select Product'}
                  </Text>
                  <Ionicons name="chevron-down" size={20} color={colors.textSecondary} />
                </TouchableOpacity>
              ) : (
                <TouchableOpacity
                  style={[styles.selectorButton, { backgroundColor: colors.surface, borderColor: colors.border }]}
                  onPress={() => {
                    setSelectorMode('promo');
                    setSearchQuery('');
                    setShowRestaurantSelector(true);
                  }}
                >
                  <Text style={{ color: promoTargetRestaurantId ? colors.text : colors.textSecondary }}>
                    {promoTargetRestaurantId
                      ? getSelectedRestaurantName(promoTargetRestaurantId)
                      : language === 'ar'
                      ? 'اختر مطعماً'
                      : 'Select Restaurant'}
                  </Text>
                  <Ionicons name="chevron-down" size={20} color={colors.textSecondary} />
                </TouchableOpacity>
              )}
            </ScrollView>

            <View style={styles.modalFooter}>
              <TouchableOpacity
                style={[styles.cancelButton, { borderColor: colors.border }]}
                onPress={() => setShowPromotionModal(false)}
              >
                <Text style={{ color: colors.text }}>{language === 'ar' ? 'إلغاء' : 'Cancel'}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.saveButton, { backgroundColor: colors.primary }]}
                onPress={savePromotion}
                disabled={savingPromotion}
              >
                {savingPromotion ? (
                  <ActivityIndicator size="small" color="#FFF" />
                ) : (
                  <Text style={{ color: '#FFF', fontWeight: '600' }}>
                    {language === 'ar' ? 'حفظ' : 'Save'}
                  </Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Bundle Modal */}
      <Modal visible={showBundleModal} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: colors.background }]}>
            <View style={styles.modalHeader}>
              <Text style={[styles.modalTitle, { color: colors.text }]}>
                {editingBundle
                  ? language === 'ar'
                    ? 'تعديل العرض المجمع'
                    : 'Edit Bundle Offer'
                  : language === 'ar'
                  ? 'إضافة عرض مجمع'
                  : 'Add Bundle Offer'}
              </Text>
              <TouchableOpacity onPress={() => setShowBundleModal(false)}>
                <Ionicons name="close" size={24} color={colors.text} />
              </TouchableOpacity>
            </View>

            <ScrollView style={styles.modalBody}>
              <Text style={[styles.label, { color: colors.text }]}>
                {language === 'ar' ? 'اسم العرض' : 'Offer Name'} *
              </Text>
              <TextInput
                style={[styles.input, { backgroundColor: colors.surface, color: colors.text, borderColor: colors.border }]}
                value={bundleName}
                onChangeText={setBundleName}
                placeholder={language === 'ar' ? 'مثال: عرض وجبة الشيف الصيفية' : 'e.g., Summer Chef Special'}
                placeholderTextColor={colors.textSecondary}
              />

              <Text style={[styles.label, { color: colors.text }]}>
                {language === 'ar' ? 'اسم العرض بالعربية' : 'Offer Name (Arabic)'}
              </Text>
              <TextInput
                style={[styles.input, { backgroundColor: colors.surface, color: colors.text, borderColor: colors.border }]}
                value={bundleNameAr}
                onChangeText={setBundleNameAr}
                placeholder={language === 'ar' ? 'مثال: عرض وجبة الشيف الصيفية' : 'e.g., عرض الشيف'}
                placeholderTextColor={colors.textSecondary}
                textAlign="right"
              />

              <Text style={[styles.label, { color: colors.text }]}>
                {language === 'ar' ? 'وصف العرض' : 'Description'}
              </Text>
              <TextInput
                style={[styles.input, { backgroundColor: colors.surface, color: colors.text, borderColor: colors.border, minHeight: 70, textAlignVertical: 'top' }]}
                value={bundleDescription}
                onChangeText={setBundleDescription}
                placeholder={language === 'ar' ? 'وصف مختصر للعرض (اختياري)' : 'Short description (optional)'}
                placeholderTextColor={colors.textSecondary}
                multiline
                numberOfLines={3}
              />

              <Text style={[styles.label, { color: colors.text }]}>
                {language === 'ar' ? 'نسبة الخصم %' : 'Discount %'} *
              </Text>
              <TextInput
                style={[styles.input, { backgroundColor: colors.surface, color: colors.text, borderColor: colors.border }]}
                value={bundleDiscount}
                onChangeText={setBundleDiscount}
                keyboardType="numeric"
                placeholder="15"
                placeholderTextColor={colors.textSecondary}
              />

              {/* Bundle Image Upload */}
              <View style={styles.imageUploadSection}>
                <ImageUploader
                  mode="single"
                  value={bundleImage}
                  onChange={(newImage) => setBundleImage(newImage as string)}
                  size="medium"
                  shape="rounded"
                  aspectRatio={[4, 3]}
                  label={language === 'ar' ? 'صورة العرض المجمع' : 'Bundle Image'}
                  hint={language === 'ar' ? 'اختياري - صورة للعرض' : 'Optional - image for the offer'}
                />
              </View>

              <View style={styles.switchRow}>
                <Text style={[styles.label, { color: colors.text, marginBottom: 0 }]}>
                  {language === 'ar' ? 'نشط' : 'Active'}
                </Text>
                <Switch value={bundleIsActive} onValueChange={setBundleIsActive} />
              </View>

              <Text style={[styles.label, { color: colors.text }]}>
                {language === 'ar' ? 'المطعم المستهدف' : 'Target Restaurant'}
              </Text>
              <TouchableOpacity
                style={[styles.selectorButton, { backgroundColor: colors.surface, borderColor: colors.border }]}
                onPress={() => {
                  setSelectorMode('bundle');
                  setSearchQuery('');
                  setShowRestaurantSelector(true);
                }}
              >
                <Text style={{ color: bundleTargetRestaurantId ? colors.text : colors.textSecondary }}>
                  {bundleTargetRestaurantId
                    ? getSelectedRestaurantName(bundleTargetRestaurantId)
                    : language === 'ar'
                    ? 'اختر مطعماً (اختياري)'
                    : 'Select Restaurant (optional)'}
                </Text>
                <Ionicons name="chevron-down" size={20} color={colors.textSecondary} />
              </TouchableOpacity>

              <Text style={[styles.label, { color: colors.text }]}>
                {language === 'ar' ? 'المنتجات' : 'Products'} * ({bundleProductIds.length})
              </Text>
              <TouchableOpacity
                style={[styles.selectorButton, { backgroundColor: colors.surface, borderColor: colors.border }]}
                onPress={() => {
                  setSelectorMode('bundle');
                  setSearchQuery('');
                  setShowProductSelector(true);
                }}
              >
                <Text style={{ color: bundleProductIds.length > 0 ? colors.text : colors.textSecondary }}>
                  {bundleProductIds.length > 0
                    ? `${bundleProductIds.length} ${language === 'ar' ? 'منتجات مختارة' : 'products selected'}`
                    : language === 'ar'
                    ? 'اختر المنتجات'
                    : 'Select Products'}
                </Text>
                <Ionicons name="chevron-down" size={20} color={colors.textSecondary} />
              </TouchableOpacity>

              {bundleProductIds.length > 0 && (
                <View style={styles.selectedProducts}>
                  {bundleProductIds.map((pid) => (
                    <View key={pid} style={[styles.selectedChip, { backgroundColor: colors.primary + '20' }]}>
                      <Text style={{ color: colors.primary, fontSize: 12 }}>
                        {getSelectedProductName(pid)}
                      </Text>
                      <TouchableOpacity
                        onPress={() => setBundleProductIds((prev) => prev.filter((id) => id !== pid))}
                      >
                        <Ionicons name="close-circle" size={16} color={colors.primary} />
                      </TouchableOpacity>
                    </View>
                  ))}
                </View>
              )}
            </ScrollView>

            <View style={styles.modalFooter}>
              <TouchableOpacity
                style={[styles.cancelButton, { borderColor: colors.border }]}
                onPress={() => setShowBundleModal(false)}
              >
                <Text style={{ color: colors.text }}>{language === 'ar' ? 'إلغاء' : 'Cancel'}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.saveButton, { backgroundColor: colors.primary }]}
                onPress={saveBundle}
                disabled={savingBundle}
              >
                {savingBundle ? (
                  <ActivityIndicator size="small" color="#FFF" />
                ) : (
                  <Text style={{ color: '#FFF', fontWeight: '600' }}>
                    {language === 'ar' ? 'حفظ' : 'Save'}
                  </Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Hero Image Modal */}
      <Modal visible={showHeroModal} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: colors.background }]}>
            <View style={styles.modalHeader}>
              <Text style={[styles.modalTitle, { color: colors.text }]}>
                {editingHeroPromo
                  ? (language === 'ar' ? 'تعديل صورة الهيرو' : 'Edit Hero Image')
                  : (language === 'ar' ? 'إضافة صورة هيرو' : 'Add Hero Image')}
              </Text>
              <TouchableOpacity onPress={() => setShowHeroModal(false)}>
                <Ionicons name="close" size={24} color={colors.text} />
              </TouchableOpacity>
            </View>
            <ScrollView style={styles.modalBody}>
              <Text style={[styles.label, { color: colors.text }]}>
                {language === 'ar' ? 'العنوان (عربي)' : 'Title (Arabic)'}
              </Text>
              <TextInput
                style={[styles.input, { backgroundColor: colors.surface, color: colors.text, borderColor: colors.border }]}
                value={heroTitleAr}
                onChangeText={setHeroTitleAr}
                placeholder={language === 'ar' ? 'وصف الصورة بالعربية' : 'Arabic title / description'}
                placeholderTextColor={colors.textSecondary}
                textAlign={isRTL ? 'right' : 'left'}
              />
              <Text style={[styles.label, { color: colors.text }]}>
                {language === 'ar' ? 'العنوان (إنجليزي)' : 'Title (English)'}
              </Text>
              <TextInput
                style={[styles.input, { backgroundColor: colors.surface, color: colors.text, borderColor: colors.border }]}
                value={heroTitle}
                onChangeText={setHeroTitle}
                placeholder="English title / description"
                placeholderTextColor={colors.textSecondary}
              />
              {/* Hero Image Upload */}
              <View style={styles.imageUploadSection}>
                <ImageUploader
                  mode="single"
                  value={heroImage}
                  onChange={(newImage) => setHeroImage(newImage as string)}
                  size="large"
                  shape="rounded"
                  aspectRatio={[14, 10]}
                  label={language === 'ar' ? 'صورة الخلفية' : 'Backdrop Image'}
                  hint={language === 'ar' ? 'أفضل مقاس: 1400×1000' : 'Best size: 1400×1000'}
                />
              </View>
              <View style={styles.switchRow}>
                <Text style={[styles.label, { color: colors.text, marginBottom: 0 }]}>
                  {language === 'ar' ? 'نشط' : 'Active'}
                </Text>
                <Switch value={heroIsActive} onValueChange={setHeroIsActive} />
              </View>
              <TouchableOpacity
                style={[styles.saveButton, { backgroundColor: '#FFD700', opacity: savingHero ? 0.7 : 1 }]}
                onPress={saveHero}
                disabled={savingHero}
              >
                {savingHero ? (
                  <ActivityIndicator color="#000" />
                ) : (
                  <Text style={[{ fontSize: 14, fontWeight: '700' }, { color: '#000' }]}>
                    {language === 'ar' ? 'حفظ الصورة' : 'Save Image'}
                  </Text>
                )}
              </TouchableOpacity>
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* Icon Picker Modal */}
      <Modal visible={showIconPicker} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: colors.background, maxHeight: '70%' }]}>
            <View style={styles.modalHeader}>
              <Text style={[styles.modalTitle, { color: colors.text }]}>
                {language === 'ar' ? 'اختر أيقونة' : 'Choose Icon'}
              </Text>
              <TouchableOpacity onPress={() => setShowIconPicker(false)}>
                <Ionicons name="close" size={24} color={colors.text} />
              </TouchableOpacity>
            </View>
            <FlatList
              data={[
                'restaurant','calendar-outline','book-outline','cafe-outline',
                'wine-outline','pizza-outline','fast-food-outline','flame-outline',
                'sparkles-outline','gift-outline','star-outline','heart-outline',
                'time-outline','people-outline','diamond-outline','leaf-outline',
                'fish-outline','ice-cream-outline','beer-outline','nutrition-outline',
              ]}
              numColumns={4}
              keyExtractor={(item) => item}
              contentContainerStyle={{ padding: 12, gap: 8 }}
              renderItem={({ item }) => (
                <TouchableOpacity
                  onPress={() => { setCfgCtaPrimaryIcon(item); setShowIconPicker(false); }}
                  style={[
                    styles.iconPickerItem,
                    {
                      backgroundColor: cfgCtaPrimaryIcon === item ? '#FFD70020' : colors.surface,
                      borderColor: cfgCtaPrimaryIcon === item ? '#FFD700' : colors.border,
                    }
                  ]}
                >
                  <Ionicons name={item as any} size={26} color={cfgCtaPrimaryIcon === item ? '#FFD700' : colors.text} />
                  <Text style={{ fontSize: 9, color: colors.textSecondary, textAlign: 'center' }} numberOfLines={1}>{item.replace('-outline','')}</Text>
                </TouchableOpacity>
              )}
            />
          </View>
        </View>
      </Modal>

      {/* Product Selector Modal */}
      <Modal visible={showProductSelector} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={[styles.selectorModal, { backgroundColor: colors.background }]}>
            <View style={styles.modalHeader}>
              <Text style={[styles.modalTitle, { color: colors.text }]}>
                {language === 'ar' ? 'اختر المنتجات' : 'Select Products'}
              </Text>
              <TouchableOpacity onPress={() => setShowProductSelector(false)}>
                <Ionicons name="close" size={24} color={colors.text} />
              </TouchableOpacity>
            </View>
            <TextInput
              style={[styles.searchInput, { backgroundColor: colors.surface, color: colors.text, borderColor: colors.border }]}
              value={searchQuery}
              onChangeText={setSearchQuery}
              placeholder={language === 'ar' ? 'بحث...' : 'Search...'}
              placeholderTextColor={colors.textSecondary}
            />
            <View style={styles.flashListSelectorContainer}>
              <FlashList<any>
                data={filteredProducts}
                keyExtractor={(item) => item.id}
                estimatedItemSize={70}
                renderItem={({ item }) => {
                  const isSelected =
                    selectorMode === 'promo'
                      ? promoTargetProductId === item.id
                      : bundleProductIds.includes(item.id);
                  return (
                    <TouchableOpacity
                      style={[
                        styles.selectorItem,
                        { backgroundColor: isSelected ? colors.primary + '20' : colors.surface, borderColor: colors.border },
                      ]}
                      onPress={() => {
                        if (selectorMode === 'promo') {
                          setPromoTargetProductId(item.id);
                          setShowProductSelector(false);
                        } else {
                          if (isSelected) {
                            setBundleProductIds((prev) => prev.filter((id) => id !== item.id));
                          } else {
                            setBundleProductIds((prev) => [...prev, item.id]);
                          }
                        }
                      }}
                    >
                      <View>
                        <Text style={[styles.selectorItemTitle, { color: colors.text }]}>
                          {language === 'ar' ? item.name_ar : item.name || item.name}
                        </Text>
                        <Text style={[styles.selectorItemSubtitle, { color: colors.textSecondary }]}>
                          {item.sku} • {parseFloat(String(item.price || 0)).toFixed(2)} EGP
                        </Text>
                      </View>
                      {isSelected && <Ionicons name="checkmark-circle" size={24} color={colors.primary} />}
                    </TouchableOpacity>
                  );
                }}
              />
            </View>
            {selectorMode === 'bundle' && (
              <TouchableOpacity
                style={[styles.doneButton, { backgroundColor: colors.primary }]}
                onPress={() => setShowProductSelector(false)}
              >
                <Text style={{ color: '#FFF', fontWeight: '600' }}>
                  {language === 'ar' ? 'تم' : 'Done'} ({bundleProductIds.length})
                </Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
      </Modal>

      {/* Restaurant Selector Modal */}
      <Modal visible={showRestaurantSelector} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={[styles.selectorModal, { backgroundColor: colors.background }]}>
            <View style={styles.modalHeader}>
              <Text style={[styles.modalTitle, { color: colors.text }]}>
                {language === 'ar' ? 'اختر مطعماً' : 'Select Restaurant'}
              </Text>
              <TouchableOpacity onPress={() => setShowRestaurantSelector(false)}>
                <Ionicons name="close" size={24} color={colors.text} />
              </TouchableOpacity>
            </View>
            <TextInput
              style={[styles.searchInput, { backgroundColor: colors.surface, color: colors.text, borderColor: colors.border }]}
              value={searchQuery}
              onChangeText={setSearchQuery}
              placeholder={language === 'ar' ? 'بحث...' : 'Search...'}
              placeholderTextColor={colors.textSecondary}
            />
            <View style={styles.flashListSelectorContainer}>
              <FlashList<any>
                data={filteredRestaurants}
                keyExtractor={(item) => item.id}
                estimatedItemSize={70}
                renderItem={({ item }) => {
                  const isSelected =
                    selectorMode === 'promo'
                      ? promoTargetRestaurantId === item.id
                      : bundleTargetRestaurantId === item.id;
                  return (
                    <TouchableOpacity
                      style={[
                        styles.selectorItem,
                        { backgroundColor: isSelected ? colors.primary + '20' : colors.surface, borderColor: colors.border },
                      ]}
                      onPress={() => {
                        if (selectorMode === 'promo') {
                          setPromoTargetRestaurantId(item.id);
                        } else {
                          setBundleTargetRestaurantId(item.id);
                        }
                        setShowRestaurantSelector(false);
                      }}
                    >
                      <View>
                        <Text style={[styles.selectorItemTitle, { color: colors.text }]}>
                          {language === 'ar' ? item.name_ar : item.name || item.name}
                      </Text>
                    </View>
                    {isSelected && <Ionicons name="checkmark-circle" size={24} color={colors.primary} />}
                  </TouchableOpacity>
                );
              }}
            />
            </View>
          </View>
        </View>
      </Modal>
      
      <Toast
        visible={toastVisible}
        message={toastMessage}
        type={toastType}
        onDismiss={() => setToastVisible(false)}
      />
      {ConfirmModalNode}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  cfgCard: {
    borderRadius: 14, borderWidth: 1.5, padding: 16, marginTop: 20, gap: 4,
  },
  cfgCardHeader: {
    flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8,
  },
  cfgCardTitle: {
    fontWeight: '700', fontSize: 14,
  },
  cfgLabel: {
    fontSize: 11, fontWeight: '600', marginTop: 8, marginBottom: 3, textTransform: 'uppercase', letterSpacing: 0.5,
  },
  cfgInput: {
    borderWidth: 1, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 9, fontSize: 14, marginBottom: 2,
  },
  cfgInputMulti: {
    minHeight: 60, textAlignVertical: 'top', paddingTop: 9,
  },
  cfgDivider: {
    height: 1, marginVertical: 14,
  },
  cfgIconRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: 1, borderRadius: 8,
    paddingHorizontal: 12, paddingVertical: 10, marginBottom: 2,
  },
  cfgIconLabel: {
    flex: 1, fontSize: 14,
  },
  cfgSaveBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    borderRadius: 14, paddingVertical: 15, marginTop: 8,
  },
  cfgSaveBtnText: {
    fontWeight: '800', fontSize: 15, color: '#000',
  },
  cfgSaveNote: {
    fontSize: 11, textAlign: 'center', marginTop: 6, marginBottom: 8, lineHeight: 16,
  },

  // ── Footer Tab ──
  ftCard: {
    borderRadius: 16, borderWidth: 1, padding: 16, marginBottom: 14,
  },
  ftSectionTitle: {
    fontSize: 15, fontWeight: '800', marginBottom: 4,
  },
  ftSectionSub: {
    fontSize: 11, marginBottom: 12,
  },
  ftToggleRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: 'rgba(200,162,74,0.15)',
  },
  ftToggleLabel: {
    fontSize: 13, fontWeight: '600', flex: 1,
  },
  ftToggle: {
    width: 44, height: 26, borderRadius: 13, borderWidth: 1, justifyContent: 'center',
  },
  ftToggleThumb: {
    width: 20, height: 20, borderRadius: 10, backgroundColor: '#fff',
    shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 2, elevation: 2,
  },
  ftInputRow: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginBottom: 10,
  },
  ftInputIcon: {
    marginTop: 12,
  },
  ftInputWrap: {
    flex: 1,
  },
  ftInputLabel: {
    fontSize: 10, fontWeight: '700', letterSpacing: 0.8, textTransform: 'uppercase', marginBottom: 3,
  },
  ftInput: {
    flex: 1, borderWidth: 1, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 9,
    fontSize: 13,
  },
  ftSaveBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: '#C8A24A', borderRadius: 14, paddingVertical: 14, marginTop: 4, marginBottom: 20,
  },
  ftSaveBtnText: {
    fontSize: 14, fontWeight: '800', color: '#000',
  },
  ftBilingualLabel: {
    fontSize: 11, fontWeight: '700', letterSpacing: 0.6, marginBottom: 6,
  },
  ftTextArea: {
    borderWidth: 1, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8,
    fontSize: 13, minHeight: 52, textAlignVertical: 'top',
  },
  ftVideoUploadBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    borderWidth: 1.5, borderStyle: 'dashed', borderRadius: 10,
    paddingVertical: 12, paddingHorizontal: 16, marginTop: 10,
  },
  ftVideoUploadBtnText: {
    fontSize: 13, fontWeight: '700',
  },
  ftVideoPreviewContainer: {
    marginTop: 12, borderWidth: 1, borderRadius: 10, overflow: 'hidden',
  },
  ftVideoPreviewLabel: {
    fontSize: 11, fontWeight: '600', paddingHorizontal: 10, paddingTop: 8, paddingBottom: 6,
    letterSpacing: 0.5, textTransform: 'uppercase',
  },
  ftVideoPreviewWrapper: {
    height: 140, position: 'relative', backgroundColor: '#000',
  },
  ftVideoPreview: {
    width: '100%', height: '100%',
  },
  ftVideoPreviewOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.25)',
  },
  // Social links manager
  socialManagerRow: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    borderWidth: 1, borderRadius: 10, padding: 8, marginBottom: 8,
  },
  socialReorderCol: {
    flexDirection: 'column', alignItems: 'center', gap: 2,
  },
  socialReorderBtn: {
    width: 24, height: 24, alignItems: 'center', justifyContent: 'center',
  },
  socialDeleteBtn: {
    width: 32, height: 32, alignItems: 'center', justifyContent: 'center',
    borderRadius: 8, backgroundColor: 'rgba(239,68,68,0.08)',
  },
  addSocialBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    borderWidth: 1.5, borderStyle: 'dashed', borderRadius: 10,
    paddingVertical: 10, marginTop: 4,
  },
  addSocialBtnText: {
    fontSize: 13, fontWeight: '700',
  },
  socialPickerGrid: {
    flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10,
  },
  socialPickerItem: {
    width: '22%', alignItems: 'center', justifyContent: 'center', gap: 4,
    paddingVertical: 10, borderRadius: 10, borderWidth: 1.5,
  },
  socialPickerLabel: {
    fontSize: 9, fontWeight: '700', letterSpacing: 0.3, textAlign: 'center',
  },
  iconPickerItem: {
    flex: 1, margin: 4, alignItems: 'center', justifyContent: 'center',
    paddingVertical: 10, borderRadius: 10, borderWidth: 1.5, gap: 4,
  },
  heroBanner: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 8,
    padding: 12, borderRadius: 10, borderWidth: 1, marginBottom: 12,
  },
  heroBannerText: { flex: 1, fontSize: 12, lineHeight: 18 },
  heroCard: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    borderRadius: 12, borderWidth: 1, padding: 10, marginBottom: 10,
  },
  heroThumb: {
    width: 80, height: 54, borderRadius: 8, overflow: 'hidden',
  },
  heroIndexBadge: {
    paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6,
  },

  // ── Hero Sub-tabs ──
  heroSubTabRow: {
    flexDirection: 'row', borderRadius: 12, borderWidth: 1,
    overflow: 'hidden', marginBottom: 14,
  },
  heroSubTab: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    paddingVertical: 11, gap: 6,
  },
  heroSubTabText: { fontSize: 13, fontWeight: '700' },
  heroSubTabBadge: {
    paddingHorizontal: 6, paddingVertical: 1, borderRadius: 10, minWidth: 20, alignItems: 'center',
  },

  // ── Hero Add Button ──
  heroAddBtn: {
    borderRadius: 14, marginBottom: 14, overflow: 'hidden',
  },
  heroAddBtnInner: {
    flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14,
  },
  heroAddIcon: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: '#00000020', alignItems: 'center', justifyContent: 'center',
  },
  heroAddBtnTitle: {
    fontSize: 14, fontWeight: '800', color: '#000',
  },
  heroAddBtnSub: {
    fontSize: 11, color: '#00000070', marginTop: 2,
  },

  // ── Hero Empty State ──
  heroEmptyState: {
    borderRadius: 16, borderWidth: 1, borderStyle: 'dashed',
    padding: 32, alignItems: 'center', gap: 10, marginBottom: 8,
  },
  heroEmptyTitle: { fontSize: 15, fontWeight: '700', textAlign: 'center' },
  heroEmptySub: { fontSize: 12, textAlign: 'center', lineHeight: 18 },

  // ── Hero Image Cards ──
  heroImgCard: {
    borderRadius: 16, borderWidth: 1.5, marginBottom: 14, overflow: 'hidden',
  },
  heroImgPreviewWrap: { position: 'relative' },
  heroImgPreview: { width: '100%', height: 160 },
  heroImgOrderBadge: {
    position: 'absolute', top: 10, left: 10,
    backgroundColor: '#000000AA', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20,
  },
  heroImgOrderText: { color: '#FFD700', fontSize: 13, fontWeight: '900' },
  heroImgInactiveBanner: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    backgroundColor: '#00000080', alignItems: 'center', paddingVertical: 6,
  },
  heroImgInactiveText: { color: '#EF4444', fontSize: 12, fontWeight: '700', letterSpacing: 1 },
  heroImgMeta: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    padding: 12, paddingTop: 10,
  },
  heroImgTitle: { fontSize: 14, fontWeight: '700' },
  heroImgStatus: { fontSize: 11 },
  heroStatusDot: { width: 7, height: 7, borderRadius: 4 },
  heroImgAction: {
    width: 36, height: 36, borderRadius: 10, borderWidth: 1,
    alignItems: 'center', justifyContent: 'center',
  },

  // ── Hero Live Preview ──
  heroPreviewCard: {
    borderRadius: 16, borderWidth: 1.5, padding: 20, marginBottom: 14, gap: 8,
  },
  heroPreviewBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    alignSelf: 'flex-end', backgroundColor: '#FFD70018',
    paddingHorizontal: 8, paddingVertical: 3, borderRadius: 20, marginBottom: 6,
  },
  heroPreviewBadgeText: { fontSize: 10, color: '#FFD700', fontWeight: '700' },
  heroPreviewEyebrow: {
    fontSize: 10, color: '#FFD700', fontWeight: '700', letterSpacing: 2, textTransform: 'uppercase',
  },
  heroPreviewHeadline: {
    fontSize: 20, color: '#FFFFFF', fontWeight: '900', lineHeight: 26,
  },
  heroPreviewSubline: {
    fontSize: 12, color: '#FFFFFF90', lineHeight: 18,
  },
  heroPreviewBtns: { flexDirection: 'row', gap: 8, marginTop: 6 },
  heroPreviewPrimaryBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: '#FFD700', paddingHorizontal: 12, paddingVertical: 7, borderRadius: 20,
  },
  heroPreviewPrimaryText: { fontSize: 11, fontWeight: '800', color: '#000' },
  heroPreviewSecondaryBtn: {
    paddingHorizontal: 12, paddingVertical: 7, borderRadius: 20,
    borderWidth: 1, borderColor: '#FFFFFF40',
  },
  heroPreviewSecondaryText: { fontSize: 11, fontWeight: '700', color: '#FFFFFFCC' },

  // ── Hero Content Form Sections ──
  cfgSection: {
    borderRadius: 14, borderWidth: 1, padding: 14, marginBottom: 12, gap: 6,
  },
  cfgSectionHeader: {
    flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 6,
  },
  cfgSectionIcon: {
    width: 30, height: 30, borderRadius: 10, alignItems: 'center', justifyContent: 'center',
  },
  cfgSectionTitle: { flex: 1, fontWeight: '800', fontSize: 14 },
  cfgBtnPreview: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 8, paddingVertical: 5, borderRadius: 12, maxWidth: 90,
  },
  cfgLangRow: { gap: 8 },
  cfgLangField: { gap: 4 },
  cfgLangTag: {
    fontSize: 10, fontWeight: '900', letterSpacing: 1,
    alignSelf: 'flex-start', paddingHorizontal: 7, paddingVertical: 2, borderRadius: 6,
  },
  cfgLangInput: {
    borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14,
  },
  cfgIconPreviewBox: {
    width: 44, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center',
  },
  tabContainer: {
    flexDirection: 'row',
    marginHorizontal: 16,
    marginTop: 8,
    borderRadius: 12,
    borderWidth: 1,
    overflow: 'hidden',
  },
  tab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    gap: 8,
  },
  tabText: {
    fontWeight: '600',
    fontSize: 14,
  },
  scrollView: {
    flex: 1,
  },
  section: {
    padding: 16,
  },
  addButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 14,
    borderRadius: 12,
    gap: 8,
    marginBottom: 16,
  },
  addButtonText: {
    color: '#FFF',
    fontWeight: '600',
    fontSize: 15,
  },
  emptyState: {
    alignItems: 'center',
    paddingVertical: 40,
  },
  emptyText: {
    marginTop: 12,
    fontSize: 14,
  },
  itemCard: {
    borderRadius: 12,
    borderWidth: 1,
    padding: 14,
    marginBottom: 12,
  },
  itemHeader: {
    flexDirection: 'row',
  },
  itemImage: {
    width: 60,
    height: 60,
    borderRadius: 8,
    marginRight: 12,
  },
  itemImagePlaceholder: {
    width: 60,
    height: 60,
    borderRadius: 8,
    marginRight: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  itemInfo: {
    flex: 1,
  },
  itemTitle: {
    fontSize: 15,
    fontWeight: '600',
    marginBottom: 6,
  },
  itemBadges: {
    flexDirection: 'row',
    gap: 6,
    marginBottom: 4,
  },
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
  },
  badgeText: {
    color: '#FFF',
    fontSize: 10,
    fontWeight: '600',
  },
  itemTarget: {
    fontSize: 12,
  },
  priceRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 4,
  },
  originalPrice: {
    fontSize: 12,
    textDecorationLine: 'line-through',
  },
  discountedPrice: {
    fontSize: 12,
    fontWeight: '600',
  },
  itemActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 8,
    marginTop: 12,
  },
  actionButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  imageUploadSection: {
    marginVertical: 12,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: '90%',
  },
  selectorModal: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    height: '80%',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#E5E5E5',
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '700',
  },
  modalBody: {
    padding: 16,
  },
  modalFooter: {
    flexDirection: 'row',
    padding: 16,
    gap: 12,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 8,
    marginTop: 12,
  },
  input: {
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
    fontSize: 15,
  },
  typeSelector: {
    flexDirection: 'row',
    gap: 10,
  },
  typeOption: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: 'center',
    borderWidth: 1,
  },
  switchRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 16,
    marginBottom: 8,
  },
  selectorButton: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
    marginTop: 4,
  },
  selectedProducts: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 10,
  },
  selectedChip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 20,
    gap: 4,
  },
  cancelButton: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: 'center',
  },
  saveButton: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: 'center',
  },
  searchInput: {
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
    marginHorizontal: 16,
    marginVertical: 8,
    fontSize: 15,
  },
  selectorItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 14,
    marginHorizontal: 16,
    marginVertical: 4,
    borderRadius: 10,
    borderWidth: 1,
  },
  selectorItemTitle: {
    fontSize: 14,
    fontWeight: '500',
  },
  selectorItemSubtitle: {
    fontSize: 12,
    marginTop: 2,
  },
  flashListSelectorContainer: {
    flex: 1,
    minHeight: 300,
  },
  doneButton: {
    margin: 16,
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: 'center',
  },
});


/* __ACCESS_GUARD_APPLIED__ */
export default function MarketingSuiteScreenGuarded(props: any) {
  return (
    <__AccessGuard__ scope="admin">
      <MarketingSuiteScreen {...props} />
    </__AccessGuard__>
  );
}

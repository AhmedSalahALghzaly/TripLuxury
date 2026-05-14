/**
 * Interactive Car Selector - Performance Optimized v2
 * FIXED: Maximum update depth exceeded error
 *
 * Key Fixes:
 * 1. Isolated icon/VIN cycling into separate memoized components (no parent re-render)
 * 2. Stabilized all FlashList props with proper memoization
 * 3. Extracted theme colors as primitives to prevent reference changes
 * 4. Used refs for animation values that don't need re-renders
 */
import React, {
  useState,
  useEffect,
  useCallback,
  useMemo,
  memo,
  useRef,
} from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Dimensions,
  TextInput,
  Platform,
  Alert,
  useWindowDimensions,
} from "react-native";
import { FlashList } from "@shopify/flash-list";
import { Image } from "expo-image";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { LinearGradient } from "expo-linear-gradient";
import { BlurView } from "expo-blur";
import * as Haptics from "expo-haptics";
import { getOpenStatus, getOpenStatusFromSchedule, DayHours } from "../utils/timeUtils";
import { OpenStatusBadge } from "./OpenStatusBadge";
import {
  FuelTypeIcon,
  FuelTypeSelector,
  type FuelType,
  FUEL_TYPES,
} from "./ui/FuelTypeSelector";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withTiming,
  withSequence,
  interpolate,
  Extrapolation,
  runOnJS,
} from "react-native-reanimated";

import { useAppStore } from "../store/appStore";
import { productApi, favoritesApi, carBrandApi, carModelApi } from "../services/api";
import { ProductCardSkeleton } from "./ui/Skeleton";
import {
  AnimatedCartButton,
  AnimatedCartButtonRef,
  AnimatedFavoriteButton,
} from "./AnimatedIconButton";
import {
  useCartMutations,
  useCartQuery,
} from "../hooks/queries/useShoppingHubQuery";
import FitmentStrip from "./FitmentStrip";

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get("window");
// Note: For responsive layouts, components use useWindowDimensions() hook internally

// Food & restaurant icon sequence for morphing animation
const VEHICLE_ICONS: Array<keyof typeof MaterialCommunityIcons.glyphMap> = [
  "silverware-fork-knife",
  "food",
  "chef-hat",
  "pot-steam",
  "noodles",
  "pizza",
  "rice",
  "food-fork-drink",
  "bread-slice",
  "cake-variant",
  "coffee",
  "tea",
];

// Location animation characters
const VIN_CHARS = [
  "A",
  "V",
  "I",
  "P",
  "V",
  "I",
  "P",
  "٭",
  "◆",
  "★",
  "♦",
  "❖",
  "⬡",
  "◈",
  "⬟",
  "⬠",
  "◉",
];

// Types
interface CarBrand {
  id: string;
  name: string;
  name_ar?: string;
  logo_url?: string;
  logo?: string;
}

interface CarModel {
  id: string;
  name: string;
  name_ar?: string;
  brand_id: string;
  year_start?: number;
  year_end?: number;
  image_url?: string;
  chassis_number?: string;
  fuel_type?: string;
  hours?: DayHours[];
}

interface Product {
  id: string;
  name: string;
  name_ar?: string;
  price: number;
  image_url?: string;
  sku?: string;
}

type SelectorState =
  | "collapsed"
  | "brands"
  | "models"
  | "products"
  | "chassis_search";
type PriceFilter = "all" | "low" | "medium" | "high";

const AnimatedTouchable = Animated.createAnimatedComponent(TouchableOpacity);

// ============================================================================
// THEME CONSTANTS - Extracted to avoid object recreation
// ============================================================================
const LIGHT_COLORS = {
  background: "#FFFFFF",
  text: "#1A1A1A",
  textSecondary: "#666666",
  primary: "#2563EB",
  border: "#E5E5E5",
  error: "#EF4444",
};

const DARK_COLORS = {
  background: "#0F172A",
  text: "#F8FAFC",
  textSecondary: "#94A3B8",
  primary: "#3B82F6",
  border: "#334155",
  error: "#EF4444",
};

// ============================================================================
// ISOLATED MORPHING ICON COMPONENT - Prevents parent re-renders
// ============================================================================
interface MorphingIconProps {
  isActive: boolean;
  moodPrimary: string;
}

const MorphingIcon = memo<MorphingIconProps>(({ isActive, moodPrimary }) => {
  const [iconIndex, setIconIndex] = useState(0);

  useEffect(() => {
    if (!isActive) {
      const interval = setInterval(() => {
        setIconIndex((prev) => (prev + 1) % VEHICLE_ICONS.length);
      }, 3000);
      return () => clearInterval(interval);
    }
  }, [isActive]);

  const currentIcon = VEHICLE_ICONS[iconIndex];

  return (
    <MaterialCommunityIcons
      name={isActive ? "close" : currentIcon}
      size={30}
      color={isActive ? "#FFF" : moodPrimary}
    />
  );
});

// ============================================================================
// MEMOIZED GRID ITEM COMPONENT - For Brands & Models FlashList
// ============================================================================
interface GridItemProps {
  item: CarBrand | CarModel;
  isBrand: boolean;
  isDark: boolean;
  moodPrimary: string;
  colorsText: string;
  colorsPrimary: string;
  colorsTextSecondary: string;
  language: string;
  onPress: (item: CarBrand | CarModel, isBrand: boolean) => void;
}

const GridItem = memo<GridItemProps>(
  ({
    item,
    isBrand,
    isDark,
    moodPrimary,
    colorsText,
    colorsPrimary,
    colorsTextSecondary,
    language,
    onPress,
  }) => {
    const scale = useSharedValue(1);

    const animatedStyle = useAnimatedStyle(() => ({
      transform: [{ scale: scale.value }],
    }));

    const displayName = useMemo(
      () => (language === "ar" ? item.name_ar || item.name : item.name),
      [language, item.name, item.name_ar],
    );

    const brand = item as CarBrand;
    const model = item as CarModel;
    const hasImage = isBrand ? brand.logo_url || brand.logo : model.image_url;

    const handlePressIn = useCallback(() => {
      scale.value = withSpring(0.92, { damping: 15, stiffness: 300 });
    }, []);

    const handlePressOut = useCallback(() => {
      scale.value = withSpring(1, { damping: 13, stiffness: 200 });
    }, []);

    const handlePress = useCallback(() => {
      if (Platform.OS !== "web") {
        Haptics.selectionAsync();
      }
      onPress(item, isBrand);
    }, [item, isBrand, onPress]);

    return (
      <Animated.View style={[styles.gridItemWrapper, animatedStyle]}>
        <TouchableOpacity
          style={[
            styles.gridItem,
            {
              backgroundColor: isDark
                ? "rgba(255,255,255,0.15)"
                : "rgba(0,0,0,0.19)",
              borderColor: moodPrimary + "40",
            },
          ]}
          onPressIn={handlePressIn}
          onPressOut={handlePressOut}
          onPress={handlePress}
          activeOpacity={0.9}
        >
          {hasImage ? (
            <Image
              source={{
                uri: isBrand ? brand.logo_url || brand.logo : model.image_url,
              }}
              style={isBrand ? styles.brandLogo : styles.modelImage}
              contentFit="contain"
              cachePolicy="disk"
              transition={150}
            />
          ) : (
            <View
              style={[
                styles.placeholderIcon,
                { backgroundColor: moodPrimary + "20" },
              ]}
            >
              <MaterialCommunityIcons
                name={isBrand ? "silverware" : "silverware-fork-knife"}
                size={isBrand ? 42 : 49}
                color={moodPrimary || colorsPrimary}
              />
            </View>
          )}
          <Text
            style={[styles.gridItemText, { color: colorsText }]}
            numberOfLines={1}
          >
            {displayName}
          </Text>
          {!isBrand && (() => {
            const status =
              (Array.isArray(model.hours) && model.hours.length > 0
                ? getOpenStatusFromSchedule(model.hours, language)
                : null) ??
              getOpenStatus(model.year_start, model.year_end, language);
            return status ? <OpenStatusBadge status={status} size="sm" /> : null;
          })()}
          {!isBrand && model.fuel_type && (
            <FuelTypeIcon type={model.fuel_type} size={15} />
          )}
        </TouchableOpacity>
      </Animated.View>
    );
  },
  (prevProps, nextProps) => {
    // Custom comparison for better memoization
    return (
      prevProps.item.id === nextProps.item.id &&
      prevProps.isBrand === nextProps.isBrand &&
      prevProps.isDark === nextProps.isDark &&
      prevProps.moodPrimary === nextProps.moodPrimary &&
      prevProps.language === nextProps.language
    );
  },
);

// ============================================================================
// MEMOIZED CHASSIS MODEL CARD COMPONENT
// ============================================================================
interface ChassisCardProps {
  model: CarModel;
  brandName: string;
  isDark: boolean;
  moodPrimary: string;
  colorsText: string;
  colorsPrimary: string;
  colorsTextSecondary: string;
  language: string;
  cardWidth?: number;
  onPress: (model: CarModel) => void;
}

const ChassisModelCard = memo<ChassisCardProps>(
  ({
    model,
    brandName,
    isDark,
    moodPrimary,
    colorsText,
    colorsPrimary,
    colorsTextSecondary,
    language,
    cardWidth,
    onPress,
  }) => {
    const scale = useSharedValue(1);

    const animatedStyle = useAnimatedStyle(() => ({
      transform: [{ scale: scale.value }],
    }));

    const displayName = useMemo(
      () => (language === "ar" ? model.name_ar || model.name : model.name),
      [language, model.name, model.name_ar],
    );

    const handlePressIn = useCallback(() => {
      scale.value = withSpring(0.95, { damping: 15, stiffness: 300 });
    }, []);

    const handlePressOut = useCallback(() => {
      scale.value = withSpring(1, { damping: 13, stiffness: 200 });
    }, []);

    const handlePress = useCallback(() => {
      if (Platform.OS !== "web") {
        Haptics.selectionAsync();
      }
      onPress(model);
    }, [model, onPress]);

    return (
      <Animated.View
        style={[
          styles.chassisGridCardWrapper,
          animatedStyle,
          cardWidth ? { width: cardWidth } : null,
        ]}
      >
        <TouchableOpacity
          style={[
            styles.chassisGridCard,
            {
              backgroundColor: isDark
                ? "rgba(255,255,255,0.08)"
                : "rgba(0,0,0,0.03)",
              borderColor: moodPrimary + "40",
            },
          ]}
          onPressIn={handlePressIn}
          onPressOut={handlePressOut}
          onPress={handlePress}
          activeOpacity={0.9}
        >
          {model.image_url ? (
            <Image
              source={{ uri: model.image_url }}
              style={styles.chassisGridCardImage}
              contentFit="cover"
              cachePolicy="disk"
              transition={150}
            />
          ) : (
            <View
              style={[
                styles.chassisGridCardPlaceholder,
                { backgroundColor: moodPrimary + "15" },
              ]}
            >
              <MaterialCommunityIcons
                name="silverware-fork-knife"
                size={63}
                color={moodPrimary || colorsPrimary}
              />
            </View>
          )}
          {model.fuel_type && <FuelTypeIcon type={model.fuel_type} size={19} />}

          <View style={styles.chassisGridCardInfo}>
            <Text
              style={[styles.chassisGridCardName, { color: colorsText }]}
              numberOfLines={1}
            >
              {displayName}
            </Text>

            {(() => {
              const status =
                (Array.isArray(model.hours) && model.hours.length > 0
                  ? getOpenStatusFromSchedule(model.hours, language)
                  : null) ??
                getOpenStatus(model.year_start, model.year_end, language);
              return status ? <OpenStatusBadge status={status} size="sm" /> : null;
            })()}

            {brandName && (
              <Text
                style={[
                  styles.chassisGridCardBrand,
                  { color: moodPrimary || colorsPrimary },
                ]}
                numberOfLines={1}
              >
                {brandName}
              </Text>
            )}

            {model.chassis_number && (
              <View
                style={[
                  styles.chassisGridCardChassisContainer,
                  { backgroundColor: moodPrimary + "15" },
                ]}
              >
                <MaterialCommunityIcons
                  name="map-marker-radius"
                  size={19}
                  color={moodPrimary || colorsPrimary}
                />
                <Text
                  style={[
                    styles.chassisGridCardChassis,
                    { color: moodPrimary || colorsPrimary },
                  ]}
                  numberOfLines={1}
                >
                  {model.chassis_number}
                </Text>
              </View>
            )}
          </View>
        </TouchableOpacity>
      </Animated.View>
    );
  },
  (prevProps, nextProps) => {
    return (
      prevProps.model.id === nextProps.model.id &&
      prevProps.brandName === nextProps.brandName &&
      prevProps.isDark === nextProps.isDark &&
      prevProps.moodPrimary === nextProps.moodPrimary &&
      prevProps.language === nextProps.language
    );
  },
);

// ============================================================================
// MEMOIZED PRODUCT CARD COMPONENT
// ============================================================================
interface ProductCardProps {
  item: Product;
  isDark: boolean;
  moodPrimary: string;
  colorsText: string;
  colorsPrimary: string;
  colorsTextSecondary: string;
  language: string;
  cardWidth?: number;
  onPress: (id: string) => void;
  onAddToCart: (productId: string, fitmentIndicator?: string | null) => Promise<void>;
  checkDuplicate: (productId: string) => boolean;
  isFavorite?: boolean;
  onToggleFavorite?: (productId: string) => Promise<void>;
}

const ProductCard = memo<ProductCardProps>(
  ({
    item,
    isDark,
    moodPrimary,
    colorsText,
    colorsPrimary,
    colorsTextSecondary,
    language,
    cardWidth,
    onPress,
    onAddToCart,
    checkDuplicate,
    isFavorite = false,
    onToggleFavorite,
  }) => {
    // Fitment selection state — pulled from product or defaults
    const variantList = useMemo(
      () => (Array.isArray((item as any).available_variants) ? (item as any).available_variants : []),
      [item],
    );
    // Only treat product as fitment-aware when there are real variants OR
    // the product carries an explicit fitment_indicator. Legacy products
    // without fitment continue to render no strip and pass null on add.
    const hasFitment = variantList.length > 0 || Boolean((item as any).fitment_indicator);
    const initialFitment = useMemo(() => {
      if (!hasFitment) return null;
      if ((item as any).fitment_indicator) return String((item as any).fitment_indicator);
      const std = variantList.find((v: any) => v?.indicator === 'STD');
      return std?.indicator || variantList[0]?.indicator || null;
    }, [hasFitment, item, variantList]);
    const [selectedFitment, setSelectedFitment] = useState<string | null>(initialFitment);

    const effectivePrice = useMemo(() => {
      if (selectedFitment && variantList.length > 0) {
        const v = variantList.find((x: any) => x?.indicator === selectedFitment);
        if (v?.price !== undefined && v?.price !== null) {
          const n = parseFloat(String(v.price));
          if (Number.isFinite(n)) return n;
        }
      }
      return parseFloat(String(item.price || 0)) || 0;
    }, [selectedFitment, variantList, item.price]);
    const scale = useSharedValue(1);

    // Cart button state and refs
    const cartButtonRef = useRef<AnimatedCartButtonRef>(null);
    const [cartLoading, setCartLoading] = useState(false);
    const [addedToCart, setAddedToCart] = useState(false);
    const [favoriteLoading, setFavoriteLoading] = useState(false);

    const animatedStyle = useAnimatedStyle(() => ({
      transform: [{ scale: scale.value }],
    }));

    const displayName = useMemo(
      () => (language === "ar" ? item.name_ar || item.name : item.name),
      [language, item.name, item.name_ar],
    );

    const priceLabel = useMemo(
      () =>
        `${effectivePrice.toFixed(2)} ${language === "ar" ? "ج.م" : "EGP"}`,
      [effectivePrice, language],
    );

    const handlePressIn = useCallback(() => {
      scale.value = withSpring(0.95, { damping: 15, stiffness: 300 });
    }, []);

    const handlePressOut = useCallback(() => {
      scale.value = withSpring(1, { damping: 13, stiffness: 200 });
    }, []);

    const handlePress = useCallback(() => {
      onPress(item.id);
    }, [item.id, onPress]);

    // Handle toggle favorite
    const handleToggleFavorite = useCallback(async () => {
      if (!onToggleFavorite) return;
      setFavoriteLoading(true);
      try {
        await onToggleFavorite(item.id);
      } catch {
        // silent
      } finally {
        setFavoriteLoading(false);
      }
    }, [onToggleFavorite, item.id]);

    // Handle add to cart with duplicate checking - uses prop function
    const handleAddToCart = useCallback(async () => {
      // Check for duplicate using the passed checkDuplicate function
      if (checkDuplicate(item.id)) {
        if (cartButtonRef.current) {
          cartButtonRef.current.triggerShake();
        }
        if (Platform.OS !== "web") {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
        }
        Alert.alert(
          language === "ar" ? "تنبيه" : "Notice",
          language === "ar"
            ? "هذا المنتج موجود بالفعل في سلة التسوق"
            : "This product is already in your cart",
          [{ text: language === "ar" ? "حسناً" : "OK", style: "default" }],
          { cancelable: true },
        );
        return;
      }

      // Success path
      if (Platform.OS !== "web") {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      }

      setCartLoading(true);
      try {
        await onAddToCart(item.id, selectedFitment);
        setAddedToCart(true);
        setTimeout(() => setAddedToCart(false), 1500);
      } catch (error: any) {
        // Handle duplicate error from mutation (backup check)
        if (error?.message === "DUPLICATE_PRODUCT") {
          if (cartButtonRef.current) {
            cartButtonRef.current.triggerShake();
          }
        }
        setAddedToCart(false);
      } finally {
        setCartLoading(false);
      }
    }, [onAddToCart, checkDuplicate, item.id, language, selectedFitment]);

    return (
      <Animated.View
        style={[
          styles.productCardWrapper,
          animatedStyle,
          cardWidth ? { width: cardWidth } : null,
        ]}
      >
        <TouchableOpacity
          style={[
            styles.productCard,
            {
              // Glassmorphism Background - 30% more solid in Dark Mode
              backgroundColor: isDark
                ? "rgba(30, 41, 59, 0.7)"
                : "rgba(255, 255, 255, 0.59)",
              // Enhanced Border for Dark Mode clarity
              borderColor: isDark
                ? "rgba(255, 255, 255, 0.18)"
                : (moodPrimary || "#009688") + "30",
              borderWidth: 1.9,
              // Enhanced Shadow for Premium Depth
              ...(Platform.OS === "web"
                ? {
                    boxShadow: isDark
                      ? "0px 8px 32px rgba(0, 0, 0, 0.4), inset 0px 1px 0px rgba(255, 255, 255, 0.05)"
                      : "0px 4px 16px rgba(0, 0, 0, 0.1)",
                    backdropFilter: "blur(15px)",
                    WebkitBackdropFilter: "blur(15px)",
                  }
                : {
                    shadowColor: isDark ? "#000000" : "#000000",
                    shadowOffset: { width: 0, height: isDark ? 8 : 4 },
                    shadowOpacity: isDark ? 0.25 : 0.1,
                    shadowRadius: isDark ? 15 : 8,
                    elevation: isDark ? 12 : 6,
                  }),
            },
          ]}
          onPressIn={handlePressIn}
          onPressOut={handlePressOut}
          onPress={handlePress}
          activeOpacity={0.9}
        >
          {item.image_url ? (
            <Image
              source={{ uri: item.image_url }}
              style={styles.productImage}
              contentFit="cover"
              cachePolicy="disk"
              transition={150}
            />
          ) : (
            <View
              style={[
                styles.productPlaceholder,
                { backgroundColor: (moodPrimary || "#009688") + "15" },
              ]}
            >
              <Ionicons
                name="cube-outline"
                size={36}
                color={moodPrimary || colorsTextSecondary}
              />
            </View>
          )}
          <View style={styles.productInfo}>
            <Text
              style={[styles.productName, { color: colorsText }]}
              numberOfLines={2}
            >
              {displayName}
            </Text>
            {(variantList.length > 0 || (item as any).fitment_indicator) && (
              <View style={styles.fitmentStripWrap}>
                <FitmentStrip
                  mode={variantList.length > 1 ? 'interactive' : 'display'}
                  variants={
                    variantList.length > 0
                      ? variantList
                      : selectedFitment
                        ? [{ indicator: selectedFitment }]
                        : []
                  }
                  selected={selectedFitment}
                  onChange={(ind) => setSelectedFitment(ind)}
                  size="sm"
                  hideOutOfStock={false}
                />
              </View>
            )}
            <View style={styles.priceCartRow}>
              <View
                style={[
                  styles.priceTag,
                  { backgroundColor: (moodPrimary || "#009688") + "20" },
                ]}
              >
                <Text
                  style={[
                    styles.priceText,
                    { color: moodPrimary || colorsPrimary },
                  ]}
                >
                  {priceLabel}
                </Text>
              </View>
              {/* Favorite Button */}
              {onToggleFavorite && (
                <AnimatedFavoriteButton
                  isFavorite={isFavorite}
                  isLoading={favoriteLoading}
                  onPress={handleToggleFavorite}
                  size={11}
                  style={styles.cartButtonOverlay}
                />
              )}
              {/* Add to Cart Button - 19x19 circular miniature */}
              <AnimatedCartButton
                ref={cartButtonRef}
                isInCart={addedToCart}
                isLoading={cartLoading}
                onPress={handleAddToCart}
                size={13}
                primaryColor={moodPrimary || colorsPrimary}
                style={styles.cartButtonOverlay}
              />
            </View>
          </View>
        </TouchableOpacity>
      </Animated.View>
    );
  },
  (prevProps, nextProps) => {
    return (
      prevProps.item.id === nextProps.item.id &&
      prevProps.item.price === nextProps.item.price &&
      prevProps.isDark === nextProps.isDark &&
      prevProps.moodPrimary === nextProps.moodPrimary &&
      prevProps.language === nextProps.language &&
      prevProps.cardWidth === nextProps.cardWidth &&
      prevProps.isFavorite === nextProps.isFavorite
    );
  },
);

// ============================================================================
// FILTER CHIP COMPONENT - Isolated to prevent re-renders
// ============================================================================
interface FilterChipProps {
  filter: PriceFilter;
  isActive: boolean;
  moodPrimary: string;
  colorsText: string;
  language: string;
  onPress: (filter: PriceFilter) => void;
}

const FilterChip = memo<FilterChipProps>(
  ({ filter, isActive, moodPrimary, colorsText, language, onPress }) => {
    const handlePress = useCallback(() => {
      if (Platform.OS !== "web") {
        Haptics.selectionAsync();
      }
      onPress(filter);
    }, [filter, onPress]);

    const label = useMemo(() => {
      if (filter === "all") return language === "ar" ? "الكل" : "All";
      if (filter === "low") return "<100";
      if (filter === "medium") return "100-500";
      return ">500";
    }, [filter, language]);

    return (
      <TouchableOpacity
        style={[
          styles.filterChip,
          {
            backgroundColor: isActive ? moodPrimary : "transparent",
            borderColor: isActive ? moodPrimary : moodPrimary + "50",
          },
        ]}
        onPress={handlePress}
      >
        <Text
          style={[
            styles.filterChipText,
            { color: isActive ? "#FFF" : colorsText },
          ]}
        >
          {label}
        </Text>
      </TouchableOpacity>
    );
  },
);

// ============================================================================
// MAIN COMPONENT
// ============================================================================
export const InteractiveCarSelector: React.FC = () => {
  const router = useRouter();

  // Use reactive window dimensions for responsive layout
  const { width: windowWidth } = useWindowDimensions();

  // Extract primitives from store to avoid object recreation
  const theme = useAppStore((state) => state.theme);
  const language = useAppStore((state) => state.language);
  const isRTL = useAppStore((state) => state.isRTL);
  const currentMood = useAppStore((state) => state.currentMood);
  const carBrands = useAppStore((state) => state.carBrands);
  const carModels = useAppStore((state) => state.carModels);
  const user = useAppStore((state) => state.user);
  const setCarBrandsInStore = useAppStore((state) => state.setCarBrands);
  const setCarModelsInStore = useAppStore((state) => state.setCarModels);

  // Derived theme values - memoized
  const isDark = theme === "dark";
  const colors = useMemo(() => (isDark ? DARK_COLORS : LIGHT_COLORS), [isDark]);
  const moodPrimary = currentMood?.primary || colors.primary;

  // Local state
  const [selectorState, setSelectorState] =
    useState<SelectorState>("collapsed");
  const [selectedFuelTypes, setSelectedFuelTypes] = useState<FuelType[]>([]);
  const [openNowModelFilter, setOpenNowModelFilter] = useState(false);
  const [selectedBrand, setSelectedBrand] = useState<CarBrand | null>(null);
  const [selectedModel, setSelectedModel] = useState<CarModel | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [loadingProducts, setLoadingProducts] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [chassisSearchQuery, setChassisSearchQuery] = useState("");
  const [brandSearchQuery, setBrandSearchQuery] = useState("");
  const [modelSearchQuery, setModelSearchQuery] = useState("");
  const [priceFilter, setPriceFilter] = useState<PriceFilter>("all");
  const [favoriteProducts, setFavoriteProducts] = useState<Set<string>>(
    new Set(),
  );

  // Animation values - refs to prevent recreation
  const containerHeight = useSharedValue(70);
  const gridOpacity = useSharedValue(0);
  const productsSlideAnim = useSharedValue(SCREEN_HEIGHT);
  const carIconScale = useSharedValue(1);
  const carIconGlow = useSharedValue(0.5);
  const chassisIconGlow = useSharedValue(0.5);
  const carIconRotation = useSharedValue(0);

  // ============================================================================
  // EXPAND/COLLAPSE ANIMATIONS
  // ============================================================================
  useEffect(() => {
    const expandedHeight = Math.round(SCREEN_HEIGHT * 0.35);
    const chassisExpandedHeight = Math.round(SCREEN_HEIGHT * 0.39);

    switch (selectorState) {
      case "collapsed":
        containerHeight.value = withTiming(70, { duration: 250 });
        gridOpacity.value = withTiming(0, { duration: 200 });
        carIconScale.value = withSpring(1, { damping: 12 });
        carIconGlow.value = withTiming(0.5, { duration: 300 });
        chassisIconGlow.value = withTiming(0.5, { duration: 300 });
        productsSlideAnim.value = withTiming(SCREEN_HEIGHT, { duration: 300 });
        break;
      case "brands":
      case "models":
        containerHeight.value = withSpring(expandedHeight, { damping: 30 });
        gridOpacity.value = withTiming(1, { duration: 300 });
        carIconScale.value = withSpring(1.1, { damping: 9 });
        carIconGlow.value = withTiming(0.8, { duration: 300 });
        productsSlideAnim.value = withTiming(SCREEN_HEIGHT, { duration: 300 });
        break;
      case "chassis_search":
        containerHeight.value = withSpring(chassisExpandedHeight, {
          damping: 30,
        });
        gridOpacity.value = withTiming(1, { duration: 300 });
        chassisIconGlow.value = withTiming(0.8, { duration: 300 });
        productsSlideAnim.value = withTiming(SCREEN_HEIGHT, { duration: 300 });
        break;
      case "products":
        productsSlideAnim.value = withSpring(0, { damping: 30 });
        break;
    }
  }, [selectorState]);

  // ── Self-load brands/models when the store is empty ────────────────────────
  // useHomeScreenQuery normally populates the store, but if the home tab
  // has not mounted yet (e.g. deep-link) the selector would show nothing.
  useEffect(() => {
    if (
      (selectorState === 'brands' || selectorState === 'models' || selectorState === 'chassis_search') &&
      carBrands.length === 0
    ) {
      carBrandApi.getAll().then((res: any) => {
        const data = Array.isArray(res.data) ? res.data : (res.data?.brands || []);
        if (Array.isArray(data) && data.length > 0) setCarBrandsInStore(data);
      }).catch(() => {});
    }
    if (
      (selectorState === 'models' || selectorState === 'chassis_search') &&
      carModels.length === 0
    ) {
      carModelApi.getAll().then((res: any) => {
        const data = Array.isArray(res.data) ? res.data : (res.data?.models || []);
        if (Array.isArray(data) && data.length > 0) setCarModelsInStore(data);
      }).catch(() => {});
    }
  }, [selectorState, carBrands.length, carModels.length, setCarBrandsInStore, setCarModelsInStore]);

  // ============================================================================
  // ANIMATED STYLES - Stable dependencies
  // ============================================================================
  const containerStyle = useAnimatedStyle(() => ({
    height: containerHeight.value,
  }));

  const gridStyle = useAnimatedStyle(() => ({
    opacity: gridOpacity.value,
  }));

  const carIconStyle = useAnimatedStyle(() => ({
    transform: [
      { scale: carIconScale.value },
      { rotate: `${carIconRotation.value}deg` },
    ],
    shadowOpacity: interpolate(
      carIconGlow.value,
      [0, 1],
      [0.2, 0.6],
      Extrapolation.CLAMP,
    ),
    shadowRadius: interpolate(
      carIconGlow.value,
      [0, 1],
      [4, 12],
      Extrapolation.CLAMP,
    ),
  }));

  const chassisIconStyle = useAnimatedStyle(() => ({
    shadowOpacity: interpolate(
      chassisIconGlow.value,
      [0, 1],
      [0.2, 0.6],
      Extrapolation.CLAMP,
    ),
    shadowRadius: interpolate(
      chassisIconGlow.value,
      [0, 1],
      [4, 12],
      Extrapolation.CLAMP,
    ),
  }));

  // Products panel visibility state for web platform fix
  const [isPanelVisible, setIsPanelVisible] = useState(false);

  // Track panel visibility based on selectorState
  useEffect(() => {
    if (selectorState === "products") {
      setIsPanelVisible(true);
    } else {
      // Delay hiding to allow animation to complete
      const timer = setTimeout(() => {
        setIsPanelVisible(false);
      }, 350);
      return () => clearTimeout(timer);
    }
  }, [selectorState]);

  const productsPanelStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: productsSlideAnim.value }],
  }));

  // --- Dynamic Grid Calculation for Products in Bottom Sheet ---
  // This logic creates a pixel-perfect, responsive grid for the products list.
  const { productNumColumns, productCardWidth } = useMemo(() => {
    // 1. Define the specific layout constants for this grid.
    const GAP = 3.5; // As requested, we keep 3.5px
    const MAX_CARD_WIDTH = 179; // The absolute maximum width a card can have.
    const MIN_COLUMNS = 3; // The required minimum number of columns.

    // 2. Calculate the available width for content.
    // The padding is now managed by this logic, not by StyleSheet.
    const PADDING_HORIZONTAL = GAP * 3;
    const availableWidth = windowWidth - PADDING_HORIZONTAL;

    // 3. Calculate the ideal number of columns needed to NOT exceed MAX_CARD_WIDTH.
    // This is the core of the responsive logic.
    const idealCols = Math.ceil(availableWidth / (MAX_CARD_WIDTH + GAP));

    // 4. Enforce the minimum number of columns required for this specific design.
    const finalNumColumns = Math.max(MIN_COLUMNS, idealCols);

    // 5. Calculate the final, exact card width to perfectly fill the space.
    // This value will now always be <= MAX_CARD_WIDTH.
    const totalInternalGaps = GAP * (finalNumColumns - 1);
    const finalCardWidth =
      (availableWidth - totalInternalGaps) / finalNumColumns;

    if (__DEV__) {
      console.log(
        `[Product Grid (Sheet) Debug] Screen: ${windowWidth}px, Cols: ${finalNumColumns}, CardWidth: ${finalCardWidth.toFixed(2)}px`,
      );
    }

    return {
      productNumColumns: finalNumColumns,
      productCardWidth: finalCardWidth,
    };
  }, [windowWidth]);

  // Calculate chassis card width: min 137px, max 150px, show 2.3+ on wider screens
  const chassisCardWidth = useMemo(() => {
    const CHASSIS_MIN = 190;
    const CHASSIS_MAX = 199;
    const GAP = 10;
    // Number of fully-visible cards that fit with CHASSIS_MAX size
    const numCols = Math.max(2, Math.floor(windowWidth / (CHASSIS_MAX + GAP)));
    const computed = (windowWidth - GAP * (numCols + 1)) / numCols;
    return Math.min(CHASSIS_MAX, Math.max(CHASSIS_MIN, computed));
  }, [windowWidth]);

  // ============================================================================
  // DATA HELPERS - Memoized
  // ============================================================================
  const getName = useCallback(
    (item: { name: string; name_ar?: string }) =>
      language === "ar" ? item.name_ar || item.name : item.name,
    [language],
  );

  // Load favorites when user is logged in
  useEffect(() => {
    if (!user) {
      setFavoriteProducts(new Set());
      return;
    }
    favoritesApi
      .getAll()
      .then((r) => {
        const ids = new Set<string>(
          (r.data || []).map((f: any) => f.product_id || f.id),
        );
        setFavoriteProducts(ids);
      })
      .catch(() => {});
  }, [user]);

  // Toggle a product in/out of favorites
  const handleToggleFavorite = useCallback(
    async (productId: string) => {
      if (!user) return;
      try {
        const res = await favoritesApi.toggle(productId);
        setFavoriteProducts((prev) => {
          const next = new Set(prev);
          if (res.data.is_favorite) {
            next.add(productId);
          } else {
            next.delete(productId);
          }
          return next;
        });
      } catch {}
    },
    [user],
  );

  const displayBrands = useMemo(() => {
    const all = carBrands.slice(0, 50);
    if (!brandSearchQuery.trim()) return all.slice(0, 9);
    const q = brandSearchQuery.toLowerCase().trim();
    return all.filter(
      (b) =>
        b.name?.toLowerCase().includes(q) || (b as any).name_ar?.includes(q),
    );
  }, [carBrands, brandSearchQuery]);

  const filteredModels = useMemo(() => {
    if (!selectedBrand) return [];
    let all = carModels.filter((m) => m.brand_id === selectedBrand.id);
    if (selectedFuelTypes.length > 0) {
      all = all.filter((m) =>
        selectedFuelTypes.includes(m.fuel_type as FuelType),
      );
    }
    if (openNowModelFilter) {
      all = all.filter((m) => {
        const status = getOpenStatus(m.year_start, m.year_end, language);
        return status?.isOpen === true;
      });
    }
    if (!modelSearchQuery.trim()) return all.slice(0, 9);
    const q = modelSearchQuery.toLowerCase().trim();
    return all.filter(
      (m) => m.name?.toLowerCase().includes(q) || m.name_ar?.includes(q),
    );
  }, [carModels, selectedBrand, modelSearchQuery, selectedFuelTypes, openNowModelFilter, language]);

  const chassisFilteredModels = useMemo(() => {
    if (!chassisSearchQuery.trim()) return carModels.slice(0, 12);
    const query = chassisSearchQuery.toLowerCase().trim();
    return carModels
      .filter(
        (m) =>
          m.chassis_number?.toLowerCase().includes(query) ||
          m.name?.toLowerCase().includes(query) ||
          m.name_ar?.includes(query),
      )
      .slice(0, 12);
  }, [carModels, chassisSearchQuery]);

  const filteredProducts = useMemo(() => {
    let result = [...products];

    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      result = result.filter(
        (p) =>
          p.name?.toLowerCase().includes(query) ||
          p.name_ar?.includes(query) ||
          p.sku?.toLowerCase().includes(query),
      );
    }

    if (priceFilter !== "all") {
      result = result.filter((p) => {
        switch (priceFilter) {
          case "low":
            return p.price < 100;
          case "medium":
            return p.price >= 100 && p.price <= 500;
          case "high":
            return p.price > 500;
          default:
            return true;
        }
      });
    }

    return result;
  }, [products, searchQuery, priceFilter]);

  const brandMap = useMemo(() => {
    const map: Record<string, string> = {};
    carBrands.forEach((b) => {
      map[b.id] = language === "ar" ? b.name_ar || b.name : b.name;
    });
    return map;
  }, [carBrands, language]);

  // Display all products without limit
  const displayProducts = useMemo(() => filteredProducts, [filteredProducts]);

  // ============================================================================
  // API CALLS
  // ============================================================================
  const fetchProductsForModel = useCallback(async (modelId: string) => {
    setLoadingProducts(true);
    try {
      // Use reasonable limit to avoid 422 errors
      const response = await productApi.getAll({
        car_model_id: modelId,
        limit: 100,
      });
      const productsData = response.data?.products || [];
      setProducts(productsData);

      if (Platform.OS !== "web") {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }
    } catch (error) {
      console.error("Error fetching products:", error);
      setProducts([]);
    } finally {
      setLoadingProducts(false);
    }
  }, []);

  // ============================================================================
  // EVENT HANDLERS - Stable callbacks
  // ============================================================================
  const handleCarAnchorPress = useCallback(() => {
    if (Platform.OS !== "web") {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }

    if (selectorState === "collapsed" || selectorState === "chassis_search") {
      carIconRotation.value = withSequence(
        withTiming(720, { duration: 600 }),
        withSpring(0, { damping: 8, stiffness: 100, mass: 0.5 }),
      );
      setSelectorState("brands");
    } else {
      carIconRotation.value = withSequence(
        withTiming(-720, { duration: 600 }),
        withSpring(0, { damping: 8, stiffness: 100, mass: 0.5 }),
      );
      setSelectorState("collapsed");
      setSelectedBrand(null);
      setSelectedModel(null);
      setProducts([]);
      setSearchQuery("");
    }
  }, [selectorState]);

  const handleChassisAnchorPress = useCallback(() => {
    if (Platform.OS !== "web") {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    if (
      selectorState === "collapsed" ||
      selectorState === "brands" ||
      selectorState === "models"
    ) {
      setSelectorState("chassis_search");
      setSelectedBrand(null);
      setSelectedModel(null);
      setSearchQuery("");
    } else {
      setSelectorState("collapsed");
      setChassisSearchQuery("");
    }
  }, [selectorState]);

  const handleGridItemPress = useCallback(
    async (item: CarBrand | CarModel, isBrand: boolean) => {
      if (isBrand) {
        setSelectedBrand(item as CarBrand);
        setSelectorState("models");
      } else {
        setSelectedModel(item as CarModel);
        setSelectorState("products"); // Set state to 'products' to show loading skeleton
        await fetchProductsForModel((item as CarModel).id); // Await the product fetching
      }
    },
    [fetchProductsForModel],
  );

  const handleChassisModelPress = useCallback(
    async (model: CarModel) => {
      setSelectedModel(model);
      const brand = carBrands.find((b) => b.id === model.brand_id);
      if (brand) setSelectedBrand(brand);
      setSelectorState("products"); // Set state to 'products' to show loading skeleton
      await fetchProductsForModel(model.id); // Await the product fetching
    },
    [carBrands, fetchProductsForModel],
  );

  const handleProductPress = useCallback(
    (productId: string) => {
      if (Platform.OS !== "web") {
        Haptics.selectionAsync();
      }
      router.push(`/product/${productId}`);
    },
    [router],
  );

  // Fetch cart data to ensure real-time duplicate checking
  const { data: cartItems = [] } = useCartQuery(true);

  // Cart mutations for adding products - single source of truth
  const { addToCart, checkBundleConflict: checkBundleConflictFromHook } =
    useCartMutations();

  // BUNDLE-ONLY duplicate check: blocks the add only if the product is already
  // in the cart as part of a bundle. Non-bundle duplicates are allowed — the
  // cart store merges them by fitment indicator into the same grouped card.
  const checkDuplicate = useCallback(
    (productId: string): boolean => {
      // First check using the hook's bundle-conflict check (reads from queryClient)
      if (checkBundleConflictFromHook(productId)) {
        return true;
      }

      // Fallback: also check directly from cartItems (fresh data from useCartQuery)
      // Block ONLY when the matching item is part of a bundle.
      if (cartItems && cartItems.length > 0) {
        return cartItems.some(
          (item: any) =>
            (item.product_id === productId ||
              item.productId === productId ||
              item.id === productId) &&
            !!(item.bundle_group_id || item.bundleGroupId),
        );
      }

      return false;
    },
    [checkBundleConflictFromHook, cartItems],
  );

  // Handle adding product to cart from ProductCard
  const handleProductAddToCart = useCallback(
    async (productId: string, fitmentIndicator?: string | null) => {
      try {
        await addToCart.mutateAsync({
          productId,
          quantity: 1,
          fitmentIndicator: fitmentIndicator ?? null,
        });
      } catch (error: any) {
        // Re-throw duplicate errors for ProductCard to handle shake animation
        if (error?.message === "DUPLICATE_PRODUCT") {
          throw error;
        }
        console.error("Error adding to cart:", error);
      }
    },
    [addToCart],
  );

  const handleFuelTypeToggle = useCallback((type: FuelType) => {
    setSelectedFuelTypes((prev) =>
      prev.includes(type) ? prev.filter((t) => t !== type) : [...prev, type],
    );
  }, []);

  const handleBackToBrands = useCallback(() => {
    if (Platform.OS !== "web") {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    setSelectorState("brands");
    setSelectedBrand(null);
    setSelectedModel(null);
    setSelectedFuelTypes([]);
    setProducts([]);
  }, []);

  const handleBackToModels = useCallback(() => {
    if (Platform.OS !== "web") {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    setSelectorState("models");
    setSelectedModel(null);
    setProducts([]);
  }, []);

  const handleViewAll = useCallback(() => {
    if (Platform.OS !== "web") {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    if (selectorState === "brands") {
      router.push("/car-brands");
    } else if (selectedBrand) {
      router.push(`/brand/${selectedBrand.id}`);
    }
    setSelectorState("collapsed");
  }, [selectorState, selectedBrand, router]);

  const handleCloseProducts = useCallback(() => {
    if (Platform.OS !== "web") {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    setSelectorState("collapsed");
  }, []);

  const handleFilterPress = useCallback((filter: PriceFilter) => {
    setPriceFilter(filter);
  }, []);

  const handleClearChassisSearch = useCallback(() => {
    setChassisSearchQuery("");
  }, []);

  const handleClearSearch = useCallback(() => {
    setSearchQuery("");
  }, []);

  // ============================================================================
  // FLASHLIST RENDER ITEMS - Stable with minimal dependencies
  // ============================================================================
  const isBrandsView = selectorState === "brands";

  const renderGridItem = useCallback(
    ({ item }: { item: CarBrand | CarModel }) => (
      <GridItem
        item={item}
        isBrand={isBrandsView}
        isDark={isDark}
        moodPrimary={moodPrimary}
        colorsText={colors.text}
        colorsPrimary={colors.primary}
        colorsTextSecondary={colors.textSecondary}
        language={language}
        onPress={handleGridItemPress}
      />
    ),
    [
      isBrandsView,
      isDark,
      moodPrimary,
      colors.text,
      colors.primary,
      colors.textSecondary,
      language,
      handleGridItemPress,
    ],
  );

  const renderChassisItem = useCallback(
    ({ item }: { item: CarModel }) => (
      <ChassisModelCard
        model={item}
        brandName={brandMap[item.brand_id] || ""}
        isDark={isDark}
        moodPrimary={moodPrimary}
        colorsText={colors.text}
        colorsPrimary={colors.primary}
        colorsTextSecondary={colors.textSecondary}
        language={language}
        cardWidth={chassisCardWidth}
        onPress={handleChassisModelPress}
      />
    ),
    [
      brandMap,
      isDark,
      moodPrimary,
      colors.text,
      colors.primary,
      colors.textSecondary,
      language,
      chassisCardWidth,
      handleChassisModelPress,
    ],
  );

  const renderProductItem = useCallback(
    ({ item }: { item: Product }) => (
      <ProductCard
        item={item}
        isDark={isDark}
        moodPrimary={moodPrimary}
        colorsText={colors.text}
        colorsPrimary={colors.primary}
        colorsTextSecondary={colors.textSecondary}
        language={language}
        cardWidth={productCardWidth}
        onPress={handleProductPress}
        onAddToCart={handleProductAddToCart}
        checkDuplicate={checkDuplicate}
        isFavorite={favoriteProducts.has(item.id)}
        onToggleFavorite={user ? handleToggleFavorite : undefined}
      />
    ),
    [
      isDark,
      moodPrimary,
      colors.text,
      colors.primary,
      colors.textSecondary,
      language,
      productCardWidth,
      handleProductPress,
      handleProductAddToCart,
      checkDuplicate,
      favoriteProducts,
      user,
      handleToggleFavorite,
    ],
  );

  const renderFilterItem = useCallback(
    ({ item }: { item: PriceFilter }) => (
      <FilterChip
        filter={item}
        isActive={priceFilter === item}
        moodPrimary={moodPrimary}
        colorsText={colors.text}
        language={language}
        onPress={handleFilterPress}
      />
    ),
    [priceFilter, moodPrimary, colors.text, language, handleFilterPress],
  );

  // ============================================================================
  // FLASHLIST KEY EXTRACTORS - Stable
  // ============================================================================
  const keyExtractor = useCallback((item: { id: string }) => item.id, []);
  const filterKeyExtractor = useCallback((item: PriceFilter) => item, []);

  // Filter data
  const filterData = useMemo<PriceFilter[]>(
    () => ["all", "low", "medium", "high"],
    [],
  );

  // Grid data based on state
  const gridData = selectorState === "brands" ? displayBrands : filteredModels;

  // Determine if car anchor is active
  const isCarAnchorActive =
    selectorState === "brands" ||
    selectorState === "models" ||
    selectorState === "products";

  // ============================================================================
  // VIEW ALL FOOTER COMPONENT - Memoized
  // ============================================================================
  const ViewAllFooter = useMemo(
    () => (
      <TouchableOpacity
        style={[
          styles.gridItem,
          styles.viewAllItem,
          {
            backgroundColor: moodPrimary + "15",
            borderColor: moodPrimary,
          },
        ]}
        onPress={handleViewAll}
      >
        <View
          style={[
            styles.placeholderIcon,
            { backgroundColor: moodPrimary + "25" },
          ]}
        >
          <Ionicons name="grid" size={30} color={moodPrimary} />
        </View>
        <Text
          style={[
            styles.gridItemText,
            { color: moodPrimary, fontWeight: "700" },
          ]}
        >
          {language === "ar" ? "عرض الكل" : "View All"}
        </Text>
      </TouchableOpacity>
    ),
    [moodPrimary, language, handleViewAll],
  );

  // ============================================================================
  // RENDER
  // ============================================================================
  return (
    <>
      {/* Main Selector Container */}
      <Animated.View
        style={[
          styles.container,
          {
            backgroundColor: "transparent",
            borderTopColor: moodPrimary,
          },
          containerStyle,
        ]}
      >
        {/* Glassmorphism Background */}
        <View style={StyleSheet.absoluteFill}>
          <BlurView
            intensity={isDark ? 50 : 55}
            tint={isDark ? "dark" : "light"}
            style={StyleSheet.absoluteFill}
          />
          <LinearGradient
            colors={[
              moodPrimary + "25",
              "rgba(255,255,255,0.3)",
              moodPrimary + "18",
            ]}
            style={StyleSheet.absoluteFill}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
          />
          <View
            style={[
              StyleSheet.absoluteFill,
              {
                backgroundColor: isDark
                  ? "rgba(15, 23, 42, 0.7)"
                  : "rgba(255, 255, 255, 0.7)",
              },
            ]}
          />
        </View>

        {/* Neon border glow */}
        <View
          style={[
            styles.neonBorder,
            { backgroundColor: moodPrimary, shadowColor: moodPrimary },
          ]}
        />

        {/* Dual Anchor Button Row */}
        <View style={styles.anchorRow}>
          {/* LEFT Button: Chassis Selector */}
          <AnimatedTouchable
            style={[
              styles.anchorButton,
              {
                backgroundColor:
                  selectorState === "chassis_search"
                    ? moodPrimary
                    : isDark
                      ? "rgba(255,255,255,0.1)"
                      : "rgba(0,0,0,0.05)",
                borderColor: moodPrimary,
                shadowColor: moodPrimary,
              },
              chassisIconStyle,
            ]}
            onPress={handleChassisAnchorPress}
            activeOpacity={0.8}
          >
            {selectorState === "chassis_search" ? (
              <Ionicons name="close" size={26} color="#FFF" />
            ) : (
              <MaterialCommunityIcons
                name="map-marker-radius"
                size={24}
                color={moodPrimary}
              />
            )}
          </AnimatedTouchable>

          {/* Center Content */}
          {selectorState === "collapsed" ? (
            <View style={styles.hintContainer}>
              <View style={styles.dualHintRow}>
                <TouchableOpacity
                  style={styles.hintTouchable}
                  onPress={handleChassisAnchorPress}
                >
                  <Text style={[styles.hintText, { color: colors.text }]}>
                    {language === "ar" ? "ابحث بالعنوان" : "Special Location"}
                  </Text>
                </TouchableOpacity>
                <View
                  style={[
                    styles.hintDivider,
                    { backgroundColor: colors.border },
                  ]}
                />
                <TouchableOpacity
                  style={styles.hintTouchable}
                  onPress={handleCarAnchorPress}
                >
                  <Text style={[styles.hintText, { color: colors.text }]}>
                    {language === "ar" ? "اختر مطعمك" : "Pick Restaurant"}
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          ) : selectorState === "chassis_search" ? (
            <Animated.View style={[styles.chassisSearchContainer, gridStyle]}>
              <View
                style={[
                  styles.chassisSearchBox,
                  {
                    backgroundColor: isDark
                      ? "rgba(255,255,255,0.07)"
                      : "rgba(0,0,0,0.03)",
                    borderColor: moodPrimary + "50",
                  },
                ]}
              >
                <MaterialCommunityIcons
                  name="map-marker-radius"
                  size={20}
                  color={moodPrimary}
                />
                <TextInput
                  style={[
                    styles.chassisSearchInput,
                    { color: colors.text, textAlign: isRTL ? "right" : "left" },
                  ]}
                  placeholder={
                    language === "ar"
                      ? "ابحث باسم المكان أو المطعم..."
                      : "Search by location or restaurant..."
                  }
                  placeholderTextColor={colors.textSecondary}
                  value={chassisSearchQuery}
                  onChangeText={setChassisSearchQuery}
                  autoCapitalize="words"
                />
                {chassisSearchQuery.length > 0 && (
                  <TouchableOpacity onPress={handleClearChassisSearch}>
                    <Ionicons
                      name="close-circle"
                      size={18}
                      color={colors.textSecondary}
                    />
                  </TouchableOpacity>
                )}
              </View>
            </Animated.View>
          ) : (
            <Animated.View
              style={[
                styles.breadcrumb,
                gridStyle,
                isRTL && styles.breadcrumbRTL,
              ]}
            >
              {/* Brand thumbnail - press goes to models (if in products) or brands (if in models) */}
              {selectedBrand && (
                <TouchableOpacity
                  style={[
                    styles.breadcrumbItem,
                    {
                      backgroundColor: isDark
                        ? "rgba(255,255,255,0.1)"
                        : "rgba(0,0,0,0.05)",
                      borderColor: moodPrimary + "40",
                    },
                  ]}
                  onPress={
                    selectorState === "products"
                      ? handleBackToModels
                      : handleBackToBrands
                  }
                >
                  {selectedBrand.logo_url || selectedBrand.logo ? (
                    <Image
                      source={{
                        uri: selectedBrand.logo_url || selectedBrand.logo,
                      }}
                      style={styles.breadcrumbLogo}
                      contentFit="contain"
                    />
                  ) : (
                    <MaterialCommunityIcons
                      name="silverware"
                      size={24}
                      color={moodPrimary}
                    />
                  )}
                </TouchableOpacity>
              )}

              {/* Fuel type filter icons + Open Now toggle - shown when browsing models */}
              {selectedBrand &&
                !selectedModel &&
                selectorState === "models" && (
                  <View style={styles.breadcrumbFuelRow}>
                    {FUEL_TYPES.map((ft) => {
                      const isSelected = selectedFuelTypes.includes(ft.key);
                      return (
                        <TouchableOpacity
                          key={ft.key}
                          onPress={() => handleFuelTypeToggle(ft.key)}
                          style={[
                            styles.breadcrumbFuelIcon,
                            {
                              backgroundColor: isSelected
                                ? ft.color + "30"
                                : isDark
                                  ? "rgba(255,255,255,0.07)"
                                  : "rgba(0,0,0,0.03)",
                              borderColor: isSelected
                                ? ft.color
                                : isDark
                                  ? "rgba(255,255,255,0.15)"
                                  : "rgba(0,0,0,0.1)",
                            },
                          ]}
                        >
                          <Ionicons
                            name={ft.icon}
                            size={22}
                            color={
                              isSelected
                                ? ft.color
                                : isDark
                                  ? "rgba(255,255,255,0.5)"
                                  : "rgba(0,0,0,0.4)"
                            }
                          />
                        </TouchableOpacity>
                      );
                    })}
                    {/* Open Now toggle chip */}
                    <TouchableOpacity
                      onPress={() => setOpenNowModelFilter((v) => !v)}
                      style={[
                        styles.breadcrumbFuelIcon,
                        {
                          flexDirection: "row",
                          paddingHorizontal: 8,
                          gap: 4,
                          width: "auto",
                          backgroundColor: openNowModelFilter
                            ? "#16a34a30"
                            : isDark
                              ? "rgba(255,255,255,0.07)"
                              : "rgba(0,0,0,0.03)",
                          borderColor: openNowModelFilter
                            ? "#16a34a"
                            : isDark
                              ? "rgba(255,255,255,0.15)"
                              : "rgba(0,0,0,0.1)",
                        },
                      ]}
                    >
                      <View
                        style={{
                          width: 7,
                          height: 7,
                          borderRadius: 4,
                          backgroundColor: openNowModelFilter
                            ? "#16a34a"
                            : isDark
                              ? "rgba(255,255,255,0.4)"
                              : "rgba(0,0,0,0.3)",
                          alignSelf: "center",
                        }}
                      />
                      <Text
                        style={{
                          fontSize: 11,
                          fontWeight: "600",
                          color: openNowModelFilter
                            ? "#16a34a"
                            : isDark
                              ? "rgba(255,255,255,0.5)"
                              : "rgba(0,0,0,0.4)",
                        }}
                      >
                        {language === "ar" ? "مفتوح الآن" : "Open Now"}
                      </Text>
                    </TouchableOpacity>
                  </View>
                )}

              {/* Model thumbnail - image only, press opens products */}
              {selectedModel && (
                <TouchableOpacity
                  style={[
                    styles.breadcrumbItem,
                    {
                      backgroundColor: moodPrimary + "25",
                      borderColor: moodPrimary + "60",
                    },
                  ]}
                  onPress={() => setSelectorState("products")}
                >
                  {selectedModel.image_url ? (
                    <Image
                      source={{ uri: selectedModel.image_url }}
                      style={styles.breadcrumbLogo}
                      contentFit="contain"
                      cachePolicy="disk"
                    />
                  ) : (
                    <MaterialCommunityIcons
                      name="silverware-fork-knife"
                      size={24}
                      color={moodPrimary}
                    />
                  )}
                </TouchableOpacity>
              )}
            </Animated.View>
          )}

          {/* RIGHT Button: Car Selector */}
          <AnimatedTouchable
            style={[
              styles.anchorButton,
              {
                backgroundColor: isCarAnchorActive
                  ? moodPrimary
                  : isDark
                    ? "rgba(255,255,255,0.1)"
                    : "rgba(0,0,0,0.03)",
                borderColor: moodPrimary,
                shadowColor: moodPrimary,
              },
              carIconStyle,
            ]}
            onPress={handleCarAnchorPress}
            activeOpacity={0.8}
          >
            <MorphingIcon
              isActive={isCarAnchorActive}
              moodPrimary={moodPrimary}
            />
          </AnimatedTouchable>
        </View>

        {/* Brands/Models FlashList - Horizontal */}
        {(selectorState === "brands" || selectorState === "models") && (
          <Animated.View style={[styles.gridContainer, gridStyle]}>
            {/* Search bar for brands or models */}
            <View
              style={[
                styles.brandModelSearchBar,
                {
                  borderColor: moodPrimary + "40",
                  backgroundColor: isDark
                    ? "rgba(255,255,255,0.07)"
                    : "rgba(0,0,0,0.05)",
                },
              ]}
            >
              <Ionicons
                name="search"
                size={15}
                color={colors.textSecondary}
                style={{ marginHorizontal: 7 }}
              />
              <TextInput
                style={[styles.brandModelSearchInput, { color: colors.text }]}
                placeholder={
                  selectorState === "brands"
                    ? language === "ar"
                      ? "ابحث عن اكلة..."
                      : "Search Cuisines..."
                    : language === "ar"
                      ? "ابحث عن مطعم..."
                      : "Search Restaurants..."
                }
                placeholderTextColor={colors.textSecondary}
                value={
                  selectorState === "brands"
                    ? brandSearchQuery
                    : modelSearchQuery
                }
                onChangeText={
                  selectorState === "brands"
                    ? setBrandSearchQuery
                    : setModelSearchQuery
                }
                returnKeyType="search"
              />
              {(selectorState === "brands"
                ? brandSearchQuery
                : modelSearchQuery
              ).length > 0 && (
                <TouchableOpacity
                  onPress={() =>
                    selectorState === "brands"
                      ? setBrandSearchQuery("")
                      : setModelSearchQuery("")
                  }
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  <Ionicons
                    name="close-circle"
                    size={19}
                    color={colors.textSecondary}
                  />
                </TouchableOpacity>
              )}
            </View>
            <FlashList
              data={gridData}
              horizontal
              keyExtractor={keyExtractor}
              renderItem={renderGridItem}
              estimatedItemSize={139}
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.horizontalListContent}
              ListFooterComponent={ViewAllFooter}
              extraData={isBrandsView}
            />
          </Animated.View>
        )}

        {/* Chassis Search Results - Horizontal Layout */}
        {selectorState === "chassis_search" && (
          <Animated.View style={[styles.chassisResultsContainer, gridStyle]}>
            {chassisFilteredModels.length === 0 ? (
              <View style={styles.chassisEmptyState}>
                <MaterialCommunityIcons
                  name="silverware-clean"
                  size={40}
                  color={colors.textSecondary}
                />
                <Text
                  style={[
                    styles.chassisEmptyText,
                    { color: colors.textSecondary },
                  ]}
                >
                  {language === "ar" ? "لا توجد نتائج" : "No results found"}
                </Text>
              </View>
            ) : (
              <FlashList
                data={chassisFilteredModels}
                horizontal
                keyExtractor={keyExtractor}
                renderItem={renderChassisItem}
                estimatedItemSize={chassisCardWidth}
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.horizontalListContent}
              />
            )}
          </Animated.View>
        )}
      </Animated.View>

      {/* Products Floating Panel */}
      <Animated.View
        style={[
          styles.productsPanel,
          productsPanelStyle,
          // Web platform fix: Hide panel completely when not in products state
          Platform.OS === "web" &&
            !isPanelVisible && {
              display: "none",
              pointerEvents: "none",
            },
        ]}
      >
        <BlurView
          intensity={isDark ? 50 : 55}
          tint={isDark ? "dark" : "light"}
          style={StyleSheet.absoluteFill}
        />
        <View
          style={[
            StyleSheet.absoluteFill,
            {
              backgroundColor: isDark
                ? "rgba(5, 79, 107,0.39)"
                : "rgba(213,219,222,0.39)",
            },
          ]}
        />

        {/* Header */}
        <LinearGradient
          colors={[moodPrimary + "30", "transparent"]}
          style={styles.productsPanelHeaderGradient}
        >
          <View
            style={[
              styles.productsPanelHeader,
              { borderBottomColor: moodPrimary + "30" },
            ]}
          >
            <TouchableOpacity
              style={[
                styles.backButton,
                {
                  backgroundColor: isDark
                    ? "rgba(255,255,255,0.7)"
                    : "rgba(255,255,255,0.7)",
                  borderColor: moodPrimary + "40",
                },
              ]}
              onPress={handleBackToModels}
            >
              <Ionicons
                name={isRTL ? "chevron-forward" : "chevron-back"}
                size={24}
                color={moodPrimary}
              />
            </TouchableOpacity>
            <View style={styles.headerTitleContainer}>
              <Text style={[styles.headerTitle, { color: colors.text }]}>
                {selectedModel ? getName(selectedModel) : ""}
              </Text>
              <View
                style={[
                  styles.productCountBadge,
                  { backgroundColor: moodPrimary + "4D" },
                ]}
              >
                <Text style={[styles.headerSubtitle, { color: moodPrimary }]}>
                  {filteredProducts.length}{" "}
                  {language === "ar" ? "منتج" : "products"}
                </Text>
              </View>
            </View>
            <TouchableOpacity
              style={[
                styles.closeButton,
                {
                  backgroundColor: colors.error + "20",
                  borderColor: colors.error + "40",
                },
              ]}
              onPress={handleCloseProducts}
            >
              <Ionicons name="close" size={30} color={colors.error} />
            </TouchableOpacity>
          </View>
        </LinearGradient>

        {/* Search & Filters */}
        <View
          style={[
            styles.filtersRow,
            {
              backgroundColor: isDark
                ? "rgba(305,315,319,0.13)"
                : "rgba(305,315,319,0.19)",
              borderBottomColor: moodPrimary + "4D",
            },
          ]}
        >
          <View
            style={[
              styles.searchBox,
              {
                backgroundColor: isDark
                  ? "rgba(130,147,153,0.39)"
                  : "rgba(128,186,217,0.39)",
                borderColor: moodPrimary + "50",
              },
            ]}
          >
            <Ionicons name="search" size={18} color={moodPrimary} />
            <TextInput
              style={[
                styles.searchInput,
                { color: colors.text, textAlign: isRTL ? "right" : "left" },
              ]}
              placeholder={language === "ar" ? "بحث..." : "Search..."}
              placeholderTextColor={colors.textSecondary}
              value={searchQuery}
              onChangeText={setSearchQuery}
            />
            {searchQuery.length > 0 && (
              <TouchableOpacity onPress={handleClearSearch}>
                <Ionicons
                  name="close-circle"
                  size={18}
                  color={colors.textSecondary}
                />
              </TouchableOpacity>
            )}
          </View>
          <View style={styles.filterChipsContainer}>
            <FlashList
              data={filterData}
              horizontal
              estimatedItemSize={55}
              showsHorizontalScrollIndicator={false}
              keyExtractor={filterKeyExtractor}
              renderItem={renderFilterItem}
              extraData={priceFilter}
            />
          </View>
        </View>

        {/* Products Grid */}
        {loadingProducts ? (
          <View style={styles.loadingContainer}>
            <View style={styles.loadingGrid}>
              {[1, 2, 3].map((i) => (
                <ProductCardSkeleton key={i} moodAware />
              ))}
            </View>
          </View>
        ) : filteredProducts.length === 0 ? (
          <View style={styles.emptyContainer}>
            <Ionicons
              name="cube-outline"
              size={56}
              color={moodPrimary + "60"}
            />
            <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
              {language === "ar" ? "لا توجد منتجات" : "No products found"}
            </Text>
          </View>
        ) : (
          <View
            style={[
              styles.flashListContainer,
              // On web, explicitly set width to ensure FlashList calculates columns correctly
              Platform.OS === "web" && { width: windowWidth },
            ]}
          >
            <FlashList
              data={displayProducts}
              numColumns={productNumColumns}
              key={`${productNumColumns}-${windowWidth}`} // Force re-render when columns or width change
              keyExtractor={keyExtractor}
              renderItem={renderProductItem}
              estimatedItemSize={175}
              showsVerticalScrollIndicator={false}
              contentContainerStyle={styles.productsGrid}
              columnWrapperStyle={{ gap: 3.5 }}
            />
          </View>
        )}
      </Animated.View>
    </>
  );
};

// ============================================================================
// STYLES
// ============================================================================
const styles = StyleSheet.create({
  container: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    borderTopWidth: 1.7,
    zIndex: 1000,
    overflow: "hidden",
  },
  neonBorder: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: 1.5,
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.7,
    shadowRadius: 8,
    elevation: 4,
  },
  anchorRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 10,
  },
  anchorButton: {
    width: 50,
    height: 50,
    borderRadius: 25,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    elevation: 6,
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.3,
    shadowRadius: 5,
  },
  hintContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  dualHintRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 11,
  },
  hintTouchable: {
    paddingVertical: 5,
    paddingHorizontal: 7,
  },
  hintText: {
    fontSize: 19,
    fontWeight: "700",
    letterSpacing: 0.7,
  },
  hintDivider: {
    width: 3.5,
    height: 50,
    opacity: 0.9,
  },
  breadcrumb: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
  },
  breadcrumbRTL: {
    flexDirection: "row-reverse",
  },
  breadcrumbItem: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 3,
    paddingVertical: 3,
    borderRadius: 25,
    borderWidth: 1.9,
    gap: 5,
  },
  breadcrumbLogo: {
    width: 50,
    height: 50,
    borderRadius: 3,
  },
  breadcrumbText: {
    fontSize: 15,
    fontWeight: "700",
  },
  breadcrumbFuelRow: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
  },
  breadcrumbFuelIcon: {
    width: 33.9,
    height: 39,
    borderRadius: 19,
    borderWidth: 1.5,
    alignItems: "center",
    justifyContent: "center",
  },
  gridContainer: {
    flex: 1,
    paddingHorizontal: 7,
  },
  brandModelSearchBar: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 10,
    borderWidth: 1.5,
    marginHorizontal: 15,
    marginBottom: 5.9,
    paddingHorizontal: 7,
    paddingVertical: 5,
    height: 31.9,
  },
  brandModelSearchInput: {
    flex: 1,
    fontSize: 13,
    paddingVertical: 1,
  },
  horizontalListContent: {
    paddingHorizontal: 5,
    paddingVertical: 1.5,
  },
  gridItemWrapper: {
    marginHorizontal: 3.9,
  },
  gridItem: {
    width: 139,
    height: 159,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1.9,
    borderColor: "rgba(255,255,255,0.3)",
    padding: 1.9,
  },
  viewAllItem: {
    borderWidth: 2,
    borderStyle: "dashed",
  },
  brandLogo: {
    width: 133,
    height: 130,
    marginBottom: 0,
  },
  modelImage: {
    width: 130,
    height: 115,
    borderRadius: 7,
    marginBottom: 0,
  },
  placeholderIcon: {
    width: 70,
    height: 70,
    borderRadius: 35,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 7,
  },
  gridItemText: {
    fontSize: 13,
    fontWeight: "700",
    textAlign: "center",
  },
  gridItemSubtext: {
    fontSize: 13,
    fontWeight: "500",
    marginTop: 1,
  },
  chassisSearchContainer: {
    flex: 1,
    paddingHorizontal: 5,
  },
  chassisSearchBox: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 11,
    paddingVertical: 10,
    borderRadius: 13,
    borderWidth: 1.9,
    gap: 7,
  },
  chassisSearchInput: {
    flex: 1,
    fontSize: 11.5,
    padding: 3,
  },
  chassisResultsContainer: {
    flex: 1,
    paddingHorizontal: 5,
  },
  chassisGridContent: {
    paddingVertical: 3,
  },
  chassisEmptyState: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 30,
  },
  chassisEmptyText: {
    fontSize: 13,
    marginTop: 7,
  },
  chassisGridCardWrapper: {
    width: SCREEN_WIDTH / 2.3,
    padding: 1.9,
  },
  chassisGridCard: {
    borderRadius: 17,
    borderWidth: 1.9,
    borderColor: "rgba(255,255,255,0.5)",
    overflow: "hidden",
  },
  chassisGridCardImage: {
    width: "100%",
    height: 139,
  },
  chassisGridCardPlaceholder: {
    width: "100%",
    height: 119,
    alignItems: "center",
    justifyContent: "center",
  },
  chassisGridCardInfo: {
    padding: 5,
    alignItems: "center",
  },
  chassisGridCardName: {
    fontSize: 17,
    fontWeight: "700",
    textAlign: "center",
  },
  chassisGridCardYear: {
    fontSize: 15,
    marginTop: 0,
  },
  chassisGridCardBrand: {
    fontSize: 13,
    fontWeight: "700",
    marginTop: 0,
  },
  chassisGridCardChassisContainer: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 5.9,
    paddingVertical: 3.9,
    borderRadius: 19,
    marginTop: 0,
  },
  chassisGridCardChassis: {
    fontSize: 13,
    fontWeight: "900",
  },
  productsPanel: {
    position: "absolute",
    top: 59,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 2000,
  },
  productsPanelHeaderGradient: {
    paddingTop: 3,
  },
  productsPanelHeader: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 19,
    paddingVertical: 3,
    borderBottomWidth: 3,
    gap: 9,
  },
  backButton: {
    width: 39,
    height: 39,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1.9,
  },
  closeButton: {
    width: 39,
    height: 39,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1.9,
  },
  headerTitleContainer: {
    flex: 1,
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: "700",
    textAlign: "center",
  },
  productCountBadge: {
    alignSelf: "center",
    paddingHorizontal: 7,
    paddingVertical: 1,
    borderRadius: 9,
    marginTop: 5,
    alignItems: "center",
    opacity: 9.9,
  },
  headerSubtitle: {
    fontSize: 13,
    fontWeight: "700",
  },
  filtersRow: {
    paddingHorizontal: 55.9,
    paddingVertical: 3.9,
    borderBottomWidth: 1.5,
    borderBlockColor: "rgba(255,255,255,0.5)",
    gap: 7,
  },
  searchBox: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 13,
    paddingVertical: 3,
    borderRadius: 19,
    borderWidth: 1.9,
    gap: 7,
  },
  searchInput: {
    flex: 1,
    fontSize: 13,
    padding: 3,
  },
  filterChipsContainer: {
    height: 37,
  },
  filterChip: {
    paddingHorizontal: 13.9,
    paddingVertical: 3,
    borderRadius: 17,
    borderWidth: 1.3,
    marginRight: 9,
  },
  filterChipText: {
    fontSize: 11,
    fontWeight: "500",
  },
  flashListContainer: {
    flex: 1,
    // Ensure full width on web for proper FlashList grid calculation
    ...(Platform.OS === "web" ? { width: "100%" } : {}),
  },
  productsGrid: {
    // Horizontal padding is now implicitly handled by the useMemo logic.
    // We only define vertical padding here.
    paddingVertical: 7,
  },
  productCardWrapper: {
    // The 'width' is now passed directly to the ProductCard component.
    // The horizontal spacing is now handled by `columnWrapperStyle`.
    // We remove marginHorizontal to prevent double spacing.
    marginBottom: 7,
    alignItems: "center",
  },
  productCard: {
    width: "100%", // Fill the wrapper's calculated width
    borderRadius: 13,
    overflow: "hidden",
    borderWidth: 1.9,
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.17,
    shadowRadius: 9,
    elevation: 5,
    position: "relative",
  },
  productImage: {
    width: "100%",
    height: 130,
  },
  productPlaceholder: {
    width: "100%",
    height: 130,
    alignItems: "center",
    justifyContent: "center",
  },
  productInfo: {
    padding: 5,
    gap: 7,
  },
  productName: {
    fontSize: 13,
    fontWeight: "700",
    lineHeight: 19,
    textAlign: "center",
  },
  priceCartRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  priceTag: {
    alignSelf: "flex-start",
    paddingHorizontal: 5,
    paddingVertical: 1.9,
    borderRadius: 10,
    opacity: 9.9999,
  },
  priceText: {
    fontSize: 13,
    fontWeight: "700",
  },
  cartButtonOverlay: {
    width: 19,
    height: 19,
    borderRadius: 9,
  },
  fitmentStripWrap: {
    alignItems: 'center',
    marginTop: 4,
    marginBottom: 4,
  },
  loadingContainer: {
    flex: 1,
    padding: 17,
  },
  loadingGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 7,
  },
  emptyContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 35,
  },
  emptyText: {
    fontSize: 15,
    marginTop: 11,
  },
});

export default InteractiveCarSelector;

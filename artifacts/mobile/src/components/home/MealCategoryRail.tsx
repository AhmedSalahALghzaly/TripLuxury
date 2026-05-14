// MealCategoryRail — chip-toggled horizontal rail that replaces the
// stacked Family-Meals / Drinks / Additions strips. Presentational:
// renderProduct is delegated by the parent to keep ProductCard
// lifecycle untouched.
import React, { useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  FlatList,
  Animated,
  Easing,
  Pressable,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

type IoniconName = keyof typeof Ionicons.glyphMap;
import { useTheme } from '../../hooks/useTheme';
import { useTranslation } from '../../hooks/useTranslation';
import {
  TYPE,
  SPACING,
  RADII,
  ELEVATION,
  COLORS,
  OVERLAYS,
} from '../../constants/luxuryTokens';
import { LUXURY_MOTION } from '../../constants/animations';
import MagazineSectionHeader from './MagazineSectionHeader';

export interface MealCategory {
  key: string;
  label_en: string;
  label_ar: string;
  icon?: IoniconName;
  list: any[];
  empty_en: string;
  empty_ar: string;
  placeholder_en: string;
  placeholder_ar: string;
}

interface MealCategoryRailProps {
  categories: MealCategory[];
  renderProduct: ({ item }: { item: any }) => React.ReactElement | null;
  onViewAll?: (key: string) => void;
  eyebrow?: string;
  title?: string;
  caption?: string;
}

export const MealCategoryRail: React.FC<MealCategoryRailProps> = ({
  categories,
  renderProduct,
  onViewAll,
  eyebrow,
  title,
  caption,
}) => {
  const { colors, isDark } = useTheme();
  const { language, isRTL, t } = useTranslation();

  const visible = useMemo(
    () => categories.filter((c) => Array.isArray(c.list) && c.list.length > 0),
    [categories],
  );
  const [activeKey, setActiveKey] = useState<string | null>(
    visible[0]?.key ?? null,
  );
  const [query, setQuery] = useState('');

  React.useEffect(() => {
    if (visible.length === 0) {
      setActiveKey(null);
      return;
    }
    if (!visible.some((c) => c.key === activeKey)) {
      setActiveKey(visible[0].key);
      setQuery('');
    }
  }, [visible, activeKey]);

  const active = useMemo(
    () => visible.find((c) => c.key === activeKey) ?? visible[0] ?? null,
    [visible, activeKey],
  );

  const filtered = useMemo(() => {
    if (!active) return [];
    const term = query.trim().toLowerCase();
    if (!term) return active.list;
    return active.list.filter((p: any) => {
      const name = (p.name || '').toLowerCase();
      const nameAr = (p.name_ar || '').toLowerCase();
      const sku = (p.sku || '').toLowerCase();
      return name.includes(term) || nameAr.includes(term) || sku.includes(term);
    });
  }, [active, query]);

  if (visible.length === 0 || !active) return null;

  const sectionTitle =
    title ??
    (language === 'ar' ? 'من المطبخ' : 'From the kitchen');
  const sectionCaption =
    caption ??
    (language === 'ar'
      ? 'اختر تجربتك وامسح القائمة كأنك تتصفح مجلة.'
      : 'Pick a tasting category — flip through it like a magazine.');
  const sectionEyebrow =
    eyebrow ?? (language === 'ar' ? 'الذواقة' : 'TASTING ROOM');

  return (
    <View style={styles.wrapper}>
      <MagazineSectionHeader
        eyebrow={sectionEyebrow}
        title={sectionTitle}
        caption={sectionCaption}
        ctaLabel={t('viewAll') as string}
        onCtaPress={() => onViewAll?.(active.key)}
      />

      {/* ── Chip toggle ─────────────────────────────────────────────── */}
      <FlatList
        data={visible}
        keyExtractor={(c) => c.key}
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={[
          styles.chipsContent,
          { flexDirection: isRTL ? 'row-reverse' : 'row' },
        ]}
        renderItem={({ item }) => (
          <CategoryChip
            label={language === 'ar' ? item.label_ar : item.label_en}
            count={item.list.length}
            icon={item.icon}
            active={item.key === activeKey}
            onPress={() => {
              setActiveKey(item.key);
              setQuery('');
            }}
            isDark={isDark}
            colors={colors}
          />
        )}
      />

      {/* ── Inline search ───────────────────────────────────────────── */}
      <View
        style={[
          styles.searchShell,
          {
            backgroundColor: isDark
              ? OVERLAYS.scrimDeep
              : OVERLAYS.ivoryWash,
            borderColor: colors.primary + '33',
            flexDirection: isRTL ? 'row-reverse' : 'row',
          },
        ]}
      >
        <Ionicons
          name="search"
          size={16}
          color={colors.primary}
        />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder={
            language === 'ar' ? active.placeholder_ar : active.placeholder_en
          }
          placeholderTextColor={colors.textSecondary}
          style={[
            styles.searchInput,
            {
              color: colors.text,
              textAlign: isRTL ? 'right' : 'left',
            },
          ]}
          returnKeyType="search"
        />
        {query.length > 0 ? (
          <TouchableOpacity
            onPress={() => setQuery('')}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Clear search"
          >
            <Ionicons
              name="close-circle"
              size={16}
              color={colors.textSecondary}
            />
          </TouchableOpacity>
        ) : null}
      </View>

      {/* ── Product rail ────────────────────────────────────────────── */}
      {filtered.length > 0 ? (
        <FlatList
          data={filtered.slice(0, 20)}
          renderItem={renderProduct}
          keyExtractor={(item) => item.id}
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.railContent}
          initialNumToRender={4}
          maxToRenderPerBatch={6}
          windowSize={3}
          removeClippedSubviews
          inverted={isRTL}
        />
      ) : (
        <Text
          style={[
            styles.empty,
            {
              color: colors.textSecondary,
              textAlign: isRTL ? 'right' : 'left',
            },
          ]}
        >
          {language === 'ar' ? active.empty_ar : active.empty_en}
        </Text>
      )}
    </View>
  );
};

// CategoryChip — animates gold fill + lift on selection.
interface CategoryChipProps {
  label: string;
  count: number;
  active: boolean;
  onPress: () => void;
  isDark: boolean;
  colors: { primary: string; text: string; textSecondary: string; surface: string; border: string };
  icon?: IoniconName;
}

const CategoryChip: React.FC<CategoryChipProps> = ({
  label,
  count,
  active,
  onPress,
  isDark,
  colors,
  icon,
}) => {
  const anim = React.useRef(new Animated.Value(active ? 1 : 0)).current;

  React.useEffect(() => {
    Animated.timing(anim, {
      toValue: active ? 1 : 0,
      duration: LUXURY_MOTION.dishReveal.duration,
      easing: Easing.out(Easing.ease),
      useNativeDriver: false, // backgroundColor interpolates require non-native
    }).start();
  }, [active, anim]);

  const bg = anim.interpolate({
    inputRange: [0, 1],
    outputRange: [
      isDark ? OVERLAYS.charcoalChipDim : OVERLAYS.ivoryWashDim,
      colors.primary,
    ],
  });
  const border = anim.interpolate({
    inputRange: [0, 1],
    outputRange: [colors.primary + '40', colors.primary],
  });
  const labelColor = active ? COLORS.charcoal : colors.text;
  const countColor = active ? OVERLAYS.charcoalChipText : colors.textSecondary;

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [{ opacity: pressed ? 0.8 : 1 }]}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
    >
      <Animated.View
        style={[
          styles.chip,
          {
            backgroundColor: bg,
            borderColor: border,
            ...(active ? ELEVATION.goldGlow : {}),
          },
        ]}
      >
        {icon ? (
          <Ionicons name={icon} size={13} color={labelColor} />
        ) : null}
        <Text
          style={[
            styles.chipLabel,
            { color: labelColor },
          ]}
          numberOfLines={1}
        >
          {label}
        </Text>
        <Text
          style={[
            styles.chipCount,
            { color: countColor },
          ]}
        >
          {count}
        </Text>
      </Animated.View>
    </Pressable>
  );
};

const styles = StyleSheet.create({
  wrapper: {
    marginBottom: SPACING.lg,
  },
  chipsContent: {
    paddingHorizontal: SPACING.xl,
    paddingBottom: SPACING.md,
    gap: SPACING.sm,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.xs,
    paddingVertical: SPACING.sm,
    paddingHorizontal: SPACING.lg,
    borderRadius: RADII.pill,
    borderWidth: 1,
  },
  chipLabel: {
    ...TYPE.chipLabel,
  },
  chipCount: {
    ...TYPE.chipCount,
  },
  searchShell: {
    marginHorizontal: SPACING.xl,
    marginBottom: SPACING.md,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.xs,
    borderRadius: RADII.lg,
    borderWidth: 1,
    alignItems: 'center',
    gap: SPACING.sm,
  },
  searchInput: {
    ...TYPE.inputText,
    flex: 1,
    paddingVertical: SPACING.sm,
  },
  railContent: {
    paddingHorizontal: SPACING.lg,
    gap: SPACING.sm,
  },
  empty: {
    paddingHorizontal: SPACING.xl,
    paddingVertical: SPACING.md,
    ...TYPE.body,
  },
});

export default MealCategoryRail;

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useTheme } from '../hooks/useTheme';

export interface FitmentVariant {
  indicator: string;
  price?: number;
  stock?: number;
}

interface Props {
  variants?: FitmentVariant[] | null;
  fitmentIndicator?: string | null;
  size?: 'sm' | 'md';
}

const FitmentBadges: React.FC<Props> = ({ variants, fitmentIndicator, size = 'sm' }) => {
  const { colors, isDark } = useTheme();
  const list: string[] = [];

  if (Array.isArray(variants) && variants.length > 0) {
    variants.forEach((v) => v?.indicator && list.push(String(v.indicator)));
  }
  if (fitmentIndicator && !list.includes(String(fitmentIndicator))) {
    list.unshift(String(fitmentIndicator));
  }
  if (list.length === 0) return null;

  const ordered = ['STD', '010', '020', '030', '040'].filter((k) => list.includes(k));
  const finalList = ordered.length > 0 ? ordered : list;

  // Hide STD-only chips: when the product has only the STD indicator and
  // no real variants, suppress the badge row entirely. Per the product
  // requirement, fitment chips should appear in product cards only when
  // there is something to choose between (i.e. 2+ fitments).
  if (finalList.length === 1 && finalList[0] === 'STD') return null;

  return (
    <View style={styles.row}>
      {finalList.slice(0, 5).map((ind) => {
        const isStd = ind === 'STD';
        return (
          <View
            key={ind}
            style={[
              styles.badge,
              size === 'md' && styles.badgeMd,
              {
                backgroundColor: isStd
                  ? (colors.primary + '22')
                  : (isDark ? 'rgba(255,255,255,0.08)' : '#F3F4F6'),
                borderColor: isStd ? colors.primary : (isDark ? 'rgba(255,255,255,0.18)' : '#E5E7EB'),
              },
            ]}
          >
            <Text
              style={[
                styles.text,
                size === 'md' && styles.textMd,
                { color: isStd ? colors.primary : colors.textSecondary },
              ]}
            >
              {ind}
            </Text>
          </View>
        );
      })}
    </View>
  );
};

const styles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginBottom: 4 },
  badge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
    borderWidth: 1,
  },
  badgeMd: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8 },
  text: { fontSize: 10, fontWeight: '700', letterSpacing: 0.3 },
  textMd: { fontSize: 12 },
});

export default React.memo(FitmentBadges);

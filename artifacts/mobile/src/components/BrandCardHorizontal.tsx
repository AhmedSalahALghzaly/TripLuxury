/**
 * BrandCardHorizontal - Reusable brand card component for horizontal scrolling
 * Displays brand image and name, optimized for horizontal ScrollView
 */
import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Image,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../hooks/useTheme';
import { useAppStore } from '../store/appStore';

interface Brand {
  id: string;
  name: string;
  name_ar?: string;
  image?: string;
  logo?: string;
}

interface BrandCardHorizontalProps {
  brand: Brand;
  onPress: () => void;
  type?: 'product' | 'car';
}

export const BrandCardHorizontal: React.FC<BrandCardHorizontalProps> = ({
  brand,
  onPress,
  type = 'product',
}) => {
  const { colors, isDark } = useTheme();
  const language = useAppStore((state) => state.language);
  const isRTL = language === 'ar';

  const brandImage = brand.image || brand.logo;
  const brandName = isRTL && brand.name_ar ? brand.name_ar : brand.name;
  const iconName = type === 'car' ? 'restaurant-outline' : 'pricetag';

  return (
    <TouchableOpacity
      style={[
        styles.container,
        {
          backgroundColor: isDark ? colors.surface : colors.card,
          borderColor: colors.border,
        },
      ]}
      onPress={onPress}
      activeOpacity={0.7}
    >
      <View
        style={[
          styles.imageContainer,
          { backgroundColor: isDark ? colors.background : '#F3F4F6' },
        ]}
      >
        {brandImage ? (
          <Image
            source={{ uri: brandImage }}
            style={styles.brandImage}
            resizeMode="contain"
          />
        ) : (
          <Ionicons name={iconName} size={32} color={colors.primary} />
        )}
      </View>
      <Text
        style={[styles.brandName, { color: colors.text }]}
        numberOfLines={2}
      >
        {brandName}
      </Text>
      <View style={[styles.arrowContainer, { backgroundColor: colors.primary + '20' }]}>
        <Ionicons
          name={isRTL ? 'chevron-back' : 'chevron-forward'}
          size={14}
          color={colors.primary}
        />
      </View>
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  container: {
    width: 100,
    marginRight: 12,
    borderRadius: 16,
    padding: 12,
    alignItems: 'center',
    borderWidth: 1,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  imageContainer: {
    width: 60,
    height: 60,
    borderRadius: 30,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
    overflow: 'hidden',
  },
  brandImage: {
    width: 50,
    height: 50,
  },
  brandName: {
    fontSize: 12,
    fontWeight: '600',
    textAlign: 'center',
    marginBottom: 6,
  },
  arrowContainer: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

export default BrandCardHorizontal;

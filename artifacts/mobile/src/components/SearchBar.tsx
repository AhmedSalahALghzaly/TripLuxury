import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View,
  TextInput,
  StyleSheet,
  TouchableOpacity,
  Text,
  ActivityIndicator,
  Modal,
  Pressable,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useTheme } from '../hooks/useTheme';
import { useTranslation } from '../hooks/useTranslation';
import { productsApi } from '../services/api';

interface SearchResult {
  products: any[];
  car_brands: any[];
  product_brands: any[];
  categories: any[];
}

export const SearchBar: React.FC<{ onFocus?: () => void }> = ({ onFocus }) => {
  const { colors } = useTheme();
  const { t, isRTL, language } = useTranslation();
  const router = useRouter();
  
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [showResults, setShowResults] = useState(false);
  
  // Debounce ref for cleanup - prevents memory leaks
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Search with proper debouncing and cleanup
  useEffect(() => {
    // Clear previous debounce timer
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }
    
    // Don't search if query is too short
    if (query.length < 2) {
      setResults(null);
      setLoading(false);
      return;
    }
    
    setLoading(true);
    
    // Debounce the search API call
    debounceTimerRef.current = setTimeout(async () => {
      try {
        const response = await productsApi.search(query);
        setResults(response.data);
      } catch (error) {
        console.error('Search error:', error);
      } finally {
        setLoading(false);
      }
    }, 300);
    
    // Cleanup function to clear pending timers on unmount or query change
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, [query]);

  const handleResultPress = (type: string, item: any) => {
    setShowResults(false);
    setQuery('');
    
    switch (type) {
      case 'product':
        router.push(`/product/${item.id}`);
        break;
      case 'category':
        router.push(`/category/${item.id}`);
        break;
      case 'car_brand':
        router.push(`/search?car_brand_id=${item.id}`);
        break;
      case 'product_brand':
        router.push(`/search?product_brand_id=${item.id}`);
        break;
    }
  };

  const getName = (item: any) => {
    return language === 'ar' && item.name_ar ? item.name_ar : item.name;
  };

  const hasResults = results && (
    results.products.length > 0 ||
    results.car_brands.length > 0 ||
    results.product_brands.length > 0 ||
    results.categories.length > 0
  );

  return (
    <View style={styles.container}>
      <View style={[
        styles.searchContainer, 
        { backgroundColor: colors.inputBackground, borderColor: colors.border }
      ]}>
        <Ionicons 
          name="search" 
          size={20} 
          color={colors.textSecondary} 
          style={isRTL ? styles.iconRight : styles.iconLeft}
        />
        <TextInput
          style={[
            styles.input, 
            { color: colors.text, textAlign: isRTL ? 'right' : 'left' }
          ]}
          placeholder={t('searchPlaceholder')}
          placeholderTextColor={colors.textSecondary}
          value={query}
          onChangeText={setQuery}
          onFocus={() => {
            setShowResults(true);
            onFocus?.();
          }}
        />
        {loading && <ActivityIndicator size="small" color={colors.primary} />}
        {query.length > 0 && !loading && (
          <TouchableOpacity onPress={() => setQuery('')}>
            <Ionicons name="close-circle" size={20} color={colors.textSecondary} />
          </TouchableOpacity>
        )}
      </View>

      {showResults && hasResults && (
        <View style={[
          styles.resultsContainer, 
          { backgroundColor: colors.card, borderColor: colors.border }
        ]}>
          {/* Products */}
          {results.products.length > 0 && (
            <View style={styles.section}>
              <Text style={[styles.sectionTitle, { color: colors.textSecondary }]}>
                {t('products')}
              </Text>
              {results.products.slice(0, 5).map((item) => (
                <TouchableOpacity
                  key={item.id}
                  style={styles.resultItem}
                  onPress={() => handleResultPress('product', item)}
                >
                  <Ionicons name="cube-outline" size={18} color={colors.primary} />
                  <Text style={[styles.resultText, { color: colors.text }]}>
                    {getName(item)}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          )}

          {/* Categories */}
          {results.categories.length > 0 && (
            <View style={styles.section}>
              <Text style={[styles.sectionTitle, { color: colors.textSecondary }]}>
                {t('categories')}
              </Text>
              {results.categories.map((item) => (
                <TouchableOpacity
                  key={item.id}
                  style={styles.resultItem}
                  onPress={() => handleResultPress('category', item)}
                >
                  <Ionicons name="grid-outline" size={18} color={colors.secondary} />
                  <Text style={[styles.resultText, { color: colors.text }]}>
                    {getName(item)}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          )}

          {/* Car Brands */}
          {results.car_brands.length > 0 && (
            <View style={styles.section}>
              <Text style={[styles.sectionTitle, { color: colors.textSecondary }]}>
                {t('carBrands')}
              </Text>
              {results.car_brands.map((item) => (
                <TouchableOpacity
                  key={item.id}
                  style={styles.resultItem}
                  onPress={() => handleResultPress('car_brand', item)}
                >
                  <Ionicons name="restaurant-outline" size={18} color={colors.accent} />
                  <Text style={[styles.resultText, { color: colors.text }]}>
                    {getName(item)}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          )}

          {/* Product Brands */}
          {results.product_brands.length > 0 && (
            <View style={styles.section}>
              <Text style={[styles.sectionTitle, { color: colors.textSecondary }]}>
                {t('productBrands')}
              </Text>
              {results.product_brands.map((item) => (
                <TouchableOpacity
                  key={item.id}
                  style={styles.resultItem}
                  onPress={() => handleResultPress('product_brand', item)}
                >
                  <Ionicons name="pricetag-outline" size={18} color={colors.primary} />
                  <Text style={[styles.resultText, { color: colors.text }]}>
                    {item.name}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          )}
        </View>
      )}

      {showResults && (
        <Pressable 
          style={styles.overlay} 
          onPress={() => setShowResults(false)} 
        />
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    position: 'relative',
    zIndex: 100,
  },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 12,
    height: 40,
  },
  iconLeft: {
    marginRight: 7,
  },
  iconRight: {
    marginLeft: 8,
  },
  input: {
    flex: 1,
    fontSize: 16,
    height: '100%',
  },
  resultsContainer: {
    position: 'absolute',
    top: 56,
    left: 0,
    right: 0,
    borderRadius: 12,
    borderWidth: 1,
    maxHeight: 400,
    elevation: 5,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
    zIndex: 101,
  },
  section: {
    padding: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#E5E5E5',
  },
  sectionTitle: {
    fontSize: 12,
    fontWeight: '600',
    marginBottom: 8,
    textTransform: 'uppercase',
  },
  resultItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    gap: 10,
  },
  resultText: {
    fontSize: 14,
    flex: 1,
  },
  overlay: {
    position: 'absolute',
    top: 56,
    left: -1000,
    right: -1000,
    bottom: -1000,
    zIndex: 99,
  },
});

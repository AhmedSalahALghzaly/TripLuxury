/**
 * DraggablePromotionList - Drag and Drop Reordering for Promotions
 * Uses react-native-reanimated and react-native-gesture-handler
 * Modern 2025 UX with smooth animations
 */
import React, { useCallback, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Image,
  TouchableOpacity,
  Dimensions,
} from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withTiming,
  runOnJS,
} from 'react-native-reanimated';
import {
  GestureDetector,
  Gesture,
  GestureHandlerRootView,
} from 'react-native-gesture-handler';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useTheme } from '../../hooks/useTheme';
import { useTranslation } from '../../hooks/useTranslation';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const ITEM_HEIGHT = 90;

interface Promotion {
  id: string;
  title: string;
  title_ar?: string;
  image?: string;
  promotion_type: 'slider' | 'banner';
  is_active: boolean;
  sort_order: number;
  target_product?: any;
  target_car_model?: any;
}

interface DraggablePromotionListProps {
  promotions: Promotion[];
  onReorder: (newOrder: Promotion[]) => void;
  onEdit: (promotion: Promotion) => void;
  onDelete: (id: string) => void;
}

interface DraggableItemProps {
  item: Promotion;
  index: number;
  activeIndex: number;
  onDragStart: (index: number) => void;
  onDragEnd: (fromIndex: number, toIndex: number) => void;
  onEdit: (promotion: Promotion) => void;
  onDelete: (id: string) => void;
  totalItems: number;
}

const DraggableItem: React.FC<DraggableItemProps> = ({
  item,
  index,
  activeIndex,
  onDragStart,
  onDragEnd,
  onEdit,
  onDelete,
  totalItems,
}) => {
  const { colors } = useTheme();
  const { language, isRTL } = useTranslation();
  
  const translateY = useSharedValue(0);
  const scale = useSharedValue(1);
  const zIndex = useSharedValue(0);
  const isActive = useSharedValue(false);
  const startY = useSharedValue(0);
  
  const [currentIndex, setCurrentIndex] = useState(index);

  const triggerHaptic = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  };

  const updateCurrentIndex = (newIndex: number) => {
    setCurrentIndex(newIndex);
  };

  const longPressGesture = Gesture.LongPress()
    .minDuration(200)
    .onStart(() => {
      isActive.value = true;
      scale.value = withSpring(1.05);
      zIndex.value = 100;
      runOnJS(triggerHaptic)();
      runOnJS(onDragStart)(index);
    });

  const panGesture = Gesture.Pan()
    .activateAfterLongPress(200)
    .onStart((e) => {
      startY.value = translateY.value;
    })
    .onUpdate((e) => {
      if (isActive.value) {
        translateY.value = startY.value + e.translationY;
        
        // Calculate new index based on position
        const newIndex = Math.round(translateY.value / ITEM_HEIGHT) + index;
        const clampedIndex = Math.max(0, Math.min(totalItems - 1, newIndex));
        
        if (clampedIndex !== currentIndex) {
          runOnJS(updateCurrentIndex)(clampedIndex);
          runOnJS(triggerHaptic)();
        }
      }
    })
    .onEnd(() => {
      if (isActive.value) {
        const finalIndex = Math.round(translateY.value / ITEM_HEIGHT) + index;
        const clampedFinalIndex = Math.max(0, Math.min(totalItems - 1, finalIndex));
        
        runOnJS(onDragEnd)(index, clampedFinalIndex);
        
        translateY.value = withSpring(0);
        scale.value = withSpring(1);
        zIndex.value = 0;
        isActive.value = false;
      }
    });

  const composedGesture = Gesture.Simultaneous(longPressGesture, panGesture);

  const animatedStyle = useAnimatedStyle(() => {
    return {
      transform: [
        { translateY: translateY.value },
        { scale: scale.value },
      ],
      zIndex: zIndex.value,
      shadowOpacity: isActive.value ? 0.3 : 0.1,
    };
  });

  return (
    <GestureDetector gesture={composedGesture}>
      <Animated.View
        style={[
          styles.itemCard,
          { backgroundColor: colors.card, borderColor: colors.border },
          animatedStyle,
        ]}
      >
        {/* Drag Handle */}
        <View style={styles.dragHandle}>
          <Ionicons name="reorder-three" size={24} color={colors.textSecondary} />
        </View>

        {/* Item Content */}
        <View style={styles.itemHeader}>
          {item.image ? (
            <Image source={{ uri: item.image }} style={styles.itemImage} />
          ) : (
            <View style={[styles.itemImagePlaceholder, { backgroundColor: colors.surface }]}>
              <Ionicons name="image-outline" size={24} color={colors.textSecondary} />
            </View>
          )}
          <View style={styles.itemInfo}>
            <Text style={[styles.itemTitle, { color: colors.text }]} numberOfLines={1}>
              {language === 'ar' && item.title_ar ? item.title_ar : item.title}
            </Text>
            <View style={styles.itemBadges}>
              <View
                style={[
                  styles.badge,
                  { backgroundColor: item.promotion_type === 'slider' ? '#3B82F6' : '#10B981' },
                ]}
              >
                <Text style={styles.badgeText}>
                  {item.promotion_type === 'slider'
                    ? language === 'ar' ? 'سلايدر' : 'Slider'
                    : language === 'ar' ? 'بانر' : 'Banner'}
                </Text>
              </View>
              <View
                style={[
                  styles.badge,
                  { backgroundColor: item.is_active ? '#10B981' : '#EF4444' },
                ]}
              >
                <Text style={styles.badgeText}>
                  {item.is_active
                    ? language === 'ar' ? 'نشط' : 'Active'
                    : language === 'ar' ? 'غير نشط' : 'Inactive'}
                </Text>
              </View>
            </View>
            <Text style={[styles.itemTarget, { color: colors.textSecondary }]} numberOfLines={1}>
              {item.target_product
                ? `→ ${item.target_product.name}`
                : item.target_car_model
                ? `→ ${item.target_car_model.name}`
                : ''}
            </Text>
          </View>
        </View>

        {/* Actions */}
        <View style={styles.itemActions}>
          <TouchableOpacity
            style={[styles.actionButton, { backgroundColor: colors.primary + '20' }]}
            onPress={() => onEdit(item)}
          >
            <Ionicons name="pencil" size={16} color={colors.primary} />
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.actionButton, { backgroundColor: colors.error + '20' }]}
            onPress={() => onDelete(item.id)}
          >
            <Ionicons name="trash" size={16} color={colors.error} />
          </TouchableOpacity>
        </View>

        {/* Order Number Badge */}
        <View style={[styles.orderBadge, { backgroundColor: colors.primary }]}>
          <Text style={styles.orderBadgeText}>{index + 1}</Text>
        </View>
      </Animated.View>
    </GestureDetector>
  );
};

export const DraggablePromotionList: React.FC<DraggablePromotionListProps> = ({
  promotions,
  onReorder,
  onEdit,
  onDelete,
}) => {
  const { colors } = useTheme();
  const { language } = useTranslation();
  const [activeIndex, setActiveIndex] = useState(-1);

  const handleDragStart = useCallback((index: number) => {
    setActiveIndex(index);
  }, []);

  const handleDragEnd = useCallback((fromIndex: number, toIndex: number) => {
    setActiveIndex(-1);
    
    if (fromIndex === toIndex) return;

    const newOrder = [...promotions];
    const [movedItem] = newOrder.splice(fromIndex, 1);
    newOrder.splice(toIndex, 0, movedItem);
    
    // Update sort_order values
    const reorderedWithSortOrder = newOrder.map((item, idx) => ({
      ...item,
      sort_order: idx,
    }));
    
    onReorder(reorderedWithSortOrder);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  }, [promotions, onReorder]);

  if (promotions.length === 0) {
    return (
      <View style={styles.emptyState}>
        <Ionicons name="megaphone-outline" size={48} color={colors.textSecondary} />
        <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
          {language === 'ar' ? 'لا توجد عروض ترويجية' : 'No promotions yet'}
        </Text>
        <Text style={[styles.emptyHint, { color: colors.textSecondary }]}>
          {language === 'ar'
            ? 'اسحب العناصر لتغيير الترتيب'
            : 'Long press and drag to reorder'}
        </Text>
      </View>
    );
  }

  return (
    <GestureHandlerRootView style={styles.container}>
      <View style={styles.header}>
        <Ionicons name="swap-vertical" size={18} color={colors.textSecondary} />
        <Text style={[styles.headerText, { color: colors.textSecondary }]}>
          {language === 'ar'
            ? 'اضغط مطولاً واسحب لإعادة الترتيب'
            : 'Long press and drag to reorder'}
        </Text>
      </View>
      {promotions
        .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0))
        .map((promo, index) => (
          <DraggableItem
            key={promo.id}
            item={promo}
            index={index}
            activeIndex={activeIndex}
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
            onEdit={onEdit}
            onDelete={onDelete}
            totalItems={promotions.length}
          />
        ))}
    </GestureHandlerRootView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    gap: 8,
  },
  headerText: {
    fontSize: 13,
  },
  itemCard: {
    borderRadius: 12,
    borderWidth: 1,
    padding: 12,
    marginBottom: 10,
    flexDirection: 'row',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowRadius: 4,
    elevation: 3,
  },
  dragHandle: {
    padding: 8,
    marginRight: 8,
  },
  itemHeader: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
  },
  itemImage: {
    width: 50,
    height: 50,
    borderRadius: 8,
    marginRight: 10,
  },
  itemImagePlaceholder: {
    width: 50,
    height: 50,
    borderRadius: 8,
    marginRight: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  itemInfo: {
    flex: 1,
  },
  itemTitle: {
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 4,
  },
  itemBadges: {
    flexDirection: 'row',
    gap: 4,
    marginBottom: 2,
  },
  badge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 8,
  },
  badgeText: {
    color: '#FFF',
    fontSize: 9,
    fontWeight: '600',
  },
  itemTarget: {
    fontSize: 11,
  },
  itemActions: {
    flexDirection: 'row',
    gap: 6,
  },
  actionButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  orderBadge: {
    position: 'absolute',
    top: -6,
    left: -6,
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  orderBadgeText: {
    color: '#FFF',
    fontSize: 11,
    fontWeight: '700',
  },
  emptyState: {
    alignItems: 'center',
    paddingVertical: 40,
  },
  emptyText: {
    marginTop: 12,
    fontSize: 14,
  },
  emptyHint: {
    marginTop: 4,
    fontSize: 12,
  },
});

export default DraggablePromotionList;

import { StyleProp, ViewStyle } from 'react-native';

declare module '@shopify/flash-list' {
  interface FlashListProps<TItem> {
    estimatedItemSize?: number;
    columnWrapperStyle?: StyleProp<ViewStyle>;
  }
}

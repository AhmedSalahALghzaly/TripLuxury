/**
 * OrderConfirmationModal - Success modal after order placement
 */
import React from 'react';
import { View, Text, StyleSheet, Modal, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useTheme } from '../../hooks/useTheme';
import { useTranslation } from '../../hooks/useTranslation';
import { NEON_NIGHT_THEME } from '../../store/appStore';

interface OrderConfirmationModalProps {
  visible: boolean;
  order: any;
  onClose: () => void;
  onViewOrders: () => void;
}

export const OrderConfirmationModal: React.FC<OrderConfirmationModalProps> = ({
  visible,
  order,
  onClose,
  onViewOrders,
}) => {
  const { colors } = useTheme();
  const { language } = useTranslation();

  const formatDate = (dateStr: string) => {
    if (!dateStr) return '';
    const date = new Date(dateStr);
    return date.toLocaleDateString(language === 'ar' ? 'ar-EG' : 'en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <View style={styles.modalOverlay}>
        <View style={[styles.confirmationModal, { backgroundColor: colors.card }]}>
          <LinearGradient
            colors={['#10B981', '#059669']}
            style={styles.confirmationIconContainer}
          >
            <Ionicons name="checkmark" size={48} color="#FFF" />
          </LinearGradient>

          <Text style={[styles.confirmationTitle, { color: colors.text }]}>
            {language === 'ar' ? 'تم تأكيد الطلب!' : 'Order Confirmed!'}
          </Text>

          <Text style={[styles.confirmationOrderNumber, { color: NEON_NIGHT_THEME.primary }]}>
            {order?.order_number}
          </Text>

          <View style={styles.confirmationDetails}>
            <Text style={[styles.confirmationDetail, { color: colors.textSecondary }]}>
              {language === 'ar' ? 'الإجمالي:' : 'Total:'} {(parseFloat(String(order?.total_amount || order?.total || 0)) || 0).toFixed(0)} ج.م
            </Text>
            <Text style={[styles.confirmationDetail, { color: colors.textSecondary }]}>
              {formatDate(order?.created_at)}
            </Text>
          </View>

          <TouchableOpacity
            style={[styles.confirmationBtn, { backgroundColor: NEON_NIGHT_THEME.primary }]}
            onPress={onViewOrders}
          >
            <Text style={styles.confirmationBtnText}>
              {language === 'ar' ? 'عرض الطلبات' : 'View Orders'}
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  confirmationModal: {
    width: '100%',
    maxWidth: 340,
    borderRadius: 24,
    padding: 28,
    alignItems: 'center',
  },
  confirmationIconContainer: {
    width: 80,
    height: 80,
    borderRadius: 40,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 20,
  },
  confirmationTitle: {
    fontSize: 22,
    fontWeight: '700',
    marginBottom: 8,
  },
  confirmationOrderNumber: {
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 16,
  },
  confirmationDetails: {
    alignItems: 'center',
    marginBottom: 20,
  },
  confirmationDetail: {
    fontSize: 14,
    marginBottom: 4,
  },
  confirmationBtn: {
    paddingHorizontal: 32,
    paddingVertical: 14,
    borderRadius: 24,
  },
  confirmationBtnText: {
    color: '#FFF',
    fontSize: 16,
    fontWeight: '600',
  },
});

export default OrderConfirmationModal;

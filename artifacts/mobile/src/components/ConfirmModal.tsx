import React, { useState, useCallback } from 'react';
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Pressable,
} from 'react-native';
import { useTheme } from '../hooks/useTheme';

interface ConfirmOptions {
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  onConfirm: () => void;
  onCancel?: () => void;
}

export const useConfirmModal = () => {
  const { colors } = useTheme();
  const [opts, setOpts] = useState<ConfirmOptions | null>(null);

  const showConfirm = useCallback((options: ConfirmOptions) => {
    setOpts(options);
  }, []);

  const hide = useCallback(() => setOpts(null), []);

  const ConfirmModalNode = opts ? (
    <Modal
      transparent
      animationType="fade"
      visible={true}
      onRequestClose={hide}
      statusBarTranslucent
    >
      <Pressable style={styles.overlay} onPress={hide}>
        <Pressable
          style={[styles.dialog, { backgroundColor: colors.surface }]}
          onPress={(e) => e.stopPropagation()}
        >
          <Text style={[styles.title, { color: colors.text }]}>{opts.title}</Text>
          <Text style={[styles.message, { color: colors.textSecondary }]}>{opts.message}</Text>
          <View style={styles.buttons}>
            <TouchableOpacity
              style={[styles.btn, { borderColor: colors.border, backgroundColor: colors.background }]}
              onPress={() => { opts.onCancel?.(); hide(); }}
              activeOpacity={0.7}
            >
              <Text style={[styles.btnText, { color: colors.text }]}>
                {opts.cancelText ?? 'إلغاء'}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.btn, styles.confirmBtn]}
              onPress={() => { opts.onConfirm(); hide(); }}
              activeOpacity={0.7}
            >
              <Text style={[styles.btnText, styles.confirmText]}>
                {opts.confirmText ?? 'حذف'}
              </Text>
            </TouchableOpacity>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  ) : null;

  return { showConfirm, ConfirmModalNode };
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  dialog: {
    width: '100%',
    maxWidth: 340,
    borderRadius: 18,
    padding: 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.25,
    shadowRadius: 20,
    elevation: 10,
  },
  title: {
    fontSize: 17,
    fontWeight: '700',
    textAlign: 'center',
    marginBottom: 10,
  },
  message: {
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 24,
  },
  buttons: {
    flexDirection: 'row',
    gap: 10,
  },
  btn: {
    flex: 1,
    paddingVertical: 13,
    borderRadius: 12,
    alignItems: 'center',
    borderWidth: 1,
  },
  btnText: {
    fontSize: 15,
    fontWeight: '600',
  },
  confirmBtn: {
    backgroundColor: '#EF4444',
    borderColor: '#EF4444',
  },
  confirmText: {
    color: '#fff',
  },
});

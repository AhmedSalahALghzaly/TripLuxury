/**
 * Subscriptions Management Screen - Full CRUD with Confetti
 */
import React, { useState, useCallback, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  ScrollView,
  TouchableOpacity,
  TextInput,
  RefreshControl,
  Modal,
  Alert,
  Dimensions,
  Linking,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { BlurView } from 'expo-blur';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import * as Clipboard from 'expo-clipboard';
import { useQueryClient } from '@tanstack/react-query';
import { useAppStore } from '../../src/store/appStore';
import { subscriberApi, subscriptionRequestApi } from '../../src/services/api';
import { ErrorCapsule } from '../../src/components/ui/ErrorCapsule';
import { ConfettiEffect } from '../../src/components/ui/ConfettiEffect';
import { AccessGuard as __AccessGuard__ } from '../../src/components/AccessGuard';
const { width: SCREEN_WIDTH } = Dimensions.get('window');


type TabType = 'subscribers' | 'requests';

function SubscriptionsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const language = useAppStore((state) => state.language);
  const subscribers = useAppStore((state) => state.subscribers) || [];
  const setSubscribers = useAppStore((state) => state.setSubscribers);
  const rawCustomers = useAppStore((state) => state.customers);
  const customers = Array.isArray(rawCustomers) ? rawCustomers : [];
  const isRTL = language === 'ar';

  const [activeTab, setActiveTab] = useState<TabType>('subscribers');
  const [refreshing, setRefreshing] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const [newEmail, setNewEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showConfetti, setShowConfetti] = useState(false);
  const [requests, setRequests] = useState<any[]>([]);
  const [selectedRequest, setSelectedRequest] = useState<any>(null);
  const [showRequestDetail, setShowRequestDetail] = useState(false);
  const [selectedSubscriber, setSelectedSubscriber] = useState<any>(null);
  const [showSubscriberDetail, setShowSubscriberDetail] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<{ visible: boolean; subId: string; name: string; type: 'subscriber' | 'request' }>({ visible: false, subId: '', name: '', type: 'subscriber' });

  const fetchData = async () => {
    try {
      const [subsRes, reqsRes] = await Promise.all([
        subscriberApi.getAll().catch(() => ({ data: [] })),
        subscriptionRequestApi.getAll().catch(() => ({ data: [] })),
      ]);
      setSubscribers(subsRes.data || []);
      setRequests(reqsRes.data || []);
    } catch (err) {
      console.error('Error fetching data:', err);
    }
  };

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchData();
    setRefreshing(false);
  }, []);

  useEffect(() => {
    fetchData();
  }, []);

  // Find customer by email or phone - with safety check
  const findCustomerByContact = (email?: string, phone?: string) => {
    if (!Array.isArray(customers)) return null;
    return customers.find((c: any) => 
      (email && c.email?.toLowerCase() === email?.toLowerCase()) ||
      (phone && c.phone === phone)
    );
  };

  // Navigate to customer personal profile page
  const navigateToCustomerProfile = (customerId: string) => {
    // Navigate to customer profile in admin/customers with customerId param
    router.push(`/admin/customers?customerId=${customerId}`);
  };

  // Handle subscriber row click - navigate to customer profile
  const handleSubscriberPress = (sub: any) => {
    const customer = findCustomerByContact(sub.email, sub.phone);
    if (customer) {
      navigateToCustomerProfile(customer.id);
    } else {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
  };

  // Handle subscriber details view (blue button)
  // Merges subscriber data with matching subscription_request (by email) to fill location/car fields
  const handleSubscriberDetails = (sub: any) => {
    const matchedRequest = requests.find(
      (r: any) =>
        (sub.email && r.email?.toLowerCase() === sub.email?.toLowerCase()) ||
        (sub.phone && r.phone === sub.phone)
    );
    const enriched = matchedRequest
      ? {
          ...sub,
          governorate: matchedRequest.governorate,
          village: matchedRequest.village,
          address: matchedRequest.detailed_address,
          car_model: matchedRequest.car_model_name,
        }
      : sub;
    setSelectedSubscriber(enriched);
    setShowSubscriberDetail(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };

  // Handle request row click - show details modal
  const handleRequestPress = (req: any) => {
    setSelectedRequest(req);
    setShowRequestDetail(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };

  // Copy email to clipboard
  const copyToClipboard = async (text: string) => {
    await Clipboard.setStringAsync(text);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    Alert.alert(
      isRTL ? 'تم النسخ' : 'Copied',
      isRTL ? 'تم نسخ البريد الإلكتروني' : 'Email copied to clipboard'
    );
  };

  // Add subscriber with confetti - Task 3: Refresh user state
  const handleAddSubscriber = async () => {
    if (!newEmail.trim()) return;

    setShowAddModal(false);
    setNewEmail('');

    try {
      setLoading(true);
      const res = await subscriberApi.create({ email: newEmail.trim(), name: newEmail.trim(), subscription_type: 'monthly' });
      // Add to list and refresh
      await fetchData();
      
      // Task 3: Force refresh user state to activate golden icon immediately
      const validateSession = useAppStore.getState().validateSession;
      if (validateSession) {
        await validateSession();
      }
      
      setShowConfetti(true);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (err: any) {
      setError(err.response?.data?.detail || 'Failed to add subscriber');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setLoading(false);
    }
  };

  // Delete subscriber
  const handleDeleteSubscriber = async (subId: string) => {
    const subToDelete = subscribers.find((s: any) => s.id === subId);
    if (!subToDelete) return;

    // Optimistic update
    setSubscribers(subscribers.filter((s: any) => s.id !== subId));

    try {
      await subscriberApi.delete(subId);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (err: any) {
      // Rollback
      setSubscribers([...subscribers, subToDelete]);
      setError(err.response?.data?.detail || 'Failed to delete subscriber');
    }
  };

  // Approve request - properly add to subscribers
  const handleApproveRequest = async (reqId: string) => {
    const request = requests.find((r: any) => r.id === reqId);
    if (!request) return;

    try {
      const res = await subscriptionRequestApi.approve(reqId);
      const approved = res.data;

      setRequests(prev => prev.map((r: any) =>
        r.id === reqId ? { ...r, status: 'approved' } : r
      ));

      // Server now returns the actual subscriber row under `subscriber`
      const sub = approved?.subscriber;
      if (sub && (sub.email || sub.phone)) {
        const subEmailL = sub.email?.toLowerCase() || null;
        const subPhone  = sub.phone || null;
        const filtered = (subscribers || []).filter((s: any) => {
          const sEmailL = s.email?.toLowerCase() || null;
          const sPhone  = s.phone || null;
          const sameEmail = subEmailL && sEmailL && subEmailL === sEmailL;
          const samePhone = subPhone  && sPhone  && subPhone  === sPhone;
          return !sameEmail && !samePhone;
        });
        setSubscribers([sub, ...filtered]);
      } else if (approved?.email || approved?.phone) {
        // Legacy fallback if server didn't return subscriber object
        const newSub = {
          id: approved.id || reqId,
          email: approved.email || null,
          name: approved.customer_name || approved.email || approved.phone,
          phone: approved.phone || null,
          subscription_type: approved.request_type || 'monthly',
          created_at: approved.reviewed_at || new Date().toISOString(),
        };
        const filtered = (subscribers || []).filter((s: any) =>
          (s.email?.toLowerCase() || null) !== (approved.email?.toLowerCase() || null) ||
          (s.phone || null) !== (approved.phone || null)
        );
        setSubscribers([newSub, ...filtered]);
      }

      await fetchData();
      setActiveTab('subscribers');
      setShowConfetti(true);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (err: any) {
      setError(err.response?.data?.detail || 'Failed to approve request');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    }
  };

  // Delete request — also revokes subscriber if request was approved
  const handleDeleteRequest = async (reqId: string) => {
    // Capture the request before removing it from state
    let reqToDelete: any = null;
    setRequests(prev => {
      reqToDelete = prev.find((r: any) => r.id === reqId) || null;
      return prev.filter((r: any) => r.id !== reqId);
    });

    try {
      const res = await subscriptionRequestApi.delete(reqId);
      const wasApproved = res.data?.was_approved;

      if (wasApproved && reqToDelete) {
        const emailToRevoke = reqToDelete.email?.toLowerCase();
        const phoneToRevoke = reqToDelete.phone;
        setSubscribers(subscribers.filter((s: any) => {
          const sEmail = s.email?.toLowerCase();
          const sPhone = s.phone;
          return sEmail !== emailToRevoke && sPhone !== phoneToRevoke;
        }));
        queryClient.invalidateQueries({ queryKey: ['/api/subscription-status'] });
        queryClient.invalidateQueries({ queryKey: ['/api/subscribers'] });
        queryClient.invalidateQueries({ queryKey: ['/api/subscription-requests'] });
      }

      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (err: any) {
      // Restore the request on failure
      if (reqToDelete) {
        setRequests(prev => [...prev, reqToDelete]);
      }
      setError(err.response?.data?.detail || 'Failed to delete request');
    }
  };

  const pendingRequests = requests.filter((r: any) => r.status === 'pending');

  // Render request detail row
  const renderDetailRow = (icon: string, label: string, value: string, onPress?: () => void) => {
    if (!value) return null;
    
    const content = (
      <View style={styles.detailRow}>
        <View style={styles.detailIconContainer}>
          <Ionicons name={icon as any} size={18} color="#8B5CF6" />
        </View>
        <View style={styles.detailContent}>
          <Text style={styles.detailLabel}>{label}</Text>
          <Text style={styles.detailValue}>{value}</Text>
        </View>
        {onPress && <Ionicons name="chevron-forward" size={18} color="#9CA3AF" />}
      </View>
    );

    if (onPress) {
      return (
        <TouchableOpacity key={label} onPress={onPress}>
          {content}
        </TouchableOpacity>
      );
    }
    return <View key={label}>{content}</View>;
  };

  const renderSubscriberItem = useCallback(({ item: sub }: { item: any }) => {
    const customer = findCustomerByContact(sub.email, sub.phone);
    return (
      <TouchableOpacity
        style={styles.card}
        onPress={() => handleSubscriberPress(sub)}
        activeOpacity={0.7}
      >
        <BlurView intensity={15} tint="light" style={styles.cardBlur}>
          <View style={styles.avatar}>
            <Ionicons name="card" size={24} color="#8B5CF6" />
          </View>
          <View style={styles.info}>
            <Text style={styles.name}>{sub.name || sub.email || sub.phone}</Text>
            {sub.email && (
              <View style={styles.emailRow}>
                <Text style={styles.email} numberOfLines={1}>{sub.email}</Text>
                <TouchableOpacity
                  onPress={(e) => { e.stopPropagation(); copyToClipboard(sub.email); }}
                  style={styles.copyButton}
                >
                  <Ionicons name="copy-outline" size={14} color="rgba(255,255,255,0.7)" />
                </TouchableOpacity>
              </View>
            )}
            <Text style={styles.date}>
              {isRTL ? 'منذ' : 'Since'} {new Date(sub.created_at).toLocaleDateString()}
            </Text>
          </View>
          <View style={styles.actionButtons}>
            <TouchableOpacity
              style={styles.profileButton}
              onPress={(e) => { e.stopPropagation(); handleSubscriberDetails(sub); }}
            >
              <Ionicons name="information-circle" size={18} color="#FFF" />
            </TouchableOpacity>
            {customer && (
              <TouchableOpacity
                style={styles.customerProfileButton}
                onPress={(e) => { e.stopPropagation(); navigateToCustomerProfile(customer.id); }}
              >
                <Ionicons name="person" size={18} color="#FFF" />
              </TouchableOpacity>
            )}
            <TouchableOpacity
              style={[styles.profileButton, { backgroundColor: '#EF444430' }]}
              onPress={(e) => {
                e.stopPropagation();
                setDeleteConfirm({ visible: true, subId: sub.id, name: sub.name || sub.email || sub.phone || '', type: 'subscriber' });
              }}
            >
              <Ionicons name="trash-outline" size={18} color="#EF4444" />
            </TouchableOpacity>
          </View>
        </BlurView>
      </TouchableOpacity>
    );
  }, [isRTL, findCustomerByContact, handleSubscriberPress, handleSubscriberDetails, navigateToCustomerProfile, copyToClipboard, setDeleteConfirm]);

  const renderRequestItem = useCallback(({ item: req }: { item: any }) => {
    const customer = findCustomerByContact(undefined, req.phone);
    const customerEmail = customer?.email || req.email;
    return (
      <TouchableOpacity
        style={styles.card}
        onPress={() => handleRequestPress(req)}
        activeOpacity={0.7}
      >
        <BlurView intensity={15} tint="light" style={styles.requestCardBlur}>
          <View style={styles.requestTopRow}>
            <View style={[styles.avatar, { backgroundColor: req.status === 'approved' ? 'rgba(16,185,129,0.2)' : 'rgba(245,158,11,0.2)' }]}>
              <Ionicons
                name={req.status === 'approved' ? 'checkmark-circle' : 'mail'}
                size={24}
                color={req.status === 'approved' ? '#10B981' : '#F59E0B'}
              />
            </View>
            <View style={styles.requestNameSection}>
              <Text style={styles.name}>{req.customer_name}</Text>
              <View style={styles.requestSubInfo}>
                <Text style={styles.phone}>{req.phone}</Text>
                <Text style={styles.requestDot}>•</Text>
                <Text style={styles.date}>{req.governorate}</Text>
              </View>
            </View>
            <View style={styles.actionButtons}>
              {req.status === 'pending' && (
                <TouchableOpacity
                  style={styles.approveButton}
                  onPress={(e) => { e.stopPropagation(); handleApproveRequest(req.id); }}
                >
                  <Ionicons name="checkmark" size={18} color="#FFF" />
                </TouchableOpacity>
              )}
              <TouchableOpacity
                style={styles.profileButton}
                onPress={(e) => {
                  e.stopPropagation();
                  if (customer) { navigateToCustomerProfile(customer.id); } else { handleRequestPress(req); }
                }}
              >
                <Ionicons name="person" size={18} color="#FFF" />
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.profileButton, { backgroundColor: '#EF444430' }]}
                onPress={(e) => {
                  e.stopPropagation();
                  setDeleteConfirm({ visible: true, subId: req.id, name: req.customer_name || req.phone || '', type: 'request' });
                }}
              >
                <Ionicons name="trash-outline" size={18} color="#EF4444" />
              </TouchableOpacity>
              {req.status === 'approved' && (
                <View style={styles.approvedBadge}>
                  <Ionicons name="checkmark-circle" size={14} color="#10B981" />
                </View>
              )}
            </View>
          </View>
          {customerEmail && (
            <View style={styles.emailCenterRow}>
              <View style={styles.emailIconContainer}>
                <Ionicons name="mail" size={14} color="#60A5FA" />
              </View>
              <TouchableOpacity
                style={styles.emailTouchable}
                onPress={(e) => { e.stopPropagation(); if (customer) { navigateToCustomerProfile(customer.id); } }}
              >
                <Text style={[styles.emailCenterText, customer && styles.emailClickable]} numberOfLines={1}>
                  {customerEmail}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={(e) => { e.stopPropagation(); copyToClipboard(customerEmail); }}
                style={styles.copyButtonCenter}
              >
                <Ionicons name="copy-outline" size={16} color="#60A5FA" />
                <Text style={styles.copyText}>{isRTL ? 'نسخ' : 'Copy'}</Text>
              </TouchableOpacity>
            </View>
          )}
        </BlurView>
      </TouchableOpacity>
    );
  }, [isRTL, findCustomerByContact, handleRequestPress, handleApproveRequest, navigateToCustomerProfile, copyToClipboard, setDeleteConfirm]);

  const ListEmptyComponent = useCallback(() => (
    <View style={styles.emptyState}>
      <Ionicons
        name={activeTab === 'subscribers' ? 'card-outline' : 'mail-outline'}
        size={64}
        color="rgba(255,255,255,0.5)"
      />
      <Text style={styles.emptyText}>
        {activeTab === 'subscribers'
          ? (isRTL ? 'لا يوجد مشتركين' : 'No subscribers yet')
          : (isRTL ? 'لا توجد طلبات' : 'No requests yet')}
      </Text>
    </View>
  ), [activeTab, isRTL]);

  const listData = activeTab === 'subscribers' ? subscribers : requests;

  return (
    <View style={styles.container}>
      <LinearGradient colors={['#5B21B6', '#7C3AED', '#8B5CF6']} style={StyleSheet.absoluteFill} />

      <ErrorCapsule message={error || ''} visible={!!error} onDismiss={() => setError(null)} />
      <ConfettiEffect active={showConfetti} onComplete={() => setShowConfetti(false)} />

      {/* Fixed Header Area — title bar only */}
      <View style={[styles.fixedHeader, { paddingTop: insets.top }]}>
        <View style={[styles.header, isRTL && styles.headerRTL]}>
          <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
            <Ionicons name={isRTL ? 'arrow-forward' : 'arrow-back'} size={24} color="#FFF" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>{isRTL ? 'الاشتراكات' : 'Subscriptions'}</Text>
          <TouchableOpacity style={styles.addButton} onPress={() => setShowAddModal(true)}>
            <Ionicons name="add" size={24} color="#FFF" />
          </TouchableOpacity>
        </View>
      </View>

      {/* Scrollable List — stats + tabs are inside ListHeaderComponent */}
      <FlatList
        data={listData}
        renderItem={activeTab === 'subscribers' ? renderSubscriberItem : renderRequestItem}
        keyExtractor={(item) => item.id}
        contentContainerStyle={[styles.listContent, { paddingBottom: insets.bottom + 40 }]}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#FFF" />}
        ListHeaderComponent={
          <View>
            {/* Stats */}
            <View style={styles.statsRow}>
              <View style={styles.statBox}>
                <Ionicons name="card" size={24} color="#8B5CF6" />
                <Text style={styles.statValue}>{subscribers.length}</Text>
                <Text style={styles.statLabel}>{isRTL ? 'المشتركين' : 'Subscribers'}</Text>
              </View>
              <View style={styles.statBox}>
                <Ionicons name="time" size={24} color="#F59E0B" />
                <Text style={styles.statValue}>{pendingRequests.length}</Text>
                <Text style={styles.statLabel}>{isRTL ? 'قيد الانتظار' : 'Pending'}</Text>
              </View>
            </View>
            {/* Tab Toggle */}
            <View style={styles.tabContainer}>
              <TouchableOpacity
                style={[styles.tab, activeTab === 'subscribers' && styles.tabActive]}
                onPress={() => setActiveTab('subscribers')}
              >
                <Text style={[styles.tabText, activeTab === 'subscribers' && styles.tabTextActive]}>
                  {isRTL ? 'المشتركين' : 'Subscribers'}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.tab, activeTab === 'requests' && styles.tabActive]}
                onPress={() => setActiveTab('requests')}
              >
                <Text style={[styles.tabText, activeTab === 'requests' && styles.tabTextActive]}>
                  {isRTL ? 'الطلبات' : 'Requests'}
                </Text>
                {pendingRequests.length > 0 && (
                  <View style={styles.tabBadge}>
                    <Text style={styles.tabBadgeText}>{pendingRequests.length}</Text>
                  </View>
                )}
              </TouchableOpacity>
            </View>
          </View>
        }
        ListEmptyComponent={ListEmptyComponent}
        showsVerticalScrollIndicator={false}
      />

      {/* Add Modal */}
      {showAddModal && (
        <View style={styles.modalOverlay}>
          <BlurView intensity={40} tint="dark" style={StyleSheet.absoluteFill} />
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>{isRTL ? 'إضافة مشترك' : 'Add Subscriber'}</Text>
            <TextInput
              style={styles.modalInput}
              placeholder={isRTL ? 'البريد الإلكتروني' : 'Email'}
              placeholderTextColor="#9CA3AF"
              value={newEmail}
              onChangeText={setNewEmail}
              keyboardType="email-address"
              autoCapitalize="none"
            />
            <View style={styles.modalButtons}>
              <TouchableOpacity style={[styles.modalButton, styles.cancelButton]} onPress={() => setShowAddModal(false)}>
                <Text style={styles.cancelButtonText}>{isRTL ? 'إلغاء' : 'Cancel'}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.modalButton, styles.confirmButton]} onPress={handleAddSubscriber}>
                <Text style={styles.confirmButtonText}>{isRTL ? 'إضافة' : 'Add'}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      )}

      {/* Delete Confirmation Modal — used for both subscribers and requests */}
      <Modal visible={deleteConfirm.visible} transparent animationType="fade" onRequestClose={() => setDeleteConfirm({ visible: false, subId: '', name: '', type: 'subscriber' })}>
        <View style={[styles.modalOverlay, { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }]}>
          <BlurView intensity={40} tint="dark" style={StyleSheet.absoluteFill} />
          <View style={[styles.modalContent, { gap: 18 }]}>
            <Ionicons name="trash-outline" size={40} color="#EF4444" style={{ alignSelf: 'center' }} />
            <Text style={[styles.modalTitle, { color: '#EF4444' }]}>
              {deleteConfirm.type === 'request'
                ? (isRTL ? 'حذف الطلب' : 'Delete Request')
                : (isRTL ? 'حذف المشترك' : 'Delete Subscriber')}
            </Text>
            <Text style={{ color: 'rgba(255,255,255,0.7)', textAlign: 'center', fontSize: 14 }}>
              {isRTL
                ? `هل أنت متأكد من حذف "${deleteConfirm.name}"؟ لا يمكن التراجع.`
                : `Are you sure you want to delete "${deleteConfirm.name}"? This cannot be undone.`}
            </Text>
            <View style={styles.modalButtons}>
              <TouchableOpacity style={[styles.modalButton, styles.cancelButton]} onPress={() => setDeleteConfirm({ visible: false, subId: '', name: '', type: 'subscriber' })}>
                <Text style={styles.cancelButtonText}>{isRTL ? 'إلغاء' : 'Cancel'}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalButton, { backgroundColor: '#EF4444' }]}
                onPress={() => {
                  const id = deleteConfirm.subId;
                  const type = deleteConfirm.type;
                  setDeleteConfirm({ visible: false, subId: '', name: '', type: 'subscriber' });
                  if (type === 'request') {
                    handleDeleteRequest(id);
                  } else {
                    handleDeleteSubscriber(id);
                  }
                }}
              >
                <Text style={[styles.confirmButtonText, { color: '#FFF' }]}>{isRTL ? 'حذف' : 'Delete'}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Request Detail Modal */}
      <Modal
        visible={showRequestDetail}
        transparent
        animationType="slide"
        onRequestClose={() => setShowRequestDetail(false)}
      >
        <View style={styles.detailModalOverlay}>
          <TouchableOpacity 
            style={styles.detailModalBackdrop} 
            onPress={() => setShowRequestDetail(false)} 
            activeOpacity={1}
          />
          <View style={styles.detailModalContent}>
            {/* Modal Header */}
            <View style={styles.detailModalHeader}>
              <Text style={styles.detailModalTitle}>
                {isRTL ? 'تفاصيل طلب الاشتراك' : 'Subscription Request Details'}
              </Text>
              <TouchableOpacity 
                style={styles.detailModalClose}
                onPress={() => setShowRequestDetail(false)}
              >
                <Ionicons name="close" size={24} color="#6B7280" />
              </TouchableOpacity>
            </View>

            {/* Status Badge */}
            {selectedRequest && (
              <View style={[
                styles.statusBadge,
                { backgroundColor: selectedRequest.status === 'approved' ? '#D1FAE5' : '#FEF3C7' }
              ]}>
                <Ionicons 
                  name={selectedRequest.status === 'approved' ? 'checkmark-circle' : 'time'} 
                  size={16} 
                  color={selectedRequest.status === 'approved' ? '#10B981' : '#F59E0B'} 
                />
                <Text style={[
                  styles.statusText,
                  { color: selectedRequest.status === 'approved' ? '#10B981' : '#F59E0B' }
                ]}>
                  {selectedRequest.status === 'approved' 
                    ? (isRTL ? 'تمت الموافقة' : 'Approved')
                    : (isRTL ? 'قيد الانتظار' : 'Pending')
                  }
                </Text>
              </View>
            )}

            {/* Details */}
            <ScrollView style={styles.detailScroll} showsVerticalScrollIndicator={false}>
              {selectedRequest && (
                <>
                  {renderDetailRow('person', isRTL ? 'اسم العميل' : 'Customer Name', selectedRequest.customer_name)}
                  {renderDetailRow(
                    'call', 
                    isRTL ? 'رقم الهاتف' : 'Phone Number', 
                    selectedRequest.phone,
                    () => Linking.openURL(`tel:${selectedRequest.phone}`)
                  )}
                  {renderDetailRow('location', isRTL ? 'المحافظة' : 'Governorate', selectedRequest.governorate)}
                  {renderDetailRow('home', isRTL ? 'القرية/المنطقة' : 'Village/Area', selectedRequest.village)}
                  {renderDetailRow('navigate', isRTL ? 'العنوان بالتفصيل' : 'Detailed Address', selectedRequest.detailed_address)}
                  {renderDetailRow('restaurant', isRTL ? 'مطعمك المفضل' : 'Favorite Restaurant', selectedRequest.car_model_name)}
                  {selectedRequest.description && renderDetailRow(
                    'document-text', 
                    isRTL ? 'ملاحظات إضافية' : 'Additional Notes', 
                    selectedRequest.description
                  )}
                  {renderDetailRow(
                    'calendar', 
                    isRTL ? 'تاريخ الطلب' : 'Request Date', 
                    selectedRequest.created_at ? new Date(selectedRequest.created_at).toLocaleDateString('ar-EG', {
                      year: 'numeric',
                      month: 'long',
                      day: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                    }) : '-'
                  )}
                </>
              )}
            </ScrollView>

            {/* Action Buttons */}
            {selectedRequest && selectedRequest.status === 'pending' && (
              <View style={styles.detailActions}>
                <TouchableOpacity 
                  style={[styles.detailActionButton, styles.approveActionButton]}
                  onPress={() => {
                    handleApproveRequest(selectedRequest.id);
                    setShowRequestDetail(false);
                  }}
                >
                  <Ionicons name="checkmark-circle" size={20} color="#FFF" />
                  <Text style={styles.detailActionText}>
                    {isRTL ? 'الموافقة على الطلب' : 'Approve Request'}
                  </Text>
                </TouchableOpacity>
              </View>
            )}
          </View>
        </View>
      </Modal>

      {/* Task 1: Subscriber Detail Modal */}
      <Modal
        visible={showSubscriberDetail}
        transparent
        animationType="slide"
        onRequestClose={() => setShowSubscriberDetail(false)}
      >
        <View style={styles.detailModalOverlay}>
          <TouchableOpacity 
            style={styles.detailModalBackdrop} 
            onPress={() => setShowSubscriberDetail(false)} 
            activeOpacity={1}
          />
          <View style={styles.detailModalContent}>
            {/* Modal Header */}
            <View style={styles.detailModalHeader}>
              <Text style={styles.detailModalTitle}>
                {isRTL ? 'تفاصيل المشترك' : 'Subscriber Details'}
              </Text>
              <TouchableOpacity 
                style={styles.detailModalClose}
                onPress={() => setShowSubscriberDetail(false)}
              >
                <Ionicons name="close" size={24} color="#6B7280" />
              </TouchableOpacity>
            </View>

            {/* Status Badge */}
            {selectedSubscriber && (
              <View style={[styles.statusBadge, { backgroundColor: '#D1FAE5' }]}>
                <Ionicons name="checkmark-circle" size={16} color="#10B981" />
                <Text style={[styles.statusText, { color: '#10B981' }]}>
                  {isRTL ? 'مشترك نشط' : 'Active Subscriber'}
                </Text>
              </View>
            )}

            {/* Details */}
            <ScrollView style={styles.detailScroll} showsVerticalScrollIndicator={false}>
              {selectedSubscriber && (
                <>
                  {renderDetailRow('person', isRTL ? 'الاسم' : 'Name', selectedSubscriber.name || '-')}
                  {renderDetailRow(
                    'mail', 
                    isRTL ? 'البريد الإلكتروني' : 'Email', 
                    selectedSubscriber.email || '-',
                    selectedSubscriber.email ? () => Linking.openURL(`mailto:${selectedSubscriber.email}`) : undefined
                  )}
                  {renderDetailRow(
                    'call', 
                    isRTL ? 'رقم الهاتف' : 'Phone Number', 
                    selectedSubscriber.phone || '-',
                    selectedSubscriber.phone ? () => Linking.openURL(`tel:${selectedSubscriber.phone}`) : undefined
                  )}
                  {renderDetailRow('location', isRTL ? 'المحافظة' : 'Governorate', selectedSubscriber.governorate || '-')}
                  {renderDetailRow('home', isRTL ? 'القرية/المنطقة' : 'Village/Area', selectedSubscriber.village || '-')}
                  {renderDetailRow('navigate', isRTL ? 'العنوان' : 'Address', selectedSubscriber.address || '-')}
                  {renderDetailRow('restaurant', isRTL ? 'مطعمك المفضل' : 'Favorite Restaurant', selectedSubscriber.car_model || '-')}
                  {renderDetailRow(
                    'calendar', 
                    isRTL ? 'تاريخ الاشتراك' : 'Subscription Date', 
                    selectedSubscriber.created_at ? new Date(selectedSubscriber.created_at).toLocaleDateString('ar-EG', {
                      year: 'numeric',
                      month: 'long',
                      day: 'numeric',
                    }) : '-'
                  )}
                </>
              )}
            </ScrollView>

            {/* Action: Navigate to Customer Profile */}
            {selectedSubscriber && (
              <View style={styles.detailActions}>
                {(() => {
                  const customer = findCustomerByContact(selectedSubscriber.email, selectedSubscriber.phone);
                  if (customer) {
                    return (
                      <TouchableOpacity 
                        style={[styles.detailActionButton, { backgroundColor: '#3B82F6' }]}
                        onPress={() => {
                          setShowSubscriberDetail(false);
                          navigateToCustomerProfile(customer.id);
                        }}
                      >
                        <Ionicons name="person" size={20} color="#FFF" />
                        <Text style={styles.detailActionText}>
                          {isRTL ? 'عرض ملف العميل' : 'View Customer Profile'}
                        </Text>
                      </TouchableOpacity>
                    );
                  }
                  return null;
                })()}
              </View>
            )}
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  fixedHeader: { paddingHorizontal: 16 },
  listContent: { paddingHorizontal: 16, paddingTop: 12 },
  header: { flexDirection: 'row', alignItems: 'center', paddingVertical: 16, gap: 12 },
  headerRTL: { flexDirection: 'row-reverse' },
  backButton: { width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.15)', alignItems: 'center', justifyContent: 'center' },
  headerTitle: { flex: 1, fontSize: 24, fontWeight: '700', color: '#FFF' },
  addButton: { width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.25)', alignItems: 'center', justifyContent: 'center' },
  statsRow: { flexDirection: 'row', gap: 12, marginTop: 8 },
  statBox: { flex: 1, backgroundColor: 'rgba(255,255,255,0.1)', borderRadius: 16, padding: 16, alignItems: 'center' },
  statValue: { fontSize: 28, fontWeight: '700', color: '#FFF', marginTop: 8 },
  statLabel: { fontSize: 12, color: 'rgba(255,255,255,0.7)', marginTop: 4 },
  tabContainer: { flexDirection: 'row', backgroundColor: 'rgba(255,255,255,0.1)', borderRadius: 12, padding: 4, marginTop: 20 },
  tab: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 12, borderRadius: 10, gap: 8 },
  tabActive: { backgroundColor: 'rgba(139,92,246,0.8)' },
  tabText: { fontSize: 14, color: 'rgba(255,255,255,0.6)', fontWeight: '600' },
  tabTextActive: { color: '#FFF' },
  tabBadge: { backgroundColor: '#EF4444', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 8 },
  tabBadgeText: { fontSize: 10, color: '#FFF', fontWeight: '700' },
  listContainer: { marginTop: 20 },
  card: { marginBottom: 12, borderRadius: 16, overflow: 'hidden' },
  cardBlur: { flexDirection: 'row', alignItems: 'center', padding: 16, backgroundColor: 'rgba(255,255,255,0.1)' },
  // Request Card Styles - Professional Layout
  requestCardBlur: { padding: 16, backgroundColor: 'rgba(255,255,255,0.1)' },
  requestTopRow: { flexDirection: 'row', alignItems: 'center' },
  requestNameSection: { flex: 1, marginLeft: 12 },
  requestSubInfo: { flexDirection: 'row', alignItems: 'center', marginTop: 4, gap: 6 },
  requestDot: { color: 'rgba(255,255,255,0.4)', fontSize: 10 },
  // Email Center Row - Professional Display
  emailCenterRow: { 
    flexDirection: 'row', 
    alignItems: 'center', 
    marginTop: 12, 
    paddingTop: 12, 
    borderTopWidth: 1, 
    borderTopColor: 'rgba(255,255,255,0.1)',
    backgroundColor: 'rgba(96,165,250,0.1)',
    marginHorizontal: -16,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  emailIconContainer: { 
    width: 28, 
    height: 28, 
    borderRadius: 14, 
    backgroundColor: 'rgba(96,165,250,0.2)', 
    alignItems: 'center', 
    justifyContent: 'center',
    marginRight: 10,
  },
  emailTouchable: { flex: 1 },
  emailCenterText: { fontSize: 14, color: '#60A5FA', fontWeight: '500' },
  copyButtonCenter: { 
    flexDirection: 'row', 
    alignItems: 'center', 
    backgroundColor: 'rgba(96,165,250,0.2)', 
    paddingHorizontal: 12, 
    paddingVertical: 6, 
    borderRadius: 16,
    gap: 4,
  },
  copyText: { fontSize: 12, color: '#60A5FA', fontWeight: '600' },
  avatar: { width: 48, height: 48, borderRadius: 24, backgroundColor: 'rgba(139,92,246,0.2)', alignItems: 'center', justifyContent: 'center' },
  info: { flex: 1, marginLeft: 12 },
  name: { fontSize: 16, fontWeight: '600', color: '#FFF' },
  email: { fontSize: 13, color: 'rgba(255,255,255,0.7)', marginTop: 2 },
  emailClickable: { color: '#60A5FA', textDecorationLine: 'underline' },
  emailRow: { flexDirection: 'row', alignItems: 'center', marginTop: 2, gap: 6 },
  copyButton: { padding: 4 },
  phone: { fontSize: 12, color: 'rgba(255,255,255,0.6)' },
  date: { fontSize: 12, color: 'rgba(255,255,255,0.5)' },
  swipeHint: { opacity: 0.5 },
  customerBadge: { width: 28, height: 28, borderRadius: 14, backgroundColor: 'rgba(16,185,129,0.2)', alignItems: 'center', justifyContent: 'center', marginRight: 8 },
  actionButtons: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  approveButton: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#10B981', alignItems: 'center', justifyContent: 'center' },
  profileButton: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#3B82F6', alignItems: 'center', justifyContent: 'center' },
  customerProfileButton: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#10B981', alignItems: 'center', justifyContent: 'center' },
  approvedBadge: { width: 28, height: 28, borderRadius: 14, backgroundColor: 'rgba(16,185,129,0.3)', alignItems: 'center', justifyContent: 'center' },
  approvedText: { fontSize: 12, color: '#10B981', fontWeight: '600' },
  emptyState: { alignItems: 'center', paddingVertical: 60 },
  emptyText: { color: 'rgba(255,255,255,0.5)', fontSize: 16, marginTop: 16 },
  modalOverlay: { ...StyleSheet.absoluteFillObject, justifyContent: 'center', alignItems: 'center', padding: 24 },
  modalContent: { backgroundColor: '#FFF', borderRadius: 20, padding: 24, width: '100%', maxWidth: 340 },
  modalTitle: { fontSize: 20, fontWeight: '700', color: '#1F2937', marginBottom: 20, textAlign: 'center' },
  modalInput: { backgroundColor: '#F3F4F6', borderRadius: 12, paddingHorizontal: 16, paddingVertical: 14, fontSize: 16, marginBottom: 12, color: '#1F2937' },
  modalButtons: { flexDirection: 'row', gap: 12, marginTop: 8 },
  modalButton: { flex: 1, paddingVertical: 14, borderRadius: 12, alignItems: 'center' },
  cancelButton: { backgroundColor: '#F3F4F6' },
  cancelButtonText: { fontSize: 16, fontWeight: '600', color: '#6B7280' },
  confirmButton: { backgroundColor: '#8B5CF6' },
  confirmButtonText: { fontSize: 16, fontWeight: '600', color: '#FFF' },
  // Request Detail Modal Styles
  detailModalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  detailModalBackdrop: { flex: 1 },
  detailModalContent: { backgroundColor: '#FFF', borderTopLeftRadius: 24, borderTopRightRadius: 24, maxHeight: '85%', paddingBottom: 20 },
  detailModalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 20, borderBottomWidth: 1, borderBottomColor: '#F3F4F6' },
  detailModalTitle: { fontSize: 18, fontWeight: '700', color: '#1F2937' },
  detailModalClose: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#F3F4F6', alignItems: 'center', justifyContent: 'center' },
  statusBadge: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', marginHorizontal: 20, marginTop: 16, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20, gap: 6 },
  statusText: { fontSize: 13, fontWeight: '600' },
  detailScroll: { paddingHorizontal: 20, paddingTop: 16, maxHeight: 400 },
  detailRow: { flexDirection: 'row', alignItems: 'flex-start', paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: '#F3F4F6' },
  detailIconContainer: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#F3F4F6', alignItems: 'center', justifyContent: 'center', marginRight: 12 },
  detailContent: { flex: 1 },
  detailLabel: { fontSize: 12, color: '#9CA3AF', marginBottom: 4 },
  detailValue: { fontSize: 15, color: '#1F2937', fontWeight: '500' },
  detailActions: { paddingHorizontal: 20, paddingTop: 16 },
  detailActionButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 14, borderRadius: 12, gap: 8 },
  approveActionButton: { backgroundColor: '#10B981' },
  detailActionText: { fontSize: 16, fontWeight: '600', color: '#FFF' },
});


/* __ACCESS_GUARD_APPLIED__ */
export default function SubscriptionsScreenGuarded(props: any) {
  return (
    <__AccessGuard__ scope="owner">
      <SubscriptionsScreen {...props} />
    </__AccessGuard__>
  );
}

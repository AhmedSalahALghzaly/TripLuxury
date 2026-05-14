import React, { useCallback, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  TextInput, ActivityIndicator, Alert, Platform, ToastAndroid,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Header } from '../src/components/Header';
import { useTheme } from '../src/hooks/useTheme';
import { useTranslation } from '../src/hooks/useTranslation';
import { useAppStore } from '../src/store/appStore';
import { userAddressApi, type UserAddress, type UserAddressLabel } from '../src/services/api';
import { MapsPreviewStrip } from '../src/components/MapsPreviewStrip';
import { PinPickerModal } from '../src/components/PinPickerModal';

const LABELS: { key: UserAddressLabel; ar: string; en: string; icon: any }[] = [
  { key: 'home', ar: 'المنزل',  en: 'Home', icon: 'home' },
  { key: 'work', ar: 'العمل',   en: 'Work', icon: 'briefcase' },
  { key: 'club', ar: 'النادي',  en: 'Club', icon: 'flag' },
];

export default function SavedAddressesScreen() {
  const { colors } = useTheme();
  const { language, isRTL } = useTranslation();
  const ar = language === 'ar';
  const { user } = useAppStore();
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['/api/user-addresses'],
    queryFn: () => userAddressApi.list().then((r) => r.data.addresses),
    enabled: !!user,
  });

  const upsert = useMutation({
    mutationFn: (input: { label: UserAddressLabel; body: Partial<UserAddress> }) =>
      userAddressApi.upsert(input.label, input.body).then((r) => r.data.address),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['/api/user-addresses'] }),
  });

  const remove = useMutation({
    mutationFn: (label: UserAddressLabel) => userAddressApi.remove(label),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['/api/user-addresses'] }),
  });

  const byLabel = (label: UserAddressLabel): UserAddress | undefined =>
    (data || []).find((a) => a.label === label);

  if (!user) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
        <Header title={ar ? 'العناوين المحفوظة' : 'Saved Addresses'} showBack />
        <View style={styles.center}>
          <Text style={{ color: colors.textSecondary }}>
            {ar ? 'سجّل دخولك أولاً' : 'Please sign in first'}
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      <Header title={ar ? 'العناوين المحفوظة' : 'Saved Addresses'} showBack />
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
        <Text style={[styles.intro, { color: colors.textSecondary, textAlign: isRTL ? 'right' : 'left' }]}>
          {ar
            ? 'احفظ حتى 3 عناوين (المنزل، العمل، النادي) لإكمال الطلب بسرعة.'
            : 'Save up to 3 addresses (home, work, club) for faster checkout.'}
        </Text>
        {isLoading ? (
          <ActivityIndicator size="large" style={{ marginTop: 40 }} color={colors.primary} />
        ) : (
          LABELS.map((L) => (
            <SlotCard
              key={L.key}
              label={L}
              ar={ar}
              isRTL={isRTL}
              colors={colors}
              existing={byLabel(L.key)}
              onSave={(body) => upsert.mutateAsync({ label: L.key, body })}
              onDelete={() => {
                const doDelete = () => remove.mutate(L.key);
                if (Platform.OS === 'web') {
                  if (window.confirm(ar ? 'حذف هذا العنوان؟' : 'Delete this address?')) doDelete();
                } else {
                  Alert.alert(
                    ar ? 'حذف' : 'Delete',
                    ar ? 'حذف هذا العنوان؟' : 'Delete this address?',
                    [
                      { text: ar ? 'إلغاء' : 'Cancel', style: 'cancel' },
                      { text: ar ? 'حذف' : 'Delete', style: 'destructive', onPress: doDelete },
                    ],
                  );
                }
              }}
              busy={upsert.isPending || remove.isPending}
            />
          ))
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

interface SlotProps {
  label: { key: UserAddressLabel; ar: string; en: string; icon: any };
  ar: boolean;
  isRTL: boolean;
  colors: any;
  existing?: UserAddress;
  onSave: (body: Partial<UserAddress>) => Promise<any>;
  onDelete: () => void;
  busy: boolean;
}

const SlotCard = ({ label, ar, isRTL, colors, existing, onSave, onDelete, busy }: SlotProps) => {
  const [editing, setEditing] = useState(!existing);
  const [governorate, setGovernorate] = useState(existing?.governorate || '');
  const [city, setCity] = useState(existing?.city || '');
  const [address, setAddress] = useState(existing?.address || '');
  const [phone, setPhone] = useState(existing?.phone || '');
  const [latitude, setLatitude] = useState<number | null>(
    existing?.latitude != null ? Number(existing.latitude) : null,
  );
  const [longitude, setLongitude] = useState<number | null>(
    existing?.longitude != null ? Number(existing.longitude) : null,
  );
  const [gpsLoading, setGpsLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [updatingPin, setUpdatingPin] = useState(false);
  const [showGpsNudge, setShowGpsNudge] = useState(false);
  const [highlightGps, setHighlightGps] = useState(false);
  const [pinPickerVisible, setPinPickerVisible] = useState(false);

  // Sync local form state when the underlying record changes (after
  // upsert / delete from another source). Without this the slot would
  // stay stuck on its initial values until the screen is remounted.
  const existingId = existing?.id ?? null;
  React.useEffect(() => {
    setGovernorate(existing?.governorate || '');
    setCity(existing?.city || '');
    setAddress(existing?.address || '');
    setPhone(existing?.phone || '');
    setLatitude(existing?.latitude != null ? Number(existing.latitude) : null);
    setLongitude(existing?.longitude != null ? Number(existing.longitude) : null);
    setEditing(!existing);
    setShowGpsNudge(false);
    setHighlightGps(false);
  }, [existingId]); // eslint-disable-line react-hooks/exhaustive-deps

  const pickGps = useCallback(async () => {
    if (gpsLoading) return;
    setGpsLoading(true);
    try {
      const Location = await import('expo-location');
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('', ar ? 'تم رفض إذن الموقع' : 'Location permission denied');
        return;
      }
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      setLatitude(pos.coords.latitude);
      setLongitude(pos.coords.longitude);
      try {
        const geo = await Location.reverseGeocodeAsync({
          latitude: pos.coords.latitude, longitude: pos.coords.longitude,
        });
        const f = geo?.[0];
        if (f) {
          const newAddr = [f.name, f.street, f.district || f.subregion].filter(Boolean).join(', ');
          const newGov  = f.region ? String(f.region) : '';
          const newCity = f.city   ? String(f.city)   : '';

          const curAddr = address.trim();
          const curGov  = governorate.trim();
          const curCity = city.trim();

          // Blank fields get filled immediately — no prompt needed
          if (!curAddr && newAddr) setAddress(newAddr);
          if (!curGov  && newGov)  setGovernorate(newGov);
          if (!curCity && newCity) setCity(newCity);

          // Check if any already-filled field would change
          const addrDiffers = !!curAddr && !!newAddr && newAddr !== curAddr;
          const govDiffers  = !!curGov  && !!newGov  && newGov  !== curGov;
          const cityDiffers = !!curCity && !!newCity && newCity !== curCity;

          if (addrDiffers || govDiffers || cityDiffers) {
            const applyUpdate = () => {
              if (addrDiffers) setAddress(newAddr);
              if (govDiffers)  setGovernorate(newGov);
              if (cityDiffers) setCity(newCity);
            };

            const promptMsg = ar
              ? 'تحديث حقول العنوان لتطابق الموقع الجديد؟'
              : 'Update address text to match the new pin?';

            if (Platform.OS === 'web') {
              if (window.confirm(promptMsg)) applyUpdate();
            } else {
              Alert.alert(
                ar ? 'تحديث العنوان؟' : 'Update address?',
                promptMsg,
                [
                  { text: ar ? 'إبقاء النص الحالي' : 'Keep current', style: 'cancel' },
                  { text: ar ? 'تحديث' : 'Update', onPress: applyUpdate },
                ],
              );
            }
          }
        }
      } catch {}
    } catch {
      Alert.alert('', ar ? 'تعذّر تحديد الموقع' : 'Could not get location');
    } finally { setGpsLoading(false); }
  }, [ar, address, city, governorate, gpsLoading]);

  const saveNow = async (lat: number | null, lng: number | null) => {
    setSaving(true);
    try {
      await onSave({
        address: address.trim(),
        governorate: governorate.trim() || null,
        city: city.trim() || null,
        latitude: lat, longitude: lng,
        phone: phone.trim() || null,
      });
      setEditing(false);
      setShowGpsNudge(false);
      if (lat != null && lng != null && Platform.OS === 'android') {
        ToastAndroid.show(ar ? '✓ تم حفظ الموقع' : '✓ Location saved', ToastAndroid.SHORT);
      }
    } catch (e: any) {
      Alert.alert('', e?.response?.data?.detail || (ar ? 'فشل الحفظ' : 'Save failed'));
    } finally { setSaving(false); }
  };

  const submit = async () => {
    if (!address.trim()) {
      Alert.alert('', ar ? 'الرجاء إدخال العنوان' : 'Please enter the address');
      return;
    }
    if (latitude == null || longitude == null) {
      setShowGpsNudge(true);
      return;
    }
    await saveNow(latitude, longitude);
  };

  const pickGpsAndSave = useCallback(async () => {
    if (gpsLoading) return;
    setGpsLoading(true);
    let lat: number | null = null;
    let lng: number | null = null;
    try {
      const Location = await import('expo-location');
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('', ar ? 'تم رفض إذن الموقع' : 'Location permission denied');
        return;
      }
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      lat = pos.coords.latitude;
      lng = pos.coords.longitude;
      setLatitude(lat);
      setLongitude(lng);
      try {
        const geo = await Location.reverseGeocodeAsync({ latitude: lat, longitude: lng });
        const f = geo?.[0];
        if (f) {
          const newAddr = [f.name, f.street, f.district || f.subregion].filter(Boolean).join(', ');
          const newGov  = f.region ? String(f.region) : '';
          const newCity = f.city   ? String(f.city)   : '';

          const curAddr = address.trim();
          const curGov  = governorate.trim();
          const curCity = city.trim();

          // Blank fields get filled immediately — no prompt needed
          if (!curAddr && newAddr) setAddress(newAddr);
          if (!curGov  && newGov)  setGovernorate(newGov);
          if (!curCity && newCity) setCity(newCity);

          const finalAddr = newAddr || curAddr;
          const finalGov  = newGov  || curGov;
          const finalCity = newCity || curCity;

          // Check if any already-filled field would change
          const addrDiffers = !!curAddr && !!newAddr && newAddr !== curAddr;
          const govDiffers  = !!curGov  && !!newGov  && newGov  !== curGov;
          const cityDiffers = !!curCity && !!newCity && newCity !== curCity;

          if (addrDiffers || govDiffers || cityDiffers) {
            const applyUpdate = () => {
              if (addrDiffers) setAddress(newAddr);
              if (govDiffers)  setGovernorate(newGov);
              if (cityDiffers) setCity(newCity);
              setSaving(true);
              onSave({
                address:     finalAddr,
                governorate: finalGov  || null,
                city:        finalCity || null,
                latitude: lat,
                longitude: lng,
                phone: phone.trim() || null,
              }).then(() => {
                setEditing(false);
                setShowGpsNudge(false);
              }).catch((e: any) => {
                Alert.alert('', e?.response?.data?.detail || (ar ? 'فشل الحفظ' : 'Save failed'));
              }).finally(() => setSaving(false));
            };
            const keepCurrent = () => { if (lat != null) saveNow(lat, lng); };

            const promptMsg = ar
              ? 'تحديث حقول العنوان لتطابق الموقع الجديد؟'
              : 'Update address text to match the new pin?';

            if (Platform.OS === 'web') {
              if (window.confirm(promptMsg)) applyUpdate(); else keepCurrent();
            } else {
              Alert.alert(
                ar ? 'تحديث العنوان؟' : 'Update address?',
                promptMsg,
                [
                  { text: ar ? 'إبقاء النص الحالي' : 'Keep current', style: 'cancel', onPress: keepCurrent },
                  { text: ar ? 'تحديث' : 'Update', onPress: applyUpdate },
                ],
              );
            }
            return; // save handled inside alert callbacks
          }
        }
      } catch {}
    } catch {
      Alert.alert('', ar ? 'تعذّر تحديد الموقع' : 'Could not get location');
      return;
    } finally { setGpsLoading(false); }
    if (lat != null) {
      await saveNow(lat, lng);
    }
  }, [ar, address, city, governorate, gpsLoading, phone, onSave]); // eslint-disable-line react-hooks/exhaustive-deps

  const handlePinPickerConfirm = useCallback(
    async (result: { latitude: number; longitude: number }, andSave = false) => {
      setPinPickerVisible(false);
      setLatitude(result.latitude);
      setLongitude(result.longitude);
      const lat = result.latitude;
      const lng = result.longitude;
      try {
        const Location = await import('expo-location');
        const geo = await Location.reverseGeocodeAsync({ latitude: lat, longitude: lng });
        const f = geo?.[0];
        if (f) {
          const newAddr = [f.name, f.street, f.district || f.subregion].filter(Boolean).join(', ');
          const newGov = f.region ? String(f.region) : '';
          const newCity = f.city ? String(f.city) : '';

          const curAddr = address.trim();
          const curGov = governorate.trim();
          const curCity = city.trim();

          // Fields that are blank get filled immediately (no prompt needed)
          if (!curAddr && newAddr) setAddress(newAddr);
          if (!curGov && newGov) setGovernorate(newGov);
          if (!curCity && newCity) setCity(newCity);

          // Check if any already-filled field would change
          const addrDiffers = !!curAddr && !!newAddr && newAddr !== curAddr;
          const govDiffers  = !!curGov  && !!newGov  && newGov  !== curGov;
          const cityDiffers = !!curCity  && !!newCity  && newCity  !== curCity;

          // Final values after accepting the prompt — prefers geocoded value
          // over current so that auto-filled (blank→new) fields are also persisted.
          const finalAddr = newAddr || curAddr;
          const finalGov  = newGov  || curGov;
          const finalCity = newCity || curCity;

          if (addrDiffers || govDiffers || cityDiffers) {
            const applyUpdate = () => {
              if (addrDiffers) setAddress(newAddr);
              if (govDiffers)  setGovernorate(newGov);
              if (cityDiffers) setCity(newCity);
              if (andSave) {
                // Use final resolved values so auto-filled blank fields are
                // included alongside the user-accepted overwritten fields.
                setSaving(true);
                onSave({
                  address:     finalAddr,
                  governorate: finalGov  || null,
                  city:        finalCity || null,
                  latitude: lat,
                  longitude: lng,
                  phone: phone.trim() || null,
                }).catch((e: any) => {
                  Alert.alert('', e?.response?.data?.detail || (ar ? 'فشل الحفظ' : 'Save failed'));
                }).finally(() => setSaving(false));
              }
            };
            const keepCurrent = () => {
              if (andSave) saveNow(lat, lng);
            };

            const promptMsg = ar
              ? 'تحديث حقول العنوان لتطابق الموقع الجديد؟'
              : 'Update address text to match the new pin?';

            if (Platform.OS === 'web') {
              if (window.confirm(promptMsg)) applyUpdate(); else keepCurrent();
            } else {
              Alert.alert(
                ar ? 'تحديث العنوان؟' : 'Update address?',
                promptMsg,
                [
                  { text: ar ? 'إبقاء النص الحالي' : 'Keep current', style: 'cancel', onPress: keepCurrent },
                  { text: ar ? 'تحديث'              : 'Update',       onPress: applyUpdate },
                ],
              );
            }
            return; // saveNow handled inside the alert callbacks above
          }
        }
      } catch {}
      if (andSave) {
        await saveNow(lat, lng);
      }
    },
    [address, governorate, city, ar, phone, onSave], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const updateLocationOnly = useCallback(async () => {
    if (updatingPin) return;
    setUpdatingPin(true);
    let lat: number;
    let lng: number;
    try {
      const Location = await import('expo-location');
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('', ar ? 'تم رفض إذن الموقع' : 'Location permission denied');
        return;
      }
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      lat = pos.coords.latitude;
      lng = pos.coords.longitude;
    } catch {
      Alert.alert('', ar ? 'تعذّر تحديد الموقع' : 'Could not get location');
      setUpdatingPin(false);
      return;
    }
    setLatitude(lat);
    setLongitude(lng);
    try {
      await onSave({
        address: address.trim() || (existing?.address ?? ''),
        governorate: governorate.trim() || existing?.governorate || null,
        city: city.trim() || existing?.city || null,
        latitude: lat,
        longitude: lng,
        phone: phone.trim() || existing?.phone || null,
      });
    } catch (e: any) {
      Alert.alert('', e?.response?.data?.detail || (ar ? 'فشل حفظ الموقع' : 'Failed to save location'));
    } finally {
      setUpdatingPin(false);
    }
  }, [ar, updatingPin, address, governorate, city, phone, existing, onSave]);

  return (
    <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <View style={[styles.row, isRTL && { flexDirection: 'row-reverse' }]}>
        <View style={[styles.iconBubble, { backgroundColor: colors.primary + '22' }]}>
          <Ionicons name={label.icon} size={20} color={colors.primary} />
        </View>
        <Text style={[styles.cardTitle, { color: colors.text, flex: 1, textAlign: isRTL ? 'right' : 'left', marginHorizontal: 12 }]}>
          {ar ? label.ar : label.en}
        </Text>
        {existing && !editing && (
          <TouchableOpacity onPress={() => setEditing(true)} style={styles.iconBtn}>
            <Ionicons name="create-outline" size={18} color={colors.primary} />
          </TouchableOpacity>
        )}
        {existing && (
          <TouchableOpacity onPress={onDelete} style={styles.iconBtn} disabled={busy}>
            <Ionicons name="trash-outline" size={18} color="#EF4444" />
          </TouchableOpacity>
        )}
      </View>

      {editing ? (
        <>
          <TextInput
            value={governorate}
            onChangeText={setGovernorate}
            placeholder={ar ? 'المحافظة' : 'Governorate'}
            placeholderTextColor={colors.textSecondary}
            style={[styles.input, { color: colors.text, borderColor: colors.border, backgroundColor: colors.surface, textAlign: isRTL ? 'right' : 'left' }]}
          />
          <TextInput
            value={city}
            onChangeText={setCity}
            placeholder={ar ? 'المدينة / المنطقة' : 'City / Area'}
            placeholderTextColor={colors.textSecondary}
            style={[styles.input, { color: colors.text, borderColor: colors.border, backgroundColor: colors.surface, textAlign: isRTL ? 'right' : 'left' }]}
          />
          <TextInput
            value={address}
            onChangeText={setAddress}
            multiline
            numberOfLines={2}
            placeholder={ar ? 'العنوان بالتفصيل *' : 'Detailed address *'}
            placeholderTextColor={colors.textSecondary}
            style={[styles.input, { minHeight: 60, color: colors.text, borderColor: colors.border, backgroundColor: colors.surface, textAlign: isRTL ? 'right' : 'left' }]}
          />
          <TextInput
            value={phone}
            onChangeText={setPhone}
            keyboardType="phone-pad"
            placeholder={ar ? 'رقم الهاتف (اختياري)' : 'Phone (optional)'}
            placeholderTextColor={colors.textSecondary}
            style={[styles.input, { color: colors.text, borderColor: colors.border, backgroundColor: colors.surface, textAlign: isRTL ? 'right' : 'left' }]}
          />
          <View style={[styles.row, { gap: 8, marginTop: 10 }]}>
            <TouchableOpacity
              onPress={() => { setHighlightGps(false); pickGps(); }}
              disabled={gpsLoading}
              style={[
                styles.gpsBtn,
                { flex: 1, borderColor: colors.primary + '60', backgroundColor: colors.primary + '10' },
                highlightGps && { borderColor: colors.primary, backgroundColor: colors.primary + '22', borderWidth: 2 },
              ]}
            >
              {gpsLoading
                ? <ActivityIndicator size="small" color={colors.primary} />
                : <Ionicons name={latitude != null ? 'checkmark-circle' : 'navigate'} size={16} color={colors.primary} />
              }
              <Text style={{ color: colors.primary, fontWeight: '700', fontSize: 13 }}>
                {gpsLoading
                  ? (ar ? 'جارِ التحديد…' : 'Locating…')
                  : latitude != null
                    ? (ar ? '✓ تم تحديد — تحديث' : '✓ Set — Update')
                    : (ar ? 'موقعي الحالي' : 'My location')}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => setPinPickerVisible(true)}
              style={[styles.gpsBtn, { borderColor: colors.primary + '60', backgroundColor: colors.primary + '10' }]}
            >
              <Ionicons name="pin" size={16} color={colors.primary} />
              <Text style={{ color: colors.primary, fontWeight: '700', fontSize: 13 }}>
                {ar ? 'تحديد على الخريطة' : 'Pick on map'}
              </Text>
            </TouchableOpacity>
          </View>
          {latitude != null && longitude != null && (
            <View style={{ marginTop: 8 }}>
              <MapsPreviewStrip
                latitude={latitude}
                longitude={longitude}
                height={110}
                showOpenButton={false}
                rounded
                onMovePinPress={() => setPinPickerVisible(true)}
              />
            </View>
          )}

          {showGpsNudge && (latitude == null || longitude == null) && (
            <View style={[styles.nudgeBanner, { backgroundColor: colors.primary + '15', borderColor: colors.primary + '40' }]}>
              <View style={[styles.row, { gap: 8, marginBottom: 10, flexDirection: isRTL ? 'row-reverse' : 'row' }]}>
                <Ionicons name="location-outline" size={18} color={colors.primary} />
                <Text style={{ color: colors.text, fontSize: 13, fontWeight: '600', flex: 1, textAlign: isRTL ? 'right' : 'left' }}>
                  {ar ? 'أضف موقعك لتوصيل أسرع؟' : 'Add your location for easier delivery?'}
                </Text>
              </View>
              <View style={[styles.row, { gap: 8, flexDirection: isRTL ? 'row-reverse' : 'row' }]}>
                <TouchableOpacity
                  style={[styles.nudgeBtn, { backgroundColor: colors.primary, opacity: gpsLoading || saving ? 0.6 : 1 }]}
                  onPress={pickGpsAndSave}
                  disabled={gpsLoading || saving}
                >
                  {gpsLoading
                    ? <ActivityIndicator color="#fff" size="small" />
                    : <Text style={{ color: '#fff', fontWeight: '700', fontSize: 12 }}>
                        {ar ? 'تحديد الموقع والحفظ' : 'Add Location & Save'}
                      </Text>
                  }
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.nudgeBtn, { borderWidth: 1, borderColor: colors.border, opacity: saving ? 0.6 : 1 }]}
                  onPress={() => { setShowGpsNudge(false); saveNow(null, null); }}
                  disabled={saving}
                >
                  {saving
                    ? <ActivityIndicator color={colors.textSecondary} size="small" />
                    : <Text style={{ color: colors.textSecondary, fontWeight: '600', fontSize: 12 }}>
                        {ar ? 'حفظ بدون موقع' : 'Save Without Location'}
                      </Text>
                  }
                </TouchableOpacity>
              </View>
            </View>
          )}

          <View style={[styles.row, { marginTop: 12, gap: 8 }]}>
            {existing && (
              <TouchableOpacity
                style={[styles.btnSecondary, { borderColor: colors.border }]}
                onPress={() => { setEditing(false); setHighlightGps(false); }}
              >
                <Text style={{ color: colors.textSecondary, fontWeight: '600' }}>
                  {ar ? 'إلغاء' : 'Cancel'}
                </Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity
              style={[styles.btnPrimary, { backgroundColor: colors.primary, opacity: saving ? 0.6 : 1 }]}
              onPress={submit}
              disabled={saving}
            >
              {saving
                ? <ActivityIndicator color="#fff" size="small" />
                : <Text style={{ color: '#fff', fontWeight: '700' }}>
                    {ar ? (existing ? 'تحديث' : 'حفظ') : (existing ? 'Update' : 'Save')}
                  </Text>
              }
            </TouchableOpacity>
          </View>
        </>
      ) : existing ? (
        <View>
          <Text style={[styles.line, { color: colors.text, textAlign: isRTL ? 'right' : 'left' }]}>
            {[existing.governorate, existing.city, existing.address].filter(Boolean).join(' - ')}
          </Text>
          {existing.phone ? (
            <Text style={[styles.lineMeta, { color: colors.textSecondary, textAlign: isRTL ? 'right' : 'left' }]}>
              {existing.phone}
            </Text>
          ) : null}
          {latitude != null && longitude != null ? (
            <View style={{ marginTop: 10 }}>
              <MapsPreviewStrip
                latitude={latitude}
                longitude={longitude}
                height={130}
                showOpenButton
                rounded
                onMovePinPress={() => setPinPickerVisible(true)}
              />
              <View style={[styles.row, { gap: 8, marginTop: 8 }]}>
                <TouchableOpacity
                  style={[styles.updatePinBtn, { flex: 1, borderColor: colors.primary + '60', backgroundColor: colors.primary + '10' }]}
                  onPress={updateLocationOnly}
                  disabled={updatingPin || busy}
                  activeOpacity={0.75}
                >
                  {updatingPin
                    ? <ActivityIndicator size="small" color={colors.primary} />
                    : <Ionicons name="navigate" size={15} color={colors.primary} />
                  }
                  <Text style={{ color: colors.primary, fontSize: 12, fontWeight: '700' }}>
                    {updatingPin
                      ? (ar ? 'جارِ التحديث…' : 'Updating…')
                      : (ar ? 'موقعي الحالي' : 'My location')}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.updatePinBtn, { flex: 1, borderColor: colors.primary + '60', backgroundColor: colors.primary + '10' }]}
                  onPress={() => setPinPickerVisible(true)}
                  disabled={updatingPin || busy}
                  activeOpacity={0.75}
                >
                  <Ionicons name="pin" size={15} color={colors.primary} />
                  <Text style={{ color: colors.primary, fontSize: 12, fontWeight: '700' }}>
                    {ar ? 'تحريك الدبوس' : 'Move pin'}
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          ) : (
            <TouchableOpacity
              style={[styles.noPinBanner, { borderColor: colors.primary + '50', backgroundColor: colors.primary + '0D' }]}
              onPress={() => { setHighlightGps(true); setEditing(true); }}
              activeOpacity={0.75}
            >
              <Ionicons name="location-outline" size={15} color={colors.primary} />
              <Text style={{ color: colors.primary, fontSize: 12, fontWeight: '600', flex: 1, textAlign: isRTL ? 'right' : 'left' }}>
                {ar ? 'لا يوجد موقع — اضغط لإضافة إحداثيات GPS' : 'No location pinned — tap to add GPS'}
              </Text>
              <Ionicons name={isRTL ? 'chevron-back' : 'chevron-forward'} size={14} color={colors.primary} />
            </TouchableOpacity>
          )}
        </View>
      ) : null}

      <PinPickerModal
        visible={pinPickerVisible}
        initialLatitude={latitude}
        initialLongitude={longitude}
        onClose={() => setPinPickerVisible(false)}
        onConfirm={(result) => {
          if (editing) {
            // In edit mode: just update state; user presses Save themselves
            handlePinPickerConfirm(result, false);
          } else {
            // In view mode: update coords and save immediately
            handlePinPickerConfirm(result, true);
          }
        }}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  intro: { fontSize: 13, marginBottom: 16 },
  card: { padding: 14, borderWidth: 1, borderRadius: 14, marginBottom: 12 },
  row: { flexDirection: 'row', alignItems: 'center' },
  iconBubble: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  iconBtn: { padding: 6 },
  cardTitle: { fontSize: 16, fontWeight: '700' },
  input: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, marginTop: 10 },
  gpsBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 12, borderRadius: 10, borderWidth: 1, marginTop: 10, justifyContent: 'center' },
  btnPrimary: { flex: 1, paddingVertical: 12, borderRadius: 10, alignItems: 'center' },
  btnSecondary: { flex: 1, paddingVertical: 12, borderRadius: 10, borderWidth: 1, alignItems: 'center' },
  line: { fontSize: 14, marginTop: 10 },
  lineMeta: { fontSize: 12, marginTop: 4 },
  nudgeBanner: { borderWidth: 1, borderRadius: 10, padding: 12, marginTop: 10 },
  nudgeBtn: { flex: 1, paddingVertical: 9, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  noPinBanner: { flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, marginTop: 10 },
  updatePinBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderWidth: 1, borderRadius: 10, paddingVertical: 9, marginTop: 8 },
});

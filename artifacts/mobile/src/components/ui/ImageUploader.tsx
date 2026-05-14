/**
 * Reusable Image Uploader Component
 * Opens device gallery/folders to select images directly
 * Modern 2025 UX with animations and progress
 * Features: Auto-compression for images >1MB, PNG format preservation
 */
import React, { useState, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Animated,
  ActivityIndicator,
  ScrollView,
  Alert,
  Platform,
} from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import * as ImagePicker from 'expo-image-picker';
import * as Haptics from 'expo-haptics';
import { useTheme } from '../../hooks/useTheme';
import { useTranslation } from '../../hooks/useTranslation';
import { imageCompressionService } from '../../services/imageCompressionService';

interface ImageUploaderProps {
  mode: 'single' | 'multiple';
  value: string | string[];
  onChange: (value: string | string[]) => void;
  placeholder?: string;
  maxImages?: number;
  aspectRatio?: [number, number];
  size?: 'small' | 'medium' | 'large';
  shape?: 'square' | 'circle' | 'rounded';
  showProgress?: boolean;
  allowCamera?: boolean;
  disabled?: boolean;
  label?: string;
  hint?: string;
}

export const ImageUploader: React.FC<ImageUploaderProps> = ({
  mode = 'single',
  value,
  onChange,
  placeholder,
  maxImages = 15,
  aspectRatio = [1, 1],
  size = 'medium',
  shape = 'rounded',
  showProgress = true,
  allowCamera = true,
  disabled = false,
  label,
  hint,
}) => {
  const { colors } = useTheme();
  const { language, isRTL } = useTranslation();
  
  const scaleAnim = useRef(new Animated.Value(1)).current;
  const [isLoading, setIsLoading] = useState(false);
  const [isCompressing, setIsCompressing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * DISABLED: Image compression removed - upload original image as-is
   * This preserves PNG transparency and original quality
   */
  const processImageDirectly = async (uri: string, mimeType: string): Promise<string> => {
    // Simply return the original URI - no compression
    console.log('[ImageUploader] Using original image without compression');
    return uri;
  };

  // Request media library permissions
  const requestPermissions = async (): Promise<boolean> => {
    try {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert(
          language === 'ar' ? 'صلاحية مطلوبة' : 'Permission Required',
          language === 'ar' 
            ? 'يرجى السماح بالوصول إلى مكتبة الصور من الإعدادات' 
            : 'Please allow access to your photo library from settings'
        );
        return false;
      }
      return true;
    } catch (err) {
      console.error('Permission error:', err);
      return false;
    }
  };

  // Request camera permissions
  const requestCameraPermissions = async (): Promise<boolean> => {
    try {
      const { status } = await ImagePicker.requestCameraPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert(
          language === 'ar' ? 'صلاحية مطلوبة' : 'Permission Required',
          language === 'ar' 
            ? 'يرجى السماح بالوصول إلى الكاميرا من الإعدادات' 
            : 'Please allow access to your camera from settings'
        );
        return false;
      }
      return true;
    } catch (err) {
      console.error('Camera permission error:', err);
      return false;
    }
  };

  // Pick image from gallery - OPENS DEVICE FOLDERS
  const pickImageFromGallery = async () => {
    const hasPermission = await requestPermissions();
    if (!hasPermission) return;

    setIsLoading(true);
    setError(null);

    try {
      // Provide haptic feedback
      if (Platform.OS !== 'web') {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      }

      // Launch image picker - This opens the device's gallery/file picker
      // CRITICAL: quality: 1 to preserve PNG transparency - lower quality converts to JPEG
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        aspect: aspectRatio,
        quality: 1, // CRITICAL: Use full quality to preserve PNG alpha channel
        base64: true,
        allowsMultipleSelection: mode === 'multiple',
        selectionLimit: mode === 'multiple' ? maxImages - (Array.isArray(value) ? value.length : 0) : 1,
      });

      if (!result.canceled && result.assets && result.assets.length > 0) {
        const newImages: string[] = [];
        
        for (const asset of result.assets) {
          let imageUrl = '';
          
          // CRITICAL FIX: Use original image directly without compression
          // Detect mime type to preserve PNG transparency
          if (asset.base64) {
            const mimeType = asset.mimeType || 'image/png'; // Default to PNG to preserve transparency
            imageUrl = `data:${mimeType};base64,${asset.base64}`;
            console.log('[ImageUploader] Using original image, mime:', mimeType);
          } else if (asset.uri) {
            imageUrl = asset.uri;
          }
          
          if (imageUrl) {
            newImages.push(imageUrl);
          }
        }

        if (newImages.length > 0) {
          if (mode === 'single') {
            onChange(newImages[0]);
          } else {
            const currentUrls = Array.isArray(value) ? value : [];
            onChange([...currentUrls, ...newImages].slice(0, maxImages));
          }
          
          if (Platform.OS !== 'web') {
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          }
        }
      }
    } catch (err: any) {
      console.error('Error picking image:', err);
      setError(language === 'ar' ? 'فشل في اختيار الصورة' : 'Failed to pick image');
    } finally {
      setIsLoading(false);
    }
  };

  // Take photo with camera
  const takePhotoWithCamera = async () => {
    const hasPermission = await requestCameraPermissions();
    if (!hasPermission) return;

    setIsLoading(true);
    setError(null);

    try {
      if (Platform.OS !== 'web') {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      }

      const result = await ImagePicker.launchCameraAsync({
        allowsEditing: true,
        aspect: aspectRatio,
        quality: 1, // Full quality
        base64: true,
      });

      if (!result.canceled && result.assets && result.assets[0]) {
        const asset = result.assets[0];
        let imageUrl = '';
        
        // CRITICAL FIX: Use original image directly without compression
        if (asset.base64) {
          const mimeType = asset.mimeType || 'image/png'; // Default to PNG
          imageUrl = `data:${mimeType};base64,${asset.base64}`;
          console.log('[ImageUploader] Camera: Using original image, mime:', mimeType);
        } else if (asset.uri) {
          imageUrl = asset.uri;
        }

        if (imageUrl) {
          if (mode === 'single') {
            onChange(imageUrl);
          } else {
            const currentUrls = Array.isArray(value) ? value : [];
            if (currentUrls.length < maxImages) {
              onChange([...currentUrls, imageUrl]);
            }
          }
          
          if (Platform.OS !== 'web') {
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          }
        }
      }
    } catch (err: any) {
      console.error('Error taking photo:', err);
      setError(language === 'ar' ? 'فشل في التقاط الصورة' : 'Failed to capture photo');
    } finally {
      setIsLoading(false);
    }
  };

  // Handle press - show options or directly open gallery
  const handlePress = () => {
    if (disabled || isLoading) return;
    
    // Animate button press
    Animated.sequence([
      Animated.timing(scaleAnim, {
        toValue: 0.95,
        duration: 100,
        useNativeDriver: true,
      }),
      Animated.timing(scaleAnim, {
        toValue: 1,
        duration: 100,
        useNativeDriver: true,
      }),
    ]).start();

    if (allowCamera && Platform.OS !== 'web') {
      // Show options dialog for camera or gallery
      Alert.alert(
        language === 'ar' ? 'اختر الصورة' : 'Select Image',
        language === 'ar' ? 'من أين تريد اختيار الصورة؟' : 'Where would you like to get the image from?',
        [
          {
            text: language === 'ar' ? 'الكاميرا' : 'Camera',
            onPress: takePhotoWithCamera,
          },
          {
            text: language === 'ar' ? 'المعرض' : 'Gallery',
            onPress: pickImageFromGallery,
          },
          {
            text: language === 'ar' ? 'إلغاء' : 'Cancel',
            style: 'cancel',
          },
        ]
      );
    } else {
      // Directly open gallery
      pickImageFromGallery();
    }
  };

  // Remove image
  const handleRemoveImage = (index: number) => {
    if (Platform.OS !== 'web') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    }
    
    if (mode === 'single') {
      onChange('');
    } else {
      const urls = Array.isArray(value) ? [...value] : [];
      urls.splice(index, 1);
      onChange(urls);
    }
  };

  // Size dimensions
  const dimensions = {
    small: { container: 80, icon: 24 },
    medium: { container: 120, icon: 32 },
    large: { container: 180, icon: 48 },
  }[size];

  // Border radius based on shape
  const getBorderRadius = () => {
    switch (shape) {
      case 'circle': return dimensions.container / 2;
      case 'square': return 8;
      case 'rounded': return 12;
      default: return 12;
    }
  };

  const borderRadius = getBorderRadius();

  // Single image mode
  if (mode === 'single') {
    return (
      <View style={styles.container}>
        {label && (
          <Text style={[styles.label, { color: colors.text }, isRTL && styles.textRTL]}>
            {label}
          </Text>
        )}
        {hint && (
          <Text style={[styles.hint, { color: colors.textSecondary }, isRTL && styles.textRTL]}>
            {hint}
          </Text>
        )}
        
        <Animated.View style={{ transform: [{ scale: scaleAnim }] }}>
          <TouchableOpacity
            style={[
              styles.uploadBox,
              {
                width: dimensions.container,
                height: dimensions.container,
                borderRadius,
                backgroundColor: colors.surface,
                borderColor: error ? colors.error : colors.border,
              },
              disabled && styles.disabled,
            ]}
            onPress={handlePress}
            disabled={disabled || isLoading || isCompressing}
            activeOpacity={0.7}
          >
            {isLoading || isCompressing ? (
              <View style={styles.loadingContainer}>
                <ActivityIndicator size="small" color={colors.primary} />
                {isCompressing && (
                  <Text style={[styles.compressingText, { color: colors.textSecondary }]}>
                    {language === 'ar' ? 'جاري الضغط...' : 'Compressing...'}
                  </Text>
                )}
              </View>
            ) : value ? (
              <View style={styles.imageContainer}>
                <Image
                  source={{ uri: value as string }}
                  style={[styles.image, { borderRadius }]}
                  contentFit="cover"
                />
                <TouchableOpacity
                  style={[styles.removeButton, { backgroundColor: colors.error }]}
                  onPress={() => handleRemoveImage(0)}
                >
                  <Ionicons name="close" size={14} color="#FFF" />
                </TouchableOpacity>
              </View>
            ) : (
              <View style={styles.placeholderContent}>
                <LinearGradient
                  colors={[colors.primary + '20', colors.primary + '10']}
                  style={[styles.iconCircle, { borderRadius: dimensions.icon }]}
                >
                  <Ionicons name="image" size={dimensions.icon * 0.6} color={colors.primary} />
                </LinearGradient>
                <Text style={[styles.placeholderText, { color: colors.textSecondary }]}>
                  {placeholder || (language === 'ar' ? 'اختر صورة' : 'Select Image')}
                </Text>
              </View>
            )}
          </TouchableOpacity>
        </Animated.View>

        {error && (
          <Text style={[styles.errorText, { color: colors.error }]}>{error}</Text>
        )}
      </View>
    );
  }

  // Multiple images mode
  const images = Array.isArray(value) ? value : [];
  const canAddMore = images.length < maxImages;

  return (
    <View style={styles.container}>
      {label && (
        <Text style={[styles.label, { color: colors.text }, isRTL && styles.textRTL]}>
          {label}
        </Text>
      )}
      {hint && (
        <Text style={[styles.hint, { color: colors.textSecondary }, isRTL && styles.textRTL]}>
          {hint} ({images.length}/{maxImages})
        </Text>
      )}

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={[styles.imagesRow, isRTL && { flexDirection: 'row-reverse' }]}
      >
        {/* Existing Images */}
        {images.map((img, index) => (
          <View key={`img-${index}`} style={[styles.multiImageContainer, { marginRight: 12 }]}>
            <Image
              source={{ uri: img }}
              style={[
                styles.multiImage,
                {
                  width: dimensions.container - 20,
                  height: dimensions.container - 20,
                  borderRadius: borderRadius - 4,
                },
              ]}
              contentFit="cover"
            />
            <TouchableOpacity
              style={[styles.removeButton, { backgroundColor: colors.error }]}
              onPress={() => handleRemoveImage(index)}
            >
              <Ionicons name="close" size={14} color="#FFF" />
            </TouchableOpacity>
            {index === 0 && (
              <View style={[styles.mainBadge, { backgroundColor: colors.primary }]}>
                <Text style={styles.mainBadgeText}>
                  {language === 'ar' ? 'رئيسية' : 'Main'}
                </Text>
              </View>
            )}
          </View>
        ))}

        {/* Add More Button */}
        {canAddMore && (
          <Animated.View style={{ transform: [{ scale: scaleAnim }] }}>
            <TouchableOpacity
              style={[
                styles.addMoreButton,
                {
                  width: dimensions.container - 20,
                  height: dimensions.container - 20,
                  borderRadius: borderRadius - 4,
                  backgroundColor: colors.surface,
                  borderColor: colors.border,
                },
              ]}
              onPress={handlePress}
              disabled={disabled || isLoading}
            >
              {isLoading ? (
                <ActivityIndicator size="small" color={colors.primary} />
              ) : (
                <>
                  <Ionicons name="add" size={24} color={colors.primary} />
                  <Text style={[styles.addMoreText, { color: colors.textSecondary }]}>
                    {language === 'ar' ? 'إضافة' : 'Add'}
                  </Text>
                </>
              )}
            </TouchableOpacity>
          </Animated.View>
        )}
      </ScrollView>

      {error && (
        <Text style={[styles.errorText, { color: colors.error }]}>{error}</Text>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    marginBottom: 16,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 6,
  },
  hint: {
    fontSize: 12,
    marginBottom: 10,
  },
  textRTL: {
    textAlign: 'right',
  },
  uploadBox: {
    borderWidth: 2,
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  disabled: {
    opacity: 0.5,
  },
  imageContainer: {
    width: '100%',
    height: '100%',
    position: 'relative',
    backgroundColor: 'transparent',
  },
  image: {
    width: '100%',
    height: '100%',
  },
  removeButton: {
    position: 'absolute',
    top: -6,
    right: -6,
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10,
  },
  placeholderContent: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: 8,
  },
  iconCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 6,
  },
  placeholderText: {
    fontSize: 11,
    textAlign: 'center',
  },
  errorText: {
    fontSize: 12,
    marginTop: 6,
  },
  loadingContainer: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  compressingText: {
    fontSize: 10,
    marginTop: 4,
  },
  imagesRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 4,
  },
  multiImageContainer: {
    position: 'relative',
  },
  multiImage: {
    backgroundColor: '#f0f0f0',
  },
  mainBadge: {
    position: 'absolute',
    bottom: 4,
    left: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  mainBadgeText: {
    color: '#FFF',
    fontSize: 9,
    fontWeight: '600',
  },
  addMoreButton: {
    borderWidth: 2,
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
  },
  addMoreText: {
    fontSize: 10,
    marginTop: 2,
  },
});

export default ImageUploader;

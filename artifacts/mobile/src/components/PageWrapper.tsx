/**
 * PageWrapper - Wrapper component to ensure all pages have Header and Footer
 * Use this component to wrap page content in screens that need consistent layout
 */
import React from 'react';
import { View, StyleSheet, ScrollView, KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Header } from './Header';
import { Footer } from './Footer';
import { useTheme } from '../hooks/useTheme';

interface PageWrapperProps {
  children: React.ReactNode;
  title?: string;
  showBack?: boolean;
  showSearch?: boolean;
  showCart?: boolean;
  showSettings?: boolean;
  showHeader?: boolean;
  showFooter?: boolean;
  scrollable?: boolean;
  keyboardAvoiding?: boolean;
  contentContainerStyle?: object;
  edges?: ('top' | 'bottom' | 'left' | 'right')[];
}

export const PageWrapper: React.FC<PageWrapperProps> = ({
  children,
  title,
  showBack = false,
  showSearch = true,
  showCart = true,
  showSettings = true,
  showHeader = true,
  showFooter = true,
  scrollable = true,
  keyboardAvoiding = false,
  contentContainerStyle,
  edges = ['bottom'],
}) => {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();

  const content = scrollable ? (
    <ScrollView
      style={styles.scrollView}
      contentContainerStyle={[
        styles.scrollContent,
        { paddingBottom: showFooter ? 80 : 20 },
        contentContainerStyle,
      ]}
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
    >
      {children}
    </ScrollView>
  ) : (
    <View style={[styles.content, { paddingBottom: showFooter ? 80 : 0 }]}>
      {children}
    </View>
  );

  const wrappedContent = keyboardAvoiding ? (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      style={styles.flex}
    >
      {content}
    </KeyboardAvoidingView>
  ) : (
    content
  );

  return (
    <SafeAreaView 
      style={[styles.container, { backgroundColor: colors.background }]} 
      edges={edges}
    >
      {showHeader && (
        <Header
          title={title}
          showBack={showBack}
          showSearch={showSearch}
          showCart={showCart}
          showSettings={showSettings}
        />
      )}
      
      {wrappedContent}
      
      {showFooter && (
        <View style={[styles.footerContainer, { bottom: 0 }]}>
          <Footer />
        </View>
      )}
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  flex: {
    flex: 1,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
  },
  content: {
    flex: 1,
  },
  footerContainer: {
    position: 'absolute',
    left: 0,
    right: 0,
  },
});

export default PageWrapper;

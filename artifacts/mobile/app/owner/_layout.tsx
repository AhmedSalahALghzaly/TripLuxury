/**
 * Owner Interface Layout
 * Wraps all owner screens with consistent styling
 * Includes floating chat button overlay
 */
import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Stack } from 'expo-router';
import FloatingChatIcon from '../../src/components/ui/FloatingChatIcon';
import FloatingAiAgentIcon from '../../src/components/ui/FloatingAiAgentIcon';

export default function OwnerLayout() {
  return (
    <View style={styles.root}>
      <Stack
        screenOptions={{
          headerShown: false,
          animation: 'slide_from_bottom',
          contentStyle: { backgroundColor: 'transparent' },
        }}
      >
        <Stack.Screen name="index" />
        <Stack.Screen name="customers" />
        <Stack.Screen name="admins" />
        <Stack.Screen name="collection" />
        <Stack.Screen name="subscriptions" />
        <Stack.Screen name="analytics" />
        <Stack.Screen name="suppliers" />
        <Stack.Screen name="distributors" />
        <Stack.Screen name="settings" />
        <Stack.Screen name="orders" />
        <Stack.Screen name="knowledge-base" />
        <Stack.Screen name="restaurant-analytics" />
        <Stack.Screen name="notification-log" />
        <Stack.Screen name="cleanup-history" />
      </Stack>

      <View style={StyleSheet.absoluteFillObject} pointerEvents="box-none">
        <FloatingChatIcon />
        <FloatingAiAgentIcon />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
});

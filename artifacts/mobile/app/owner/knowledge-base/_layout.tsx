/**
 * Knowledge Base Group Layout
 * Nested Stack navigator for all Knowledge Base sub-screens
 */
import React from 'react';
import { Stack } from 'expo-router';

export default function KnowledgeBaseLayout() {
  return (
    <Stack screenOptions={{ headerShown: false, animation: 'slide_from_right' }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="text" />
      <Stack.Screen name="file" />
      <Stack.Screen name="links" />
      <Stack.Screen name="qa" />
      <Stack.Screen name="youtube" />
    </Stack>
  );
}

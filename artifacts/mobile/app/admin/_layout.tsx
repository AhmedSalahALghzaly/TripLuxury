import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Stack } from 'expo-router';
import { useTheme } from '../../src/hooks/useTheme';
import FloatingChatIcon from '../../src/components/ui/FloatingChatIcon';
import FloatingAiAgentIcon from '../../src/components/ui/FloatingAiAgentIcon';

export default function AdminLayout() {
  const { colors } = useTheme();

  return (
    <View style={styles.root}>
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: colors.background },
        }}
      />

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

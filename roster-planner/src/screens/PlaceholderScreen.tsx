// © 2026 David Juste. All rights reserved. Proprietary and confidential.

import React from 'react';
import { SafeAreaView, StyleSheet, Text, View } from 'react-native';

interface Props {
  title: string;
  note: string;
}

export function PlaceholderScreen({ title, note }: Props) {
  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.content}>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.note}>{note}</Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  content: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  title: { fontSize: 20, fontWeight: '700', color: '#1F4E79', marginBottom: 8 },
  note: { fontSize: 14, color: '#4A5568', textAlign: 'center' },
});

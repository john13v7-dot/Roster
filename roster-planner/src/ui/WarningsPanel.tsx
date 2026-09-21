// © 2026 David Juste. All rights reserved. Proprietary and confidential.
//
// Warnings panel (SPEC.md §3): red = must fix, amber = check, info =
// FYI. Nothing here blocks saving.

import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { RuleWarning } from '../domain/types';

interface Props {
  warnings: RuleWarning[];
}

const severityColor: Record<RuleWarning['severity'], string> = {
  red: '#E53E3E',
  amber: '#C05621',
  info: '#3182CE',
};
const severityBg: Record<RuleWarning['severity'], string> = {
  red: '#FFF5F5',
  amber: '#FFFAF0',
  info: '#EBF8FF',
};

export function WarningsPanel({ warnings }: Props) {
  const [expanded, setExpanded] = useState(false);
  if (warnings.length === 0) {
    return (
      <View style={styles.emptyContainer}>
        <Text style={styles.emptyText}>No warnings for this week.</Text>
      </View>
    );
  }

  const redCount = warnings.filter((w) => w.severity === 'red').length;
  const amberCount = warnings.filter((w) => w.severity === 'amber').length;
  const shown = expanded ? warnings : warnings.slice(0, 3);

  return (
    <View style={styles.container}>
      <Pressable style={styles.header} onPress={() => setExpanded((e) => !e)}>
        <Text style={styles.headerText}>
          {redCount > 0 ? `${redCount} to fix` : ''}
          {redCount > 0 && amberCount > 0 ? ' · ' : ''}
          {amberCount > 0 ? `${amberCount} to check` : ''}
          {redCount === 0 && amberCount === 0 ? `${warnings.length} note(s)` : ''}
        </Text>
        <Text style={styles.toggleText}>{expanded ? 'Hide' : 'Show'}</Text>
      </Pressable>
      {shown.map((w, i) => (
        <View key={i} style={[styles.row, { backgroundColor: severityBg[w.severity] }]}>
          <View style={[styles.dot, { backgroundColor: severityColor[w.severity] }]} />
          <Text style={styles.message}>{w.message}</Text>
        </View>
      ))}
      {!expanded && warnings.length > 3 && (
        <Pressable onPress={() => setExpanded(true)}>
          <Text style={styles.moreText}>+{warnings.length - 3} more</Text>
        </Pressable>
      )}
    </View>
  );
}

export function warningBadgeCount(warnings: RuleWarning[]): number {
  return warnings.filter((w) => w.severity === 'red' || w.severity === 'amber').length;
}

const styles = StyleSheet.create({
  container: { paddingHorizontal: 12, paddingBottom: 8 },
  emptyContainer: { paddingHorizontal: 12, paddingVertical: 8 },
  emptyText: { fontSize: 13, color: '#718096' },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 8 },
  headerText: { fontSize: 13, fontWeight: '700', color: '#1A202C' },
  toggleText: { fontSize: 13, color: '#1F4E79', fontWeight: '600' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 6,
    marginBottom: 4,
  },
  dot: { width: 8, height: 8, borderRadius: 4 },
  message: { fontSize: 13, color: '#1A202C', flex: 1 },
  moreText: { fontSize: 12, color: '#1F4E79', fontWeight: '600', marginTop: 2 },
});

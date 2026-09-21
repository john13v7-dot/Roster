// © 2026 David Juste. All rights reserved. Proprietary and confidential.
//
// Coverage strip under the roster table (SPEC.md §3): per day, opening
// and closing cover ✓/⚠, plus the ground/1st floor headcount.

import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import type { DayCoverage } from '../rules/rules';
import { weekdayLabels } from '../domain/week';

interface Props {
  coverage: DayCoverage[];
}

export function CoverageStrip({ coverage }: Props) {
  return (
    <ScrollView horizontal style={styles.container} contentContainerStyle={styles.content}>
      {coverage.map((day, i) => (
        <View key={day.date} style={styles.dayCard}>
          <Text style={styles.dayLabel}>{weekdayLabels[i] ?? day.date}</Text>
          <View style={styles.row}>
            <Text style={styles.rowLabel}>Open</Text>
            <Text style={day.openingOk ? styles.ok : styles.warn}>{day.openingOk ? '✓' : '⚠'}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.rowLabel}>Close</Text>
            <Text style={day.closingOk ? styles.ok : styles.warn}>{day.closingOk ? '✓' : '⚠'}</Text>
          </View>
          <Text style={styles.floorText}>
            Ground {day.groundCount} · 1st {day.firstCount}
          </Text>
        </View>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { maxHeight: 96, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#E2E8F0' },
  content: { paddingHorizontal: 8, paddingVertical: 8, gap: 8 },
  dayCard: {
    backgroundColor: '#F7FAFC',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    minWidth: 92,
  },
  dayLabel: { fontSize: 12, fontWeight: '700', color: '#1F4E79', marginBottom: 2 },
  row: { flexDirection: 'row', justifyContent: 'space-between' },
  rowLabel: { fontSize: 11, color: '#4A5568' },
  ok: { fontSize: 12, color: '#2F855A', fontWeight: '700' },
  warn: { fontSize: 12, color: '#C05621', fontWeight: '700' },
  floorText: { fontSize: 10, color: '#718096', marginTop: 2 },
});

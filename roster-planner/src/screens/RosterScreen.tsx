// © 2026 David Juste. All rights reserved. Proprietary and confidential.

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, SafeAreaView, StyleSheet, Text, View } from 'react-native';
import { addDays } from 'date-fns';
import { useSQLiteContext } from 'expo-sqlite';
import { getAllStaff, getRosterEntriesForWeek, getVacantSeats } from '../db/repository';
import { buildRosterRows, type RosterRow } from '../domain/rosterLayout';
import { formatWeekRange, weekDates, weekStartOf } from '../domain/week';
import type { RosterEntry, Staff, VacantSeat } from '../domain/types';
import { exportRosterToExcel, exportRosterToPdf } from '../export/exportRoster';
import { RosterTable } from '../ui/RosterTable';

const SEED_WEEK_START = '2026-09-21';

export function RosterScreen() {
  const db = useSQLiteContext();
  const [weekStart, setWeekStart] = useState(SEED_WEEK_START);
  const [staff, setStaff] = useState<Staff[]>([]);
  const [vacantSeats, setVacantSeats] = useState<VacantSeat[]>([]);
  const [entriesByKey, setEntriesByKey] = useState<Record<string, RosterEntry>>({});
  const [loading, setLoading] = useState(true);

  const dates = useMemo(() => weekDates(new Date(`${weekStart}T00:00:00`)), [weekStart]);

  const load = useCallback(async () => {
    setLoading(true);
    const [staffRows, vacantRows, entries] = await Promise.all([
      getAllStaff(db),
      getVacantSeats(db),
      getRosterEntriesForWeek(db, weekStart),
    ]);
    setStaff(staffRows);
    setVacantSeats(vacantRows);
    setEntriesByKey(entries);
    setLoading(false);
  }, [db, weekStart]);

  useEffect(() => {
    load();
  }, [load]);

  const rows: RosterRow[] = useMemo(() => buildRosterRows(staff, vacantSeats), [staff, vacantSeats]);

  const goToWeek = (deltaWeeks: number) => {
    const current = new Date(`${weekStart}T00:00:00`);
    const next = addDays(current, deltaWeeks * 7);
    setWeekStart(weekStartOf(next));
  };

  const [exporting, setExporting] = useState<'excel' | 'pdf' | null>(null);

  const runExport = async (kind: 'excel' | 'pdf') => {
    setExporting(kind);
    try {
      if (kind === 'excel') {
        await exportRosterToExcel(rows, dates, entriesByKey, weekStart);
      } else {
        await exportRosterToPdf(rows, dates, entriesByKey, weekStart);
      }
    } catch (error) {
      Alert.alert('Export failed', error instanceof Error ? error.message : String(error));
    } finally {
      setExporting(null);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.weekPicker}>
        <Pressable style={styles.arrowButton} onPress={() => goToWeek(-1)} hitSlop={12}>
          <Text style={styles.arrowText}>◀</Text>
        </Pressable>
        <Text style={styles.weekLabel}>{formatWeekRange(weekStart)}</Text>
        <Pressable style={styles.arrowButton} onPress={() => goToWeek(1)} hitSlop={12}>
          <Text style={styles.arrowText}>▶</Text>
        </Pressable>
      </View>

      <View style={styles.toolbar}>
        <Pressable
          style={styles.toolbarButton}
          disabled={exporting !== null}
          onPress={() => runExport('excel')}
        >
          {exporting === 'excel' ? (
            <ActivityIndicator color="#1F4E79" />
          ) : (
            <Text style={styles.toolbarButtonText}>Export Excel</Text>
          )}
        </Pressable>
        <Pressable
          style={styles.toolbarButton}
          disabled={exporting !== null}
          onPress={() => runExport('pdf')}
        >
          {exporting === 'pdf' ? (
            <ActivityIndicator color="#1F4E79" />
          ) : (
            <Text style={styles.toolbarButtonText}>Export PDF</Text>
          )}
        </Pressable>
      </View>

      {loading ? (
        <View style={styles.centered}>
          <Text>Loading…</Text>
        </View>
      ) : (
        <RosterTable rows={rows} dates={dates} entriesByKey={entriesByKey} />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  weekPicker: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    gap: 16,
  },
  arrowButton: { padding: 8, minWidth: 48, minHeight: 48, alignItems: 'center', justifyContent: 'center' },
  arrowText: { fontSize: 18, color: '#1F4E79' },
  weekLabel: { fontSize: 16, fontWeight: '700', color: '#1F4E79' },
  toolbar: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 8,
    paddingHorizontal: 8,
    paddingBottom: 8,
  },
  toolbarButton: {
    backgroundColor: '#EDF2F7',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    minHeight: 44,
    justifyContent: 'center',
  },
  toolbarButtonText: { color: '#1F4E79', fontWeight: '600', fontSize: 13 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});

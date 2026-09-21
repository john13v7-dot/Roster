// © 2026 David Juste. All rights reserved. Proprietary and confidential.

import React, { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, SafeAreaView, StyleSheet, Text, View } from 'react-native';
import { addDays } from 'date-fns';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { useSQLiteContext } from 'expo-sqlite';
import {
  deleteRosterEntry,
  getAllLeave,
  getAllStaff,
  getFairnessLedger,
  getRoomHistory,
  getWeekRosterView,
  upsertRosterEntry,
} from '../db/repository';
import { buildRosterRows, type RosterRow } from '../domain/rosterLayout';
import { formatWeekRange, weekDates, weekStartOf } from '../domain/week';
import type { FairnessLedgerEntry, LeaveEntry, RoomHistoryEntry, RosterEntry, Staff } from '../domain/types';
import { exportRosterToExcel, exportRosterToPdf } from '../export/exportRoster';
import { computeCoverageStrip, evaluateWeekRules } from '../rules/rules';
import { CellEditSheet, type CellEditResult } from '../ui/CellEditSheet';
import { CoverageStrip } from '../ui/CoverageStrip';
import { RosterTable } from '../ui/RosterTable';
import { warningBadgeCount, WarningsPanel } from '../ui/WarningsPanel';

const SEED_WEEK_START = '2026-09-21';

export function RosterScreen() {
  const db = useSQLiteContext();
  const navigation = useNavigation();
  const [weekStart, setWeekStart] = useState(SEED_WEEK_START);
  const [staff, setStaff] = useState<Staff[]>([]);
  const [roomHistory, setRoomHistory] = useState<RoomHistoryEntry[]>([]);
  const [entriesByKey, setEntriesByKey] = useState<Record<string, RosterEntry>>({});
  const [leaveEntries, setLeaveEntries] = useState<LeaveEntry[]>([]);
  const [fairnessLedger, setFairnessLedger] = useState<FairnessLedgerEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const dates = useMemo(() => weekDates(new Date(`${weekStart}T00:00:00`)), [weekStart]);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [staffRows, roomHistoryRows, leaveRows, ledgerRows] = await Promise.all([
        getAllStaff(db),
        getRoomHistory(db),
        getAllLeave(db),
        getFairnessLedger(db),
      ]);
      const entries = await getWeekRosterView(
        db,
        weekStart,
        dates,
        staffRows.map((s) => s.id),
      );
      setStaff(staffRows);
      setRoomHistory(roomHistoryRows);
      setEntriesByKey(entries);
      setLeaveEntries(leaveRows);
      setFairnessLedger(ledgerRows);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
    }
  }, [db, weekStart, dates]);

  // Re-load whenever this tab regains focus, so leave/staff changes made
  // on other tabs show up here without a manual refresh.
  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const rows: RosterRow[] = useMemo(
    () => buildRosterRows(staff, roomHistory, weekStart),
    [staff, roomHistory, weekStart],
  );

  const warnings = useMemo(
    () => evaluateWeekRules({ weekStart, dates, staff, roomHistory, entriesByKey, leaveEntries, fairnessLedger }),
    [weekStart, dates, staff, roomHistory, entriesByKey, leaveEntries, fairnessLedger],
  );

  const coverage = useMemo(
    () => computeCoverageStrip({ weekStart, dates, staff, roomHistory, entriesByKey }),
    [weekStart, dates, staff, roomHistory, entriesByKey],
  );

  React.useEffect(() => {
    const badgeCount = warningBadgeCount(warnings);
    navigation.setOptions({ tabBarBadge: badgeCount > 0 ? badgeCount : undefined });
  }, [navigation, warnings]);

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

  const [editingCell, setEditingCell] = useState<{ staffId: string; date: string } | null>(null);

  const saveCell = async (result: CellEditResult) => {
    if (!editingCell) return;
    const { staffId, date } = editingCell;
    if (result.type === 'blank') {
      await deleteRosterEntry(db, staffId, date);
    } else {
      await upsertRosterEntry(db, {
        weekStart,
        staffId,
        date,
        type: result.type,
        patternCode: result.patternCode,
        start: result.start,
        end: result.end,
        unpaidLunchMinutes: result.unpaidLunchMinutes,
        source: 'manual',
        note: null,
      });
    }
    setEditingCell(null);
    await load();
  };

  const editingStaffName = editingCell ? staff.find((s) => s.id === editingCell.staffId)?.name ?? '' : '';
  const editingEntry = editingCell ? entriesByKey[`${editingCell.staffId}|${editingCell.date}`] : undefined;

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
          <ActivityIndicator />
          <Text>Loading…</Text>
        </View>
      ) : loadError ? (
        <View style={styles.centered}>
          <Text style={styles.errorText}>Couldn't load the roster.</Text>
          <Text style={styles.errorDetail}>{loadError}</Text>
          <Pressable style={styles.toolbarButton} onPress={load}>
            <Text style={styles.toolbarButtonText}>Try again</Text>
          </Pressable>
        </View>
      ) : (
        <>
          <WarningsPanel warnings={warnings} />
          <RosterTable
            rows={rows}
            dates={dates}
            entriesByKey={entriesByKey}
            onCellPress={(staffId, date) => setEditingCell({ staffId, date })}
          />
          <CoverageStrip coverage={coverage} />
        </>
      )}

      <CellEditSheet
        visible={editingCell !== null}
        staffName={editingStaffName}
        date={editingCell?.date ?? ''}
        currentEntry={editingEntry}
        onSave={saveCell}
        onClose={() => setEditingCell(null)}
      />
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
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8, padding: 24 },
  errorText: { fontSize: 15, fontWeight: '700', color: '#9B2C2C' },
  errorDetail: { fontSize: 12, color: '#718096', textAlign: 'center', marginBottom: 8 },
});

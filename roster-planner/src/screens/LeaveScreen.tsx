// © 2026 David Juste. All rights reserved. Proprietary and confidential.
//
// Add Holiday / Add Maternity Leave, with an editable/deletable list
// (SPEC.md §12). Dates fill the roster automatically — see
// src/domain/leave.ts and getWeekRosterView in src/db/repository.ts.

import React, { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Modal,
  Pressable,
  SafeAreaView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { useFocusEffect } from '@react-navigation/native';
import { useSQLiteContext } from 'expo-sqlite';
import { addLeave, deleteLeave, getAllLeave, getAllStaff, updateLeave } from '../db/repository';
import { generateId } from '../domain/id';
import { leaveTypeLabel } from '../domain/leave';
import { statusColors } from '../config/theme';
import { formatDateLong } from '../domain/week';
import type { LeaveEntry, LeaveType, Staff } from '../domain/types';

function toIsoDate(date: Date): string {
  // Local calendar date, not toISOString() (which is UTC and can land on
  // the wrong day for timezones behind UTC).
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

interface FormState {
  id: string | null;
  type: LeaveType;
  staffId: string | null;
  from: Date;
  to: Date | null;
}

function blankForm(type: LeaveType): FormState {
  return { id: null, type, staffId: null, from: new Date(), to: type === 'holiday' ? new Date() : null };
}

export function LeaveScreen() {
  const db = useSQLiteContext();
  const [staff, setStaff] = useState<Staff[]>([]);
  const [leave, setLeave] = useState<LeaveEntry[]>([]);
  const [loading, setLoading] = useState(true);

  const [form, setForm] = useState<FormState | null>(null);
  const [staffPickerOpen, setStaffPickerOpen] = useState(false);
  const [datePickerTarget, setDatePickerTarget] = useState<'from' | 'to' | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const [staffRows, leaveRows] = await Promise.all([getAllStaff(db), getAllLeave(db)]);
    setStaff(staffRows);
    setLeave(leaveRows);
    setLoading(false);
  }, [db]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const staffName = (staffId: string) => staff.find((s) => s.id === staffId)?.name ?? 'Unknown';

  const openAdd = (type: LeaveType) => setForm(blankForm(type));

  const openEdit = (entry: LeaveEntry) =>
    setForm({
      id: entry.id,
      type: entry.type,
      staffId: entry.staffId,
      from: new Date(`${entry.fromDate}T00:00:00`),
      to: entry.toDate ? new Date(`${entry.toDate}T00:00:00`) : null,
    });

  const closeForm = () => {
    setForm(null);
    setStaffPickerOpen(false);
    setDatePickerTarget(null);
  };

  const save = async () => {
    if (!form) return;
    if (!form.staffId) {
      Alert.alert('Pick a person', 'Choose who this leave is for.');
      return;
    }
    if (form.type === 'holiday' && !form.to) {
      Alert.alert('Add an end date', 'Holidays need a To date.');
      return;
    }
    if (form.to && form.to < form.from) {
      Alert.alert('Check the dates', 'The To date is before the From date.');
      return;
    }

    setSaving(true);
    try {
      const entry: LeaveEntry = {
        id: form.id ?? generateId('leave'),
        staffId: form.staffId,
        type: form.type,
        fromDate: toIsoDate(form.from),
        toDate: form.to ? toIsoDate(form.to) : null,
      };
      if (form.id) {
        await updateLeave(db, entry);
      } else {
        await addLeave(db, entry);
      }

      const person = staff.find((s) => s.id === form.staffId);
      closeForm();
      await load();

      // R3 (SPEC.md §5): when one of the paired-management pair is away,
      // the other's start has to be set by hand.
      if (person?.type === 'paired_management') {
        Alert.alert(
          'Heads up',
          `${person.name} is one of a pair whose start times complement each other. ` +
            `While they're away, set their partner's start time by hand for these dates.`,
        );
      }
    } finally {
      setSaving(false);
    }
  };

  const remove = (entry: LeaveEntry) => {
    Alert.alert(
      'Delete this leave entry?',
      `${staffName(entry.staffId)} — ${leaveTypeLabel(entry.type)}, from ${formatDateLong(entry.fromDate)}.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            await deleteLeave(db, entry.id);
            await load();
          },
        },
      ],
    );
  };

  const dotColor = (type: LeaveType) =>
    type === 'holiday' ? statusColors.holiday : type === 'maternity' ? statusColors.maternityLeave : '#A0AEC0';

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.toolbar}>
        <Pressable style={styles.addButton} onPress={() => openAdd('holiday')}>
          <Text style={styles.addButtonText}>+ Add Holiday</Text>
        </Pressable>
        <Pressable style={styles.addButton} onPress={() => openAdd('maternity')}>
          <Text style={styles.addButtonText}>+ Add Maternity Leave</Text>
        </Pressable>
      </View>

      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator />
        </View>
      ) : leave.length === 0 ? (
        <View style={styles.centered}>
          <Text style={styles.emptyText}>No leave entries yet.</Text>
        </View>
      ) : (
        <FlatList
          data={leave}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.listContent}
          renderItem={({ item }) => (
            <Pressable style={styles.row} onPress={() => openEdit(item)}>
              <View style={[styles.dot, { backgroundColor: dotColor(item.type) }]} />
              <View style={styles.rowText}>
                <Text style={styles.rowName}>{staffName(item.staffId)}</Text>
                <Text style={styles.rowDetail}>
                  {leaveTypeLabel(item.type)} · {formatDateLong(item.fromDate)}
                  {' – '}
                  {item.toDate ? formatDateLong(item.toDate) : 'until further notice'}
                </Text>
              </View>
              <Pressable hitSlop={12} onPress={() => remove(item)} style={styles.deleteButton}>
                <Text style={styles.deleteButtonText}>Delete</Text>
              </Pressable>
            </Pressable>
          )}
        />
      )}

      <Modal visible={form !== null} animationType="slide" transparent onRequestClose={closeForm}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            {form && (
              <>
                <Text style={styles.modalTitle}>
                  {form.id ? 'Edit' : 'Add'} {leaveTypeLabel(form.type)}
                </Text>

                <Text style={styles.fieldLabel}>Person</Text>
                <Pressable style={styles.fieldInput} onPress={() => setStaffPickerOpen(true)}>
                  <Text style={form.staffId ? styles.fieldValue : styles.fieldPlaceholder}>
                    {form.staffId ? staffName(form.staffId) : 'Choose a person'}
                  </Text>
                </Pressable>

                <Text style={styles.fieldLabel}>From</Text>
                <Pressable style={styles.fieldInput} onPress={() => setDatePickerTarget('from')}>
                  <Text style={styles.fieldValue}>{formatDateLong(toIsoDate(form.from))}</Text>
                </Pressable>

                <Text style={styles.fieldLabel}>
                  To {form.type === 'maternity' ? '(leave blank for "until further notice")' : ''}
                </Text>
                <Pressable style={styles.fieldInput} onPress={() => setDatePickerTarget('to')}>
                  <Text style={form.to ? styles.fieldValue : styles.fieldPlaceholder}>
                    {form.to ? formatDateLong(toIsoDate(form.to)) : 'Until further notice'}
                  </Text>
                </Pressable>
                {form.type === 'maternity' && form.to && (
                  <Pressable onPress={() => setForm({ ...form, to: null })}>
                    <Text style={styles.clearLink}>Clear end date</Text>
                  </Pressable>
                )}

                <View style={styles.modalButtons}>
                  <Pressable style={styles.cancelButton} onPress={closeForm}>
                    <Text style={styles.cancelButtonText}>Cancel</Text>
                  </Pressable>
                  <Pressable style={styles.saveButton} onPress={save} disabled={saving}>
                    {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.saveButtonText}>Save</Text>}
                  </Pressable>
                </View>
              </>
            )}
          </View>
        </View>
      </Modal>

      <Modal visible={staffPickerOpen} animationType="slide" transparent onRequestClose={() => setStaffPickerOpen(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Choose a person</Text>
            <FlatList
              data={staff}
              keyExtractor={(s) => s.id}
              renderItem={({ item }) => (
                <Pressable
                  style={styles.staffPickerRow}
                  onPress={() => {
                    if (form) setForm({ ...form, staffId: item.id });
                    setStaffPickerOpen(false);
                  }}
                >
                  <Text style={styles.fieldValue}>{item.name}</Text>
                </Pressable>
              )}
            />
            <Pressable style={styles.cancelButton} onPress={() => setStaffPickerOpen(false)}>
              <Text style={styles.cancelButtonText}>Cancel</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      {datePickerTarget && form && (
        <DateTimePicker
          value={(datePickerTarget === 'from' ? form.from : form.to) ?? new Date()}
          mode="date"
          display="default"
          onChange={(_event, selected) => {
            setDatePickerTarget(null);
            if (!selected) return;
            setForm((prev) => (prev ? { ...prev, [datePickerTarget]: selected } : prev));
          }}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  toolbar: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, padding: 12 },
  addButton: {
    backgroundColor: '#1F4E79',
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 12,
    minHeight: 48,
    justifyContent: 'center',
  },
  addButtonText: { color: '#fff', fontWeight: '700' },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  emptyText: { color: '#718096' },
  listContent: { paddingHorizontal: 12, paddingBottom: 24 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#E2E8F0',
    gap: 10,
  },
  dot: { width: 12, height: 12, borderRadius: 6 },
  rowText: { flex: 1 },
  rowName: { fontSize: 16, fontWeight: '600', color: '#1A202C' },
  rowDetail: { fontSize: 13, color: '#4A5568', marginTop: 2 },
  deleteButton: { paddingHorizontal: 10, paddingVertical: 8, minHeight: 44, justifyContent: 'center' },
  deleteButtonText: { color: statusColors.holiday, fontWeight: '600' },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  modalCard: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    padding: 20,
    maxHeight: '80%',
  },
  modalTitle: { fontSize: 18, fontWeight: '700', color: '#1F4E79', marginBottom: 16 },
  fieldLabel: { fontSize: 13, color: '#4A5568', marginTop: 12, marginBottom: 4 },
  fieldInput: {
    borderWidth: 1,
    borderColor: '#CBD5E0',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 14,
    minHeight: 48,
    justifyContent: 'center',
  },
  fieldValue: { fontSize: 15, color: '#1A202C' },
  fieldPlaceholder: { fontSize: 15, color: '#A0AEC0' },
  clearLink: { color: '#1F4E79', marginTop: 8 },
  modalButtons: { flexDirection: 'row', gap: 12, marginTop: 24 },
  cancelButton: {
    flex: 1,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#CBD5E0',
    paddingVertical: 14,
    alignItems: 'center',
    minHeight: 48,
    justifyContent: 'center',
  },
  cancelButtonText: { color: '#4A5568', fontWeight: '600' },
  saveButton: {
    flex: 1,
    borderRadius: 8,
    backgroundColor: '#1F4E79',
    paddingVertical: 14,
    alignItems: 'center',
    minHeight: 48,
    justifyContent: 'center',
  },
  saveButtonText: { color: '#fff', fontWeight: '700' },
  staffPickerRow: {
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#E2E8F0',
    minHeight: 48,
    justifyContent: 'center',
  },
});

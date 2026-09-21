// © 2026 David Juste. All rights reserved. Proprietary and confidential.
//
// The cell edit bottom sheet (SPEC.md §3 "Click any cell to edit it. Cell
// menu: the 4 shift patterns, custom times, Holiday, Maternity Leave,
// OFF, blank.").

import React, { useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { shiftPatterns, type ShiftPatternCode } from '../config/creche.config';
import type { RosterEntry, RosterEntryType } from '../domain/types';

export interface CellEditResult {
  type: RosterEntryType;
  patternCode: ShiftPatternCode | null;
  start: string | null;
  end: string | null;
  unpaidLunchMinutes: number;
}

interface Props {
  visible: boolean;
  staffName: string;
  date: string;
  currentEntry: RosterEntry | undefined;
  onSave: (result: CellEditResult) => void;
  onClose: () => void;
}

const OPTIONS: { label: string; result: CellEditResult }[] = [
  ...shiftPatterns.map((p) => ({
    label: `${p.code} — ${p.start}–${p.end}`,
    result: {
      type: 'shift' as const,
      patternCode: p.code,
      start: p.start,
      end: p.end,
      unpaidLunchMinutes: p.unpaidLunchMinutes,
    },
  })),
  { label: 'Holiday', result: { type: 'holiday', patternCode: null, start: null, end: null, unpaidLunchMinutes: 0 } },
  {
    label: 'Maternity Leave',
    result: { type: 'maternity', patternCode: null, start: null, end: null, unpaidLunchMinutes: 0 },
  },
  { label: 'OFF', result: { type: 'off', patternCode: null, start: null, end: null, unpaidLunchMinutes: 0 } },
  { label: 'Blank', result: { type: 'blank', patternCode: null, start: null, end: null, unpaidLunchMinutes: 0 } },
];

export function CellEditSheet({ visible, staffName, date, currentEntry, onSave, onClose }: Props) {
  const [customOpen, setCustomOpen] = useState(false);
  const [customStart, setCustomStart] = useState(currentEntry?.start ?? '');
  const [customEnd, setCustomEnd] = useState(currentEntry?.end ?? '');

  const close = () => {
    setCustomOpen(false);
    onClose();
  };

  const saveCustom = () => {
    const timePattern = /^([01]\d|2[0-3]):[0-5]\d$/;
    if (!timePattern.test(customStart) || !timePattern.test(customEnd)) {
      return;
    }
    onSave({ type: 'shift', patternCode: null, start: customStart, end: customEnd, unpaidLunchMinutes: 0 });
    setCustomOpen(false);
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={close}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <Text style={styles.title}>{staffName}</Text>
          <Text style={styles.subtitle}>{date}</Text>

          {!customOpen ? (
            <>
              {OPTIONS.map((opt) => (
                <Pressable key={opt.label} style={styles.optionRow} onPress={() => onSave(opt.result)}>
                  <Text style={styles.optionText}>{opt.label}</Text>
                </Pressable>
              ))}
              <Pressable style={styles.optionRow} onPress={() => setCustomOpen(true)}>
                <Text style={styles.optionText}>Custom times…</Text>
              </Pressable>
            </>
          ) : (
            <>
              <Text style={styles.fieldLabel}>Start (HH:mm)</Text>
              <TextInput
                style={styles.textInput}
                value={customStart}
                onChangeText={setCustomStart}
                placeholder="07:30"
                placeholderTextColor="#A0AEC0"
                keyboardType="numbers-and-punctuation"
              />
              <Text style={styles.fieldLabel}>End (HH:mm)</Text>
              <TextInput
                style={styles.textInput}
                value={customEnd}
                onChangeText={setCustomEnd}
                placeholder="16:30"
                placeholderTextColor="#A0AEC0"
                keyboardType="numbers-and-punctuation"
              />
              <View style={styles.modalButtons}>
                <Pressable style={styles.cancelButton} onPress={() => setCustomOpen(false)}>
                  <Text style={styles.cancelButtonText}>Back</Text>
                </Pressable>
                <Pressable style={styles.saveButton} onPress={saveCustom}>
                  <Text style={styles.saveButtonText}>Save</Text>
                </Pressable>
              </View>
            </>
          )}

          <Pressable style={styles.cancelButton} onPress={close}>
            <Text style={styles.cancelButtonText}>Cancel</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: '#fff', borderTopLeftRadius: 16, borderTopRightRadius: 16, padding: 20, maxHeight: '85%' },
  title: { fontSize: 18, fontWeight: '700', color: '#1F4E79' },
  subtitle: { fontSize: 13, color: '#4A5568', marginBottom: 16 },
  optionRow: {
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#E2E8F0',
    minHeight: 48,
    justifyContent: 'center',
  },
  optionText: { fontSize: 15, color: '#1A202C' },
  fieldLabel: { fontSize: 13, color: '#4A5568', marginTop: 12, marginBottom: 4 },
  textInput: {
    borderWidth: 1,
    borderColor: '#CBD5E0',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 12,
    minHeight: 48,
    fontSize: 15,
    color: '#1A202C',
  },
  modalButtons: { flexDirection: 'row', gap: 12, marginTop: 16 },
  cancelButton: {
    flex: 1,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#CBD5E0',
    paddingVertical: 14,
    alignItems: 'center',
    minHeight: 48,
    justifyContent: 'center',
    marginTop: 12,
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
});

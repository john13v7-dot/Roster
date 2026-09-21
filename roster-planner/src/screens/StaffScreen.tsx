// © 2026 David Juste. All rights reserved. Proprietary and confidential.
//
// Staff list grouped by room and floor, with + Add Staff / Transfer /
// Remove Staff (leaver) (SPEC.md §7, §3).

import React, { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Modal,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { addDays } from 'date-fns';
import { useFocusEffect } from '@react-navigation/native';
import { useSQLiteContext } from 'expo-sqlite';
import {
  addRoomHistoryEntry,
  closeCurrentRoomHistoryEntry,
  getAllRooms,
  getAllStaff,
  getRoomHistory,
  insertStaff,
  setStaffActiveTo,
  transferStaffToRoom,
  type RoomLookup,
} from '../db/repository';
import { generateId } from '../domain/id';
import { roomIdForStaffAtWeek } from '../domain/rosterLayout';
import { formatDateLong, weekStartOf } from '../domain/week';
import type { RoomHistoryEntry, Staff } from '../domain/types';

function toIsoDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function toMonday(date: Date): Date {
  return new Date(`${weekStartOf(date)}T00:00:00`);
}

type ModalKind = 'add' | 'transfer' | 'remove' | null;

interface PickerModalProps<T> {
  visible: boolean;
  title: string;
  items: T[];
  labelFor: (item: T) => string;
  onSelect: (item: T) => void;
  onClose: () => void;
}

function PickerModal<T>({ visible, title, items, labelFor, onSelect, onClose }: PickerModalProps<T>) {
  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.modalBackdrop}>
        <View style={styles.modalCard}>
          <Text style={styles.modalTitle}>{title}</Text>
          <FlatList
            data={items}
            keyExtractor={(_item, index) => String(index)}
            renderItem={({ item }) => (
              <Pressable style={styles.pickerRow} onPress={() => onSelect(item)}>
                <Text style={styles.fieldValue}>{labelFor(item)}</Text>
              </Pressable>
            )}
          />
          <Pressable style={styles.cancelButton} onPress={onClose}>
            <Text style={styles.cancelButtonText}>Cancel</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

export function StaffScreen() {
  const db = useSQLiteContext();
  const [staff, setStaff] = useState<Staff[]>([]);
  const [roomHistory, setRoomHistory] = useState<RoomHistoryEntry[]>([]);
  const [rooms, setRooms] = useState<RoomLookup[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const [staffRows, roomHistoryRows, roomRows] = await Promise.all([
      getAllStaff(db),
      getRoomHistory(db),
      getAllRooms(db),
    ]);
    setStaff(staffRows);
    setRoomHistory(roomHistoryRows);
    setRooms(roomRows);
    setLoading(false);
  }, [db]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const todayWeek = useMemo(() => weekStartOf(new Date()), []);

  const groups = useMemo(() => {
    const activeStaff = staff.filter((s) => !s.activeTo || s.activeTo >= todayWeek);
    const byRoom = new Map<string, Staff[]>();
    const roomless: Staff[] = [];
    for (const s of activeStaff) {
      const roomId = roomIdForStaffAtWeek(roomHistory, s.id, todayWeek);
      if (roomId) {
        const list = byRoom.get(roomId) ?? [];
        list.push(s);
        byRoom.set(roomId, list);
      } else {
        roomless.push(s);
      }
    }
    roomless.sort((a, b) => a.sortOrder - b.sortOrder);
    return { activeStaff, byRoom, roomless };
  }, [staff, roomHistory, todayWeek]);

  const staffName = (staffId: string | null) => staff.find((s) => s.id === staffId)?.name ?? '';
  const roomName = (roomId: string | null) => rooms.find((r) => r.id === roomId)?.name ?? '';

  // --- Add Staff ---
  const [modal, setModal] = useState<ModalKind>(null);
  const [addName, setAddName] = useState('');
  const [addRoomId, setAddRoomId] = useState<string | null>(null);
  const [addStartWeek, setAddStartWeek] = useState(new Date());
  const [addPickerOpen, setAddPickerOpen] = useState<'room' | 'date' | null>(null);

  const openAdd = () => {
    setAddName('');
    setAddRoomId(null);
    setAddStartWeek(new Date());
    setModal('add');
  };

  const submitAdd = async () => {
    const trimmedName = addName.trim();
    if (!trimmedName) {
      Alert.alert('Add a name', 'Type the new person\'s name.');
      return;
    }
    if (!addRoomId) {
      Alert.alert('Pick a room', 'Choose which room they join.');
      return;
    }
    setSaving(true);
    try {
      const startWeek = toIsoDate(toMonday(addStartWeek));
      const newStaff: Staff = {
        id: generateId('staff'),
        name: trimmedName,
        type: 'rotating',
        payrollIncluded: true,
        activeFrom: startWeek,
        activeTo: null,
        sortOrder: Date.now(),
        numbered: true,
        floorOverride: null,
      };
      await insertStaff(db, newStaff);
      await addRoomHistoryEntry(db, { staffId: newStaff.id, roomId: addRoomId, fromWeek: startWeek, toWeek: null });
      setModal(null);
      await load();
    } finally {
      setSaving(false);
    }
  };

  // --- Transfer ---
  const [transferStaffId, setTransferStaffId] = useState<string | null>(null);
  const [transferRoomId, setTransferRoomId] = useState<string | null>(null);
  const [transferWeek, setTransferWeek] = useState(new Date());
  const [transferPickerOpen, setTransferPickerOpen] = useState<'person' | 'room' | 'date' | null>(null);

  const openTransfer = () => {
    setTransferStaffId(null);
    setTransferRoomId(null);
    setTransferWeek(new Date());
    setModal('transfer');
  };

  const submitTransfer = async () => {
    if (!transferStaffId) {
      Alert.alert('Pick a person', 'Choose who is transferring.');
      return;
    }
    if (!transferRoomId) {
      Alert.alert('Pick a room', 'Choose the room they are moving to.');
      return;
    }
    setSaving(true);
    try {
      const effectiveWeek = toIsoDate(toMonday(transferWeek));
      const currentRoomId = roomIdForStaffAtWeek(roomHistory, transferStaffId, effectiveWeek);
      if (currentRoomId === transferRoomId) {
        Alert.alert('Already there', `${staffName(transferStaffId)} is already in ${roomName(transferRoomId)} that week.`);
        return;
      }
      await transferStaffToRoom(db, transferStaffId, transferRoomId, effectiveWeek);
      setModal(null);
      await load();
    } finally {
      setSaving(false);
    }
  };

  // --- Remove Staff (leaver) ---
  const [removeStaffId, setRemoveStaffId] = useState<string | null>(null);
  const [removeLastWeek, setRemoveLastWeek] = useState(new Date());
  const [removePickerOpen, setRemovePickerOpen] = useState<'person' | 'date' | null>(null);

  const openRemove = () => {
    setRemoveStaffId(null);
    setRemoveLastWeek(new Date());
    setModal('remove');
  };

  const submitRemove = () => {
    if (!removeStaffId) {
      Alert.alert('Pick a person', 'Choose who is leaving.');
      return;
    }
    const name = staffName(removeStaffId);
    const lastWeek = toIsoDate(toMonday(removeLastWeek));
    Alert.alert(
      'Remove this person?',
      `${name} will still show on the roster for the week of ${formatDateLong(lastWeek)}. Their seat becomes vacant the week after.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            setSaving(true);
            try {
              // lastWeek is already a Monday (toMonday above), so the
              // seat's vacancy starts exactly 7 days later.
              const nextWeekStart = toIsoDate(addDays(new Date(`${lastWeek}T00:00:00`), 7));
              await setStaffActiveTo(db, removeStaffId, lastWeek);
              const currentRoomId = roomIdForStaffAtWeek(roomHistory, removeStaffId, lastWeek);
              if (currentRoomId) {
                await closeCurrentRoomHistoryEntry(db, removeStaffId, nextWeekStart);
              }
              setModal(null);
              await load();
            } finally {
              setSaving(false);
            }
          },
        },
      ],
    );
  };

  const closeModal = () => {
    setModal(null);
    setAddPickerOpen(null);
    setTransferPickerOpen(null);
    setRemovePickerOpen(null);
  };

  const seatSummary = (room: RoomLookup) => {
    const occupants = groups.byRoom.get(room.id)?.length ?? 0;
    return `${room.name} — ${room.floor === 'ground' ? 'Ground floor' : '1st floor'} (${occupants}/${room.seats})`;
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.toolbar}>
        <Pressable style={styles.addButton} onPress={openAdd}>
          <Text style={styles.addButtonText}>+ Add Staff</Text>
        </Pressable>
        <Pressable style={styles.addButton} onPress={openTransfer}>
          <Text style={styles.addButtonText}>Transfer</Text>
        </Pressable>
        <Pressable style={[styles.addButton, styles.removeButton]} onPress={openRemove}>
          <Text style={styles.addButtonText}>Remove Staff</Text>
        </Pressable>
      </View>

      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator />
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.listContent}>
          {rooms.map((room) => (
            <View key={room.id} style={styles.section}>
              <Text style={styles.sectionTitle}>{seatSummary(room)}</Text>
              {(groups.byRoom.get(room.id) ?? []).map((s) => (
                <Text key={s.id} style={styles.personRow}>
                  {s.name}
                </Text>
              ))}
              {(groups.byRoom.get(room.id) ?? []).length === 0 && (
                <Text style={styles.emptyRoomText}>Nobody assigned</Text>
              )}
            </View>
          ))}

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Management / no room</Text>
            {groups.roomless.map((s) => (
              <Text key={s.id} style={styles.personRow}>
                {s.name}
              </Text>
            ))}
          </View>
        </ScrollView>
      )}

      {/* Add Staff */}
      <Modal visible={modal === 'add'} animationType="slide" transparent onRequestClose={closeModal}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Add Staff</Text>

            <Text style={styles.fieldLabel}>Name</Text>
            <TextInput
              style={styles.textInput}
              value={addName}
              onChangeText={setAddName}
              placeholder="Full name"
              placeholderTextColor="#A0AEC0"
            />

            <Text style={styles.fieldLabel}>Room</Text>
            <Pressable style={styles.fieldInput} onPress={() => setAddPickerOpen('room')}>
              <Text style={addRoomId ? styles.fieldValue : styles.fieldPlaceholder}>
                {addRoomId ? roomName(addRoomId) : 'Choose a room'}
              </Text>
            </Pressable>

            <Text style={styles.fieldLabel}>Start week</Text>
            <Pressable style={styles.fieldInput} onPress={() => setAddPickerOpen('date')}>
              <Text style={styles.fieldValue}>{formatDateLong(weekStartOf(addStartWeek))}</Text>
            </Pressable>

            <View style={styles.modalButtons}>
              <Pressable style={styles.cancelButton} onPress={closeModal}>
                <Text style={styles.cancelButtonText}>Cancel</Text>
              </Pressable>
              <Pressable style={styles.saveButton} onPress={submitAdd} disabled={saving}>
                {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.saveButtonText}>Save</Text>}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
      <PickerModal
        visible={addPickerOpen === 'room'}
        title="Choose a room"
        items={rooms}
        labelFor={(r) => r.name}
        onSelect={(r) => {
          setAddRoomId(r.id);
          setAddPickerOpen(null);
        }}
        onClose={() => setAddPickerOpen(null)}
      />
      {addPickerOpen === 'date' && (
        <DateTimePicker
          value={addStartWeek}
          mode="date"
          display="default"
          onChange={(_e, selected) => {
            setAddPickerOpen(null);
            if (selected) setAddStartWeek(selected);
          }}
        />
      )}

      {/* Transfer */}
      <Modal visible={modal === 'transfer'} animationType="slide" transparent onRequestClose={closeModal}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Transfer</Text>

            <Text style={styles.fieldLabel}>Person</Text>
            <Pressable style={styles.fieldInput} onPress={() => setTransferPickerOpen('person')}>
              <Text style={transferStaffId ? styles.fieldValue : styles.fieldPlaceholder}>
                {transferStaffId ? staffName(transferStaffId) : 'Choose a person'}
              </Text>
            </Pressable>

            <Text style={styles.fieldLabel}>New room</Text>
            <Pressable style={styles.fieldInput} onPress={() => setTransferPickerOpen('room')}>
              <Text style={transferRoomId ? styles.fieldValue : styles.fieldPlaceholder}>
                {transferRoomId ? roomName(transferRoomId) : 'Choose a room'}
              </Text>
            </Pressable>

            <Text style={styles.fieldLabel}>Effective week</Text>
            <Pressable style={styles.fieldInput} onPress={() => setTransferPickerOpen('date')}>
              <Text style={styles.fieldValue}>{formatDateLong(weekStartOf(transferWeek))}</Text>
            </Pressable>

            <View style={styles.modalButtons}>
              <Pressable style={styles.cancelButton} onPress={closeModal}>
                <Text style={styles.cancelButtonText}>Cancel</Text>
              </Pressable>
              <Pressable style={styles.saveButton} onPress={submitTransfer} disabled={saving}>
                {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.saveButtonText}>Save</Text>}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
      <PickerModal
        visible={transferPickerOpen === 'person'}
        title="Choose a person"
        items={groups.activeStaff}
        labelFor={(s) => s.name}
        onSelect={(s) => {
          setTransferStaffId(s.id);
          setTransferPickerOpen(null);
        }}
        onClose={() => setTransferPickerOpen(null)}
      />
      <PickerModal
        visible={transferPickerOpen === 'room'}
        title="Choose a room"
        items={rooms}
        labelFor={(r) => r.name}
        onSelect={(r) => {
          setTransferRoomId(r.id);
          setTransferPickerOpen(null);
        }}
        onClose={() => setTransferPickerOpen(null)}
      />
      {transferPickerOpen === 'date' && (
        <DateTimePicker
          value={transferWeek}
          mode="date"
          display="default"
          onChange={(_e, selected) => {
            setTransferPickerOpen(null);
            if (selected) setTransferWeek(selected);
          }}
        />
      )}

      {/* Remove Staff */}
      <Modal visible={modal === 'remove'} animationType="slide" transparent onRequestClose={closeModal}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Remove Staff (leaver)</Text>

            <Text style={styles.fieldLabel}>Person</Text>
            <Pressable style={styles.fieldInput} onPress={() => setRemovePickerOpen('person')}>
              <Text style={removeStaffId ? styles.fieldValue : styles.fieldPlaceholder}>
                {removeStaffId ? staffName(removeStaffId) : 'Choose a person'}
              </Text>
            </Pressable>

            <Text style={styles.fieldLabel}>Last week</Text>
            <Pressable style={styles.fieldInput} onPress={() => setRemovePickerOpen('date')}>
              <Text style={styles.fieldValue}>{formatDateLong(weekStartOf(removeLastWeek))}</Text>
            </Pressable>

            <View style={styles.modalButtons}>
              <Pressable style={styles.cancelButton} onPress={closeModal}>
                <Text style={styles.cancelButtonText}>Cancel</Text>
              </Pressable>
              <Pressable style={styles.saveButton} onPress={submitRemove} disabled={saving}>
                {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.saveButtonText}>Remove</Text>}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
      <PickerModal
        visible={removePickerOpen === 'person'}
        title="Choose a person"
        items={groups.activeStaff}
        labelFor={(s) => s.name}
        onSelect={(s) => {
          setRemoveStaffId(s.id);
          setRemovePickerOpen(null);
        }}
        onClose={() => setRemovePickerOpen(null)}
      />
      {removePickerOpen === 'date' && (
        <DateTimePicker
          value={removeLastWeek}
          mode="date"
          display="default"
          onChange={(_e, selected) => {
            setRemovePickerOpen(null);
            if (selected) setRemoveLastWeek(selected);
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
  removeButton: { backgroundColor: '#9B2C2C' },
  addButtonText: { color: '#fff', fontWeight: '700' },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  listContent: { padding: 16 },
  section: { marginBottom: 20 },
  sectionTitle: { fontSize: 15, fontWeight: '700', color: '#1F4E79', marginBottom: 8 },
  personRow: { fontSize: 15, color: '#1A202C', paddingVertical: 6 },
  emptyRoomText: { fontSize: 13, color: '#A0AEC0', fontStyle: 'italic' },
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
  fieldValue: { fontSize: 15, color: '#1A202C' },
  fieldPlaceholder: { fontSize: 15, color: '#A0AEC0' },
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
  pickerRow: {
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#E2E8F0',
    minHeight: 48,
    justifyContent: 'center',
  },
});

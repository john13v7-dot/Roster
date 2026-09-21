// © 2026 David Juste. All rights reserved. Proprietary and confidential.

import type { SQLiteDatabase } from 'expo-sqlite';
import type {
  LeaveEntry,
  LeaveType,
  RoomHistoryEntry,
  RosterEntry,
  RosterEntryType,
  RosterWeekStatus,
  Staff,
} from '../domain/types';
import type { ShiftPatternCode } from '../config/creche.config';
import { mergeLeaveIntoEntries } from '../domain/leave';

interface StaffRow {
  id: string;
  name: string;
  type: Staff['type'];
  payroll_included: number;
  active_from: string | null;
  active_to: string | null;
  sort_order: number;
  numbered: number;
}

function toStaff(row: StaffRow): Staff {
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    payrollIncluded: row.payroll_included === 1,
    activeFrom: row.active_from,
    activeTo: row.active_to,
    sortOrder: row.sort_order,
    numbered: row.numbered === 1,
  };
}

export async function getAllStaff(db: SQLiteDatabase): Promise<Staff[]> {
  const rows = await db.getAllAsync<StaffRow>('SELECT * FROM staff ORDER BY sort_order ASC;');
  return rows.map(toStaff);
}

export async function insertStaff(db: SQLiteDatabase, staff: Staff): Promise<void> {
  await db.runAsync(
    `INSERT INTO staff (id, name, type, payroll_included, active_from, active_to, sort_order, numbered)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?);`,
    [
      staff.id,
      staff.name,
      staff.type,
      staff.payrollIncluded ? 1 : 0,
      staff.activeFrom,
      staff.activeTo,
      staff.sortOrder,
      staff.numbered ? 1 : 0,
    ],
  );
}

export async function setStaffActiveTo(db: SQLiteDatabase, staffId: string, activeTo: string): Promise<void> {
  await db.runAsync('UPDATE staff SET active_to = ? WHERE id = ?;', [activeTo, staffId]);
}

interface RoomHistoryRow {
  staff_id: string;
  room_id: string;
  from_week: string;
  to_week: string | null;
}

function toRoomHistoryEntry(row: RoomHistoryRow): RoomHistoryEntry {
  return { staffId: row.staff_id, roomId: row.room_id, fromWeek: row.from_week, toWeek: row.to_week };
}

/** The full room history for every person — a small table; simplest read as one list. */
export async function getRoomHistory(db: SQLiteDatabase): Promise<RoomHistoryEntry[]> {
  const rows = await db.getAllAsync<RoomHistoryRow>('SELECT * FROM room_history ORDER BY from_week ASC;');
  return rows.map(toRoomHistoryEntry);
}

export async function addRoomHistoryEntry(db: SQLiteDatabase, entry: RoomHistoryEntry): Promise<void> {
  await db.runAsync('INSERT INTO room_history (staff_id, room_id, from_week, to_week) VALUES (?, ?, ?, ?);', [
    entry.staffId,
    entry.roomId,
    entry.fromWeek,
    entry.toWeek,
  ]);
}

/** Closes a person's current (open-ended) room_history row as of `toWeek`. */
export async function closeCurrentRoomHistoryEntry(
  db: SQLiteDatabase,
  staffId: string,
  toWeek: string,
): Promise<void> {
  await db.runAsync(
    'UPDATE room_history SET to_week = ? WHERE staff_id = ? AND to_week IS NULL;',
    [toWeek, staffId],
  );
}

/**
 * Transfer (SPEC.md §7): closes the person's current room assignment as
 * of `effectiveWeek` and opens a new one in `newRoomId` from that same
 * week, so earlier weeks keep showing the old room and later weeks show
 * the new one.
 */
export async function transferStaffToRoom(
  db: SQLiteDatabase,
  staffId: string,
  newRoomId: string,
  effectiveWeek: string,
): Promise<void> {
  await closeCurrentRoomHistoryEntry(db, staffId, effectiveWeek);
  await addRoomHistoryEntry(db, { staffId, roomId: newRoomId, fromWeek: effectiveWeek, toWeek: null });
}

interface RoomRow {
  id: string;
  name: string;
  floor: 'ground' | 'first';
  seats: number;
  sort_order: number;
}

export interface RoomLookup {
  id: string;
  name: string;
  floor: 'ground' | 'first';
  seats: number;
}

export async function getRoomsById(db: SQLiteDatabase): Promise<Record<string, RoomLookup>> {
  const rows = await db.getAllAsync<RoomRow>('SELECT * FROM rooms;');
  const byId: Record<string, RoomLookup> = {};
  for (const r of rows) {
    byId[r.id] = { id: r.id, name: r.name, floor: r.floor, seats: r.seats };
  }
  return byId;
}

export async function getAllRooms(db: SQLiteDatabase): Promise<RoomLookup[]> {
  const rows = await db.getAllAsync<RoomRow>('SELECT * FROM rooms ORDER BY sort_order ASC;');
  return rows.map((r) => ({ id: r.id, name: r.name, floor: r.floor, seats: r.seats }));
}

interface RosterEntryRow {
  week_start: string;
  staff_id: string;
  date: string;
  type: RosterEntryType;
  pattern_code: ShiftPatternCode | null;
  start_time: string | null;
  end_time: string | null;
  unpaid_lunch_min: number;
  source: RosterEntry['source'];
  note: string | null;
}

function toRosterEntry(row: RosterEntryRow): RosterEntry {
  return {
    weekStart: row.week_start,
    staffId: row.staff_id,
    date: row.date,
    type: row.type,
    patternCode: row.pattern_code,
    start: row.start_time,
    end: row.end_time,
    unpaidLunchMinutes: row.unpaid_lunch_min,
    source: row.source,
    note: row.note,
  };
}

/** All roster entries for a Mon-Fri week, keyed "staffId|date" for O(1) cell lookup. */
export async function getRosterEntriesForWeek(
  db: SQLiteDatabase,
  weekStart: string,
): Promise<Record<string, RosterEntry>> {
  const rows = await db.getAllAsync<RosterEntryRow>(
    'SELECT * FROM roster_entries WHERE week_start = ?;',
    [weekStart],
  );
  const byKey: Record<string, RosterEntry> = {};
  for (const r of rows) {
    byKey[`${r.staff_id}|${r.date}`] = toRosterEntry(r);
  }
  return byKey;
}

export async function getRosterWeekStatus(
  db: SQLiteDatabase,
  weekStart: string,
): Promise<RosterWeekStatus> {
  const row = await db.getFirstAsync<{ status: RosterWeekStatus }>(
    'SELECT status FROM roster_weeks WHERE week_start = ?;',
    [weekStart],
  );
  return row?.status ?? 'draft';
}

export async function upsertRosterEntry(db: SQLiteDatabase, entry: RosterEntry): Promise<void> {
  await db.runAsync(
    `INSERT INTO roster_entries
       (week_start, staff_id, date, type, pattern_code, start_time, end_time, unpaid_lunch_min, source, note)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(staff_id, date) DO UPDATE SET
       week_start = excluded.week_start,
       type = excluded.type,
       pattern_code = excluded.pattern_code,
       start_time = excluded.start_time,
       end_time = excluded.end_time,
       unpaid_lunch_min = excluded.unpaid_lunch_min,
       source = excluded.source,
       note = excluded.note;`,
    [
      entry.weekStart,
      entry.staffId,
      entry.date,
      entry.type,
      entry.patternCode,
      entry.start,
      entry.end,
      entry.unpaidLunchMinutes,
      entry.source,
      entry.note,
    ],
  );
}

export async function deleteRosterEntry(db: SQLiteDatabase, staffId: string, date: string): Promise<void> {
  await db.runAsync('DELETE FROM roster_entries WHERE staff_id = ? AND date = ?;', [staffId, date]);
}

interface LeaveRow {
  id: string;
  staff_id: string;
  type: LeaveType;
  from_date: string;
  to_date: string | null;
}

function toLeaveEntry(row: LeaveRow): LeaveEntry {
  return { id: row.id, staffId: row.staff_id, type: row.type, fromDate: row.from_date, toDate: row.to_date };
}

export async function getAllLeave(db: SQLiteDatabase): Promise<LeaveEntry[]> {
  const rows = await db.getAllAsync<LeaveRow>('SELECT * FROM leave ORDER BY from_date DESC;');
  return rows.map(toLeaveEntry);
}

export async function addLeave(db: SQLiteDatabase, entry: LeaveEntry): Promise<void> {
  await db.runAsync('INSERT INTO leave (id, staff_id, type, from_date, to_date) VALUES (?, ?, ?, ?, ?);', [
    entry.id,
    entry.staffId,
    entry.type,
    entry.fromDate,
    entry.toDate,
  ]);
}

export async function updateLeave(db: SQLiteDatabase, entry: LeaveEntry): Promise<void> {
  await db.runAsync(
    'UPDATE leave SET staff_id = ?, type = ?, from_date = ?, to_date = ? WHERE id = ?;',
    [entry.staffId, entry.type, entry.fromDate, entry.toDate, entry.id],
  );
}

export async function deleteLeave(db: SQLiteDatabase, id: string): Promise<void> {
  await db.runAsync('DELETE FROM leave WHERE id = ?;', [id]);
}

/**
 * The roster entries actually shown for a week: persisted roster_entries,
 * with any staff currently on leave overriding their cells for the
 * matching dates (SPEC.md §12, R7 "nobody on leave is given a shift").
 * This is how an open-ended ("until further notice") leave entry fills
 * every week without writing a row per day up front.
 */
export async function getWeekRosterView(
  db: SQLiteDatabase,
  weekStart: string,
  dates: string[],
  staffIds: string[],
): Promise<Record<string, RosterEntry>> {
  const [persisted, leave] = await Promise.all([getRosterEntriesForWeek(db, weekStart), getAllLeave(db)]);
  return mergeLeaveIntoEntries(persisted, dates, staffIds, leave, weekStart);
}

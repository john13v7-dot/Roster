// © 2026 David Juste. All rights reserved. Proprietary and confidential.

import type { SQLiteDatabase } from 'expo-sqlite';
import type { LeaveEntry, LeaveType, RosterEntry, RosterEntryType, RosterWeekStatus, Staff, VacantSeat } from '../domain/types';
import type { ShiftPatternCode } from '../config/creche.config';
import { mergeLeaveIntoEntries } from '../domain/leave';

interface StaffRow {
  id: string;
  name: string;
  type: Staff['type'];
  room_id: string | null;
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
    roomId: row.room_id,
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

interface VacantSeatRow {
  id: string;
  room_id: string;
  sort_order: number;
}

export async function getVacantSeats(db: SQLiteDatabase): Promise<VacantSeat[]> {
  const rows = await db.getAllAsync<VacantSeatRow>('SELECT * FROM vacant_seats ORDER BY sort_order ASC;');
  return rows.map((r) => ({ id: r.id, roomId: r.room_id, sortOrder: r.sort_order }));
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

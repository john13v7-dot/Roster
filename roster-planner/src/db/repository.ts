// © 2026 David Juste. All rights reserved. Proprietary and confidential.

import type { SQLiteDatabase } from 'expo-sqlite';
import type { RosterEntry, RosterEntryType, RosterWeekStatus, Staff, VacantSeat } from '../domain/types';
import type { ShiftPatternCode } from '../config/creche.config';

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

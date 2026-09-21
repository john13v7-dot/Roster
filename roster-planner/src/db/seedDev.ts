// © 2026 David Juste. All rights reserved. Proprietary and confidential.
//
// Development/test-only seed data (SPEC.md §16). Gated on ALLOW_DEV_SEED_DATA
// (false in a release build, SPEC.md §22) — never call this from code that
// also runs in production.

import type { SQLiteDatabase } from 'expo-sqlite';
import { weekDates } from '../domain/week';
import type { LeaveEntry, RosterEntry, Staff } from '../domain/types';

const SEED_WEEK_START = '2026-09-21'; // Mon 21 Sep 2026

interface SeedStaff extends Staff {}

const seedStaff: SeedStaff[] = [
  { id: 'sue', name: 'Sue', type: 'static', roomId: null, payrollIncluded: true, activeFrom: null, activeTo: null, sortOrder: 100, numbered: true },
  { id: 'hanny', name: 'Hanny', type: 'rotating', roomId: 'toddlers', payrollIncluded: true, activeFrom: null, activeTo: null, sortOrder: 1010, numbered: true },
  { id: 'manuel', name: 'Manuel', type: 'rotating', roomId: 'preschoolers', payrollIncluded: true, activeFrom: null, activeTo: null, sortOrder: 2010, numbered: true },
  { id: 'irene', name: 'Irene', type: 'rotating', roomId: 'preschoolers', payrollIncluded: true, activeFrom: null, activeTo: null, sortOrder: 2020, numbered: true },
  { id: 'deoshree', name: 'Deoshree', type: 'rotating', roomId: 'preschoolers', payrollIncluded: true, activeFrom: null, activeTo: null, sortOrder: 2030, numbered: true },
  { id: 'sandrine', name: 'Sandrine', type: 'rotating', roomId: 'ecec1', payrollIncluded: true, activeFrom: null, activeTo: null, sortOrder: 3010, numbered: true },
  { id: 'daniel', name: 'Daniel', type: 'rotating', roomId: 'ecec1', payrollIncluded: true, activeFrom: null, activeTo: null, sortOrder: 3020, numbered: true },
  { id: 'arantza', name: 'Arantza', type: 'rotating', roomId: 'ecec1', payrollIncluded: true, activeFrom: null, activeTo: null, sortOrder: 3030, numbered: true },
  { id: 'david', name: 'David', type: 'rotating', roomId: 'ecec2', payrollIncluded: true, activeFrom: null, activeTo: null, sortOrder: 4010, numbered: true },
  { id: 'usha', name: 'Usha', type: 'rotating', roomId: 'ecec2', payrollIncluded: true, activeFrom: null, activeTo: null, sortOrder: 4020, numbered: true },
  // Long-term leave row: no room while on leave (SPEC.md §18 item 2,
  // confirmed) — her return date and room are both unknown for now.
  { id: 'eirini', name: 'Eirini', type: 'rotating', roomId: null, payrollIncluded: true, activeFrom: null, activeTo: null, sortOrder: 6010, numbered: false },
  { id: 'megan', name: 'Megan', type: 'static', roomId: null, payrollIncluded: false, activeFrom: null, activeTo: null, sortOrder: 7010, numbered: true },
  // roomId set for floor-cover attribution only (SPEC.md §5) — not a counted seat.
  { id: 'jason', name: 'Jason', type: 'paired_management', roomId: 'ecec2', payrollIncluded: true, activeFrom: null, activeTo: null, sortOrder: 7020, numbered: true },
  { id: 'shehnaz', name: 'Shehnaz', type: 'paired_management', roomId: null, payrollIncluded: true, activeFrom: null, activeTo: null, sortOrder: 7030, numbered: true },
  { id: 'priscilla', name: 'Priscilla', type: 'manager', roomId: null, payrollIncluded: false, activeFrom: null, activeTo: null, sortOrder: 7040, numbered: true },
  { id: 'laura', name: 'Laura', type: 'static', roomId: null, payrollIncluded: true, activeFrom: null, activeTo: null, sortOrder: 7050, numbered: true },
];

const seedVacantSeats = [{ id: 'vacant-toddlers-3', roomId: 'toddlers', sortOrder: 1020 }];

const seedStaticHours: { staffId: string; weekday: 1 | 2 | 3 | 4 | 5; start: string; end: string }[] = [
  ...[1, 2, 3, 4, 5].map((weekday) => ({ staffId: 'sue', weekday: weekday as 1 | 2 | 3 | 4 | 5, start: '08:30', end: '13:30' })),
  ...[1, 2, 3, 4, 5].map((weekday) => ({ staffId: 'laura', weekday: weekday as 1 | 2 | 3 | 4 | 5, start: '09:00', end: '13:00' })),
];

const seedLeave: LeaveEntry[] = [
  { id: 'leave-shehnaz-2026-09-21', staffId: 'shehnaz', type: 'holiday', fromDate: '2026-09-21', toDate: '2026-09-25' },
  { id: 'leave-eirini-maternity', staffId: 'eirini', type: 'maternity', fromDate: '2026-01-05', toDate: null },
];

/** person -> pattern code, for the 5 weekdays of the seed week (SPEC.md §16). */
const seedPatternByStaff: Record<string, 'S1' | 'S2' | 'S3' | 'S4'> = {
  hanny: 'S1',
  deoshree: 'S1',
  jason: 'S1',
  manuel: 'S2',
  daniel: 'S2',
  sandrine: 'S3',
  david: 'S3',
  irene: 'S4',
  arantza: 'S4',
  usha: 'S4',
};

const shiftTimes: Record<'S1' | 'S2' | 'S3' | 'S4', { start: string; end: string }> = {
  S1: { start: '07:30', end: '16:30' },
  S2: { start: '08:00', end: '17:00' },
  S3: { start: '08:30', end: '17:30' },
  S4: { start: '09:00', end: '18:00' },
};

export async function seedDevData(db: SQLiteDatabase): Promise<void> {
  const existing = await db.getFirstAsync<{ count: number }>('SELECT COUNT(*) as count FROM staff;');
  if (existing && existing.count > 0) return; // already seeded

  for (const s of seedStaff) {
    await db.runAsync(
      `INSERT INTO staff (id, name, type, room_id, payroll_included, active_from, active_to, sort_order, numbered)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?);`,
      [s.id, s.name, s.type, s.roomId, s.payrollIncluded ? 1 : 0, s.activeFrom, s.activeTo, s.sortOrder, s.numbered ? 1 : 0],
    );
  }

  for (const v of seedVacantSeats) {
    await db.runAsync('INSERT INTO vacant_seats (id, room_id, sort_order) VALUES (?, ?, ?);', [
      v.id,
      v.roomId,
      v.sortOrder,
    ]);
  }

  for (const h of seedStaticHours) {
    await db.runAsync(
      'INSERT INTO static_hours (staff_id, weekday, start_time, end_time) VALUES (?, ?, ?, ?);',
      [h.staffId, h.weekday, h.start, h.end],
    );
  }

  for (const l of seedLeave) {
    await db.runAsync('INSERT INTO leave (id, staff_id, type, from_date, to_date) VALUES (?, ?, ?, ?, ?);', [
      l.id,
      l.staffId,
      l.type,
      l.fromDate,
      l.toDate,
    ]);
  }

  await db.runAsync("INSERT INTO roster_weeks (week_start, status) VALUES (?, 'locked');", [SEED_WEEK_START]);

  const dates = weekDates(new Date(`${SEED_WEEK_START}T00:00:00`));
  const entries: RosterEntry[] = [];

  for (const date of dates) {
    // Rotating + paired-management staff on their seed-week pattern.
    for (const [staffId, code] of Object.entries(seedPatternByStaff)) {
      const times = shiftTimes[code];
      entries.push({
        weekStart: SEED_WEEK_START,
        staffId,
        date,
        type: 'shift',
        patternCode: code,
        start: times.start,
        end: times.end,
        unpaidLunchMinutes: 60,
        source: 'manual',
        note: null,
      });
    }
  }

  // Sue: static hours Mon/Tue/Wed/Fri, OFF Thursday (SPEC.md §16).
  for (const date of dates) {
    const isThursday = new Date(`${date}T00:00:00`).getDay() === 4;
    entries.push({
      weekStart: SEED_WEEK_START,
      staffId: 'sue',
      date,
      type: isThursday ? 'off' : 'shift',
      patternCode: null,
      start: isThursday ? null : '08:30',
      end: isThursday ? null : '13:30',
      unpaidLunchMinutes: 0,
      source: 'manual',
      note: null,
    });
  }

  // Laura: static hours every day.
  for (const date of dates) {
    entries.push({
      weekStart: SEED_WEEK_START,
      staffId: 'laura',
      date,
      type: 'shift',
      patternCode: null,
      start: '09:00',
      end: '13:00',
      unpaidLunchMinutes: 0,
      source: 'manual',
      note: null,
    });
  }

  // Priscilla: manual hours, Monday differs from Tue-Fri (SPEC.md §16).
  for (const date of dates) {
    const isMonday = new Date(`${date}T00:00:00`).getDay() === 1;
    entries.push({
      weekStart: SEED_WEEK_START,
      staffId: 'priscilla',
      date,
      type: 'shift',
      patternCode: null,
      start: '10:00',
      end: isMonday ? '14:00' : '18:00',
      unpaidLunchMinutes: 0,
      source: 'manual',
      note: null,
    });
  }

  // Shehnaz (Holiday) and Eirini (Maternity Leave) are NOT written here as
  // roster_entries — they're already in the `leave` table above, and
  // getWeekRosterView derives their Holiday/Maternity cells from that for
  // every week they cover (SPEC.md §12, src/domain/leave.ts).
  // Megan is left blank for the seed week (SPEC.md §16) — no entries inserted.

  for (const e of entries) {
    await db.runAsync(
      `INSERT INTO roster_entries
         (week_start, staff_id, date, type, pattern_code, start_time, end_time, unpaid_lunch_min, source, note)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
      [e.weekStart, e.staffId, e.date, e.type, e.patternCode, e.start, e.end, e.unpaidLunchMinutes, e.source, e.note],
    );
  }

  // Fairness ledger: the seed week counts once for each rotating/paired-management
  // person who actually worked it (SPEC.md §8) — Shehnaz was on holiday, so excluded.
  for (const [staffId, code] of Object.entries(seedPatternByStaff)) {
    await db.runAsync(
      'INSERT INTO fairness_ledger (staff_id, week_start, pattern_code) VALUES (?, ?, ?);',
      [staffId, SEED_WEEK_START, code],
    );
  }
}

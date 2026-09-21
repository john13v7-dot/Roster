// © 2026 David Juste. All rights reserved. Proprietary and confidential.

import type { SQLiteDatabase } from 'expo-sqlite';
import { duties, rooms, shiftPatterns } from '../config/creche.config';
import { CREATE_TABLES_SQL } from './schema';

export const DATABASE_NAME = 'roster.db';

/** Creates tables (if needed) and loads the configuration layer (rooms, shift
 * patterns, duties) into the database. Idempotent — safe to call on every
 * app start. Does NOT touch staff/roster data. */
export async function initDatabase(db: SQLiteDatabase): Promise<void> {
  await db.execAsync('PRAGMA foreign_keys = ON;');
  await db.execAsync(CREATE_TABLES_SQL);

  for (const room of rooms) {
    await db.runAsync(
      `INSERT INTO rooms (id, name, floor, seats, sort_order) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET name = excluded.name, floor = excluded.floor,
         seats = excluded.seats, sort_order = excluded.sort_order;`,
      [room.id, room.name, room.floor, room.seats, room.sortOrder],
    );
  }

  for (const pattern of shiftPatterns) {
    await db.runAsync(
      `INSERT INTO shift_patterns (code, start_time, end_time, unpaid_lunch_min) VALUES (?, ?, ?, ?)
       ON CONFLICT(code) DO UPDATE SET start_time = excluded.start_time, end_time = excluded.end_time,
         unpaid_lunch_min = excluded.unpaid_lunch_min;`,
      [pattern.code, pattern.start, pattern.end, pattern.unpaidLunchMinutes],
    );
  }

  for (const duty of duties) {
    await db.runAsync(
      `INSERT INTO duties (id, name, sort_order, default_text) VALUES (?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET name = excluded.name, sort_order = excluded.sort_order,
         default_text = excluded.default_text;`,
      [duty.id, duty.name, duty.sortOrder, duty.defaultText ?? null],
    );
  }
}

// © 2026 David Juste. All rights reserved. Proprietary and confidential.

import type { SQLiteDatabase } from 'expo-sqlite';
import { duties, rooms, shiftPatterns } from '../config/creche.config';
import { CREATE_TABLES_SQL, DROP_TABLES_SQL, SCHEMA_VERSION } from './schema';

export const DATABASE_NAME = 'roster.db';

/**
 * Creates tables (if needed) and loads the configuration layer (rooms,
 * shift patterns, duties) into the database. Idempotent — safe to call on
 * every app start.
 *
 * If the on-device schema is behind SCHEMA_VERSION, every table is
 * dropped and recreated first (see schema.ts) — there's no real user data
 * to protect yet, and without this a stale table from an earlier build
 * just silently drifts out of sync with the app's queries (missing/extra
 * columns), which is what was happening when testing across phases on
 * the same phone/emulator without ever clearing app storage.
 */
export async function initDatabase(db: SQLiteDatabase): Promise<void> {
  const versionRow = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version;');
  const currentVersion = versionRow?.user_version ?? 0;

  if (currentVersion < SCHEMA_VERSION) {
    await db.execAsync('PRAGMA foreign_keys = OFF;');
    await db.execAsync(DROP_TABLES_SQL);
    await db.execAsync(`PRAGMA user_version = ${SCHEMA_VERSION};`);
  }

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

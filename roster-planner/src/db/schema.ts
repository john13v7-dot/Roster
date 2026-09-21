// © 2026 David Juste. All rights reserved. Proprietary and confidential.
//
// SQLite schema (SPEC.md §13). No server, no account — this is the whole
// on-device data store.
//
// SCHEMA_VERSION is checked against SQLite's own PRAGMA user_version in
// db/client.ts: a mismatch means the on-device tables predate a shape
// change (e.g. Phase 4 dropped staff.room_id and vacant_seats in favour
// of room_history; Phase 5 added staff.floor_override), so every table is
// dropped and recreated rather than silently drifting out of sync with
// the app's queries. Bump this whenever CREATE_TABLES_SQL changes shape.
// Fine while there's no real user data yet (SPEC.md §22); a real
// migration path is release-prep work (§21).
export const SCHEMA_VERSION = 2;

export const CREATE_TABLES_SQL = `
CREATE TABLE IF NOT EXISTS staff (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('rotating','paired_management','manager','static')),
  payroll_included INTEGER NOT NULL DEFAULT 1,
  active_from TEXT,
  active_to TEXT,
  sort_order INTEGER NOT NULL,
  numbered INTEGER NOT NULL DEFAULT 1,
  floor_override TEXT CHECK (floor_override IN ('ground','first'))
);

CREATE TABLE IF NOT EXISTS rooms (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  floor TEXT NOT NULL CHECK (floor IN ('ground','first')),
  seats INTEGER NOT NULL,
  sort_order INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS room_history (
  staff_id TEXT NOT NULL REFERENCES staff(id),
  room_id TEXT NOT NULL REFERENCES rooms(id),
  from_week TEXT NOT NULL,
  to_week TEXT,
  PRIMARY KEY (staff_id, from_week)
);

CREATE TABLE IF NOT EXISTS shift_patterns (
  code TEXT PRIMARY KEY,
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL,
  unpaid_lunch_min INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS static_hours (
  staff_id TEXT NOT NULL REFERENCES staff(id),
  weekday INTEGER NOT NULL CHECK (weekday BETWEEN 1 AND 5),
  start_time TEXT,
  end_time TEXT,
  PRIMARY KEY (staff_id, weekday)
);

CREATE TABLE IF NOT EXISTS leave (
  id TEXT PRIMARY KEY,
  staff_id TEXT NOT NULL REFERENCES staff(id),
  type TEXT NOT NULL CHECK (type IN ('holiday','maternity','sick')),
  from_date TEXT NOT NULL,
  to_date TEXT
);

CREATE TABLE IF NOT EXISTS roster_weeks (
  week_start TEXT PRIMARY KEY,
  status TEXT NOT NULL CHECK (status IN ('draft','locked')) DEFAULT 'draft'
);

CREATE TABLE IF NOT EXISTS roster_entries (
  week_start TEXT NOT NULL,
  staff_id TEXT NOT NULL REFERENCES staff(id),
  date TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('shift','holiday','maternity','off','blank')),
  pattern_code TEXT REFERENCES shift_patterns(code),
  start_time TEXT,
  end_time TEXT,
  unpaid_lunch_min INTEGER NOT NULL DEFAULT 0,
  source TEXT NOT NULL CHECK (source IN ('generated','manual')),
  note TEXT,
  PRIMARY KEY (staff_id, date)
);

CREATE TABLE IF NOT EXISTS fairness_ledger (
  staff_id TEXT NOT NULL REFERENCES staff(id),
  week_start TEXT NOT NULL,
  pattern_code TEXT NOT NULL REFERENCES shift_patterns(code),
  PRIMARY KEY (staff_id, week_start)
);

CREATE TABLE IF NOT EXISTS duties (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  sort_order INTEGER NOT NULL,
  default_text TEXT
);

CREATE TABLE IF NOT EXISTS duty_assignments (
  week_start TEXT NOT NULL,
  duty_id TEXT NOT NULL REFERENCES duties(id),
  staff_ids TEXT NOT NULL DEFAULT '[]',
  text TEXT,
  PRIMARY KEY (week_start, duty_id)
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);
`;

/** Every table this app has ever created, including ones later phases dropped
 * (e.g. vacant_seats, pre-Phase-4) — DROP IF EXISTS is a no-op for a table
 * that was never there. */
export const DROP_TABLES_SQL = `
DROP TABLE IF EXISTS duty_assignments;
DROP TABLE IF EXISTS duties;
DROP TABLE IF EXISTS fairness_ledger;
DROP TABLE IF EXISTS roster_entries;
DROP TABLE IF EXISTS roster_weeks;
DROP TABLE IF EXISTS leave;
DROP TABLE IF EXISTS static_hours;
DROP TABLE IF EXISTS shift_patterns;
DROP TABLE IF EXISTS room_history;
DROP TABLE IF EXISTS vacant_seats;
DROP TABLE IF EXISTS rooms;
DROP TABLE IF EXISTS staff;
DROP TABLE IF EXISTS settings;
`;

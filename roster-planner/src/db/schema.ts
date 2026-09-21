// © 2026 David Juste. All rights reserved. Proprietary and confidential.
//
// SQLite schema (SPEC.md §13). No server, no account — this is the whole
// on-device data store.

export const SCHEMA_VERSION = 1;

export const CREATE_TABLES_SQL = `
CREATE TABLE IF NOT EXISTS staff (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('rotating','paired_management','manager','static')),
  room_id TEXT REFERENCES rooms(id),
  payroll_included INTEGER NOT NULL DEFAULT 1,
  active_from TEXT,
  active_to TEXT,
  sort_order INTEGER NOT NULL,
  numbered INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS vacant_seats (
  id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL REFERENCES rooms(id),
  sort_order INTEGER NOT NULL
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

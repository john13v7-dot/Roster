// © 2026 David Juste. All rights reserved. Proprietary and confidential.

import type { ShiftPatternCode } from '../config/creche.config';

export type StaffType = 'rotating' | 'paired_management' | 'manager' | 'static';

export interface Staff {
  id: string;
  name: string;
  type: StaffType;
  /** Current room; null for a floater/manager/static person with no room. */
  roomId: string | null;
  payrollIncluded: boolean;
  /** ISO Monday date this person's first roster week is/was. Null = always employed. */
  activeFrom: string | null;
  /** ISO Monday date of this person's last roster week. Null = still employed. */
  activeTo: string | null;
  /** Position within their block, used for row numbering (SPEC.md §7 "Row numbering"). */
  sortOrder: number;
  /** False for a long-term-leave row that prints without a row number (e.g. maternity, SPEC.md §16). */
  numbered: boolean;
}

/** A vacant seat: same block position as a Staff row, but no person. */
export interface VacantSeat {
  id: string;
  roomId: string;
  sortOrder: number;
}

export interface RoomHistoryEntry {
  staffId: string;
  roomId: string;
  /** ISO Monday date this room assignment starts applying from. */
  fromWeek: string;
  /** ISO Monday date the assignment ends (exclusive), or null if current. */
  toWeek: string | null;
}

export interface StaticHours {
  staffId: string;
  /** 1 = Monday ... 5 = Friday. */
  weekday: 1 | 2 | 3 | 4 | 5;
  start: string | null;
  end: string | null;
}

export type LeaveType = 'holiday' | 'maternity' | 'sick';

export interface LeaveEntry {
  id: string;
  staffId: string;
  type: LeaveType;
  fromDate: string; // ISO date
  toDate: string | null; // ISO date, null = open-ended (maternity only)
}

export type RosterEntryType = 'shift' | 'holiday' | 'maternity' | 'off' | 'blank';
export type RosterEntrySource = 'generated' | 'manual';

export interface RosterEntry {
  weekStart: string; // ISO Monday date
  staffId: string;
  date: string; // ISO date, Mon-Fri
  type: RosterEntryType;
  patternCode: ShiftPatternCode | null;
  start: string | null; // 24h "HH:mm"
  end: string | null;
  unpaidLunchMinutes: number;
  source: RosterEntrySource;
  note: string | null;
}

export type RosterWeekStatus = 'draft' | 'locked';

export interface RosterWeek {
  weekStart: string; // ISO Monday date
  status: RosterWeekStatus;
}

export interface FairnessLedgerEntry {
  staffId: string;
  weekStart: string;
  patternCode: ShiftPatternCode;
}

export interface DutyAssignment {
  weekStart: string;
  dutyId: string;
  staffIds: string[];
  text: string | null;
}

export type WarningSeverity = 'red' | 'amber' | 'info';

export interface RuleWarning {
  ruleId: string;
  severity: WarningSeverity;
  message: string;
  date?: string;
  staffId?: string;
}

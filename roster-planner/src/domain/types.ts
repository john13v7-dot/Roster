// © 2026 David Juste. All rights reserved. Proprietary and confidential.

import type { ShiftPatternCode } from '../config/creche.config';

export type StaffType = 'rotating' | 'paired_management' | 'manager' | 'static';

export interface Staff {
  id: string;
  name: string;
  type: StaffType;
  payrollIncluded: boolean;
  /** ISO Monday date this person's first roster week is/was. Null = always employed. */
  activeFrom: string | null;
  /**
   * ISO Monday date of this person's LAST roster week (they still appear
   * that week) — the week after is when their seat shows vacant
   * (SPEC.md §7 "Remove Staff"). Null = still employed.
   */
  activeTo: string | null;
  /**
   * Tiebreak/ordering key. For a person with no current room (Sue, or the
   * trailing management group) it also decides lead-vs-trailing position
   * (SPEC.md §7 "Row numbering"); for a person in a room it only
   * tiebreaks same-week room_history entries.
   */
  sortOrder: number;
  /** False for a long-term-leave row that prints without a row number (e.g. maternity, SPEC.md §16). */
  numbered: boolean;
}

/**
 * A person's room over time (SPEC.md §7 "Transfer": "store room history
 * per person, not just a current room"). Current room = the row with
 * toWeek null. No row at all = a roomless person (Sue, trailing
 * management group, or someone like Eirini with nowhere to return to).
 */
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

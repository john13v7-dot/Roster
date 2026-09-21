// © 2026 David Juste. All rights reserved. Proprietary and confidential.
//
// The fairness/rules engine: pure functions, no UI, no DB (SPEC.md §2).
// Evaluates rules R1-R10 (SPEC.md §5) for one roster week and returns the
// warnings to show in the Warnings panel (SPEC.md §3).
//
// Nothing here blocks saving — every violation is a warning, never an
// error, per SPEC.md §5 "Nothing blocks saving. The app warns; the
// manager decides."

import type { FloorId, ShiftPatternCode } from '../config/creche.config';
import { coverRules, floorBalanceRules, rooms as roomConfigs, shiftPatterns } from '../config/creche.config';
import { roomOccupantsForWeek } from '../domain/rosterLayout';
import type {
  FairnessLedgerEntry,
  LeaveEntry,
  RoomHistoryEntry,
  RosterEntry,
  RuleWarning,
  Staff,
} from '../domain/types';

const PATTERN_CODES: ShiftPatternCode[] = shiftPatterns.map((p) => p.code);

function red(ruleId: string, message: string, date?: string, staffId?: string): RuleWarning {
  return { ruleId, severity: 'red', message, date, staffId };
}
function amber(ruleId: string, message: string, date?: string, staffId?: string): RuleWarning {
  return { ruleId, severity: 'amber', message, date, staffId };
}
function info(ruleId: string, message: string, date?: string, staffId?: string): RuleWarning {
  return { ruleId, severity: 'info', message, date, staffId };
}

function entryFor(entriesByKey: Record<string, RosterEntry>, staffId: string, date: string): RosterEntry | undefined {
  return entriesByKey[`${staffId}|${date}`];
}

function isAway(entry: RosterEntry | undefined): boolean {
  return entry?.type === 'holiday' || entry?.type === 'maternity';
}

/** Staff whose entry for `date` is a shift starting/ending exactly at `time`. */
function peopleAtTime(
  staff: Staff[],
  entriesByKey: Record<string, RosterEntry>,
  date: string,
  field: 'start' | 'end',
  time: string,
): Staff[] {
  return staff.filter((s) => {
    const e = entryFor(entriesByKey, s.id, date);
    return e?.type === 'shift' && e[field] === time;
  });
}

/** Staff whose entry for `date` carries this shift pattern code. */
function peopleOnPattern(
  staff: Staff[],
  entriesByKey: Record<string, RosterEntry>,
  date: string,
  code: ShiftPatternCode,
): Staff[] {
  return staff.filter((s) => entryFor(entriesByKey, s.id, date)?.patternCode === code);
}

/**
 * Assigns a floor to every person in the group: their room's floor, or
 * their fixed floorOverride, or — for a genuine floater — whichever floor
 * currently has fewer people in this group so far (SPEC.md §5 "Shehnaz
 * and Priscilla are floaters: count them on whichever floor has fewer
 * people in that shift"). Deterministic: floaters are resolved in
 * sortOrder, ties go to ground.
 */
function assignFloors(people: Staff[], roomFloorByStaffId: Map<string, FloorId>): Map<string, FloorId> {
  const result = new Map<string, FloorId>();
  const floaters: Staff[] = [];
  let ground = 0;
  let first = 0;

  for (const s of people) {
    const floor = roomFloorByStaffId.get(s.id) ?? s.floorOverride ?? null;
    if (floor) {
      result.set(s.id, floor);
      if (floor === 'ground') ground++;
      else first++;
    } else {
      floaters.push(s);
    }
  }

  for (const s of [...floaters].sort((a, b) => a.sortOrder - b.sortOrder)) {
    const floor: FloorId = ground <= first ? 'ground' : 'first';
    result.set(s.id, floor);
    if (floor === 'ground') ground++;
    else first++;
  }

  return result;
}

function floorCounts(floors: Map<string, FloorId>): { ground: number; first: number } {
  let ground = 0;
  let first = 0;
  for (const f of floors.values()) {
    if (f === 'ground') ground++;
    else first++;
  }
  return { ground, first };
}

/** The pattern this rotating person worked most that week (ties: first seen). */
function majorityPattern(
  staffId: string,
  dates: string[],
  entriesByKey: Record<string, RosterEntry>,
): ShiftPatternCode | null {
  const counts = new Map<ShiftPatternCode, number>();
  for (const date of dates) {
    const code = entryFor(entriesByKey, staffId, date)?.patternCode;
    if (code) counts.set(code, (counts.get(code) ?? 0) + 1);
  }
  let best: ShiftPatternCode | null = null;
  let bestCount = 0;
  for (const [code, count] of counts) {
    if (count > bestCount) {
      best = code;
      bestCount = count;
    }
  }
  return best;
}

function previousWeekStart(weekStart: string): string {
  const d = new Date(`${weekStart}T00:00:00`);
  d.setDate(d.getDate() - 7);
  return d.toISOString().slice(0, 10);
}

export interface EvaluateWeekRulesInput {
  weekStart: string;
  dates: string[]; // Mon-Fri ISO dates
  staff: Staff[];
  roomHistory: RoomHistoryEntry[];
  /** This week's cells as actually shown (leave already merged in — getWeekRosterView). */
  entriesByKey: Record<string, RosterEntry>;
  leaveEntries: LeaveEntry[];
  /** All locked weeks' pattern history, for R9 (no-repeat) and R10 (fairness outlier). */
  fairnessLedger: FairnessLedgerEntry[];
}

export function evaluateWeekRules(input: EvaluateWeekRulesInput): RuleWarning[] {
  const { weekStart, dates, staff, roomHistory, entriesByKey, leaveEntries, fairnessLedger } = input;
  const warnings: RuleWarning[] = [];

  const pairedManagement = staff.filter((s) => s.type === 'paired_management');
  const roomStaffType = staff.filter((s) => s.type === 'rotating');
  const managers = staff.filter((s) => s.type === 'manager');

  const occupantsByRoom = roomOccupantsForWeek(staff, roomHistory, weekStart);
  const roomFloorByStaffId = new Map<string, FloorId>();
  for (const room of roomConfigs) {
    for (const s of occupantsByRoom.get(room.id) ?? []) {
      roomFloorByStaffId.set(s.id, room.floor);
    }
  }

  // R1 — opening cover, R2 — closing cover
  for (const date of dates) {
    const openers = peopleAtTime(staff, entriesByKey, date, 'start', coverRules.openingTime);
    const pairedOpeners = openers.filter((s) => pairedManagement.includes(s));
    const roomOpeners = openers.filter((s) => roomStaffType.includes(s));
    if (pairedOpeners.length < 1 || roomOpeners.length < coverRules.minRoomStaffInCover) {
      warnings.push(
        red(
          'R1',
          `Opening cover short on ${date}: ${pairedOpeners.length ? '' : 'no Jason/Shehnaz, '}${roomOpeners.length} of ${coverRules.minRoomStaffInCover} room staff starting at ${coverRules.openingTime}.`,
          date,
        ),
      );
    }

    const closers = peopleAtTime(staff, entriesByKey, date, 'end', coverRules.closingTime);
    const pairedClosers = closers.filter((s) => pairedManagement.includes(s));
    const managerClosers = closers.filter((s) => managers.includes(s));
    const roomClosers = closers.filter((s) => roomStaffType.includes(s));
    const hasManagementCover = pairedClosers.length >= 1 || managerClosers.length >= 1;
    if (!hasManagementCover || roomClosers.length < coverRules.minRoomStaffInCover) {
      warnings.push(
        red(
          'R2',
          `Closing cover short on ${date}: ${hasManagementCover ? '' : 'no Jason/Shehnaz or Priscilla, '}${roomClosers.length} of ${coverRules.minRoomStaffInCover} room staff finishing at ${coverRules.closingTime}.`,
          date,
        ),
      );
    }
  }

  // R3 — Jason/Shehnaz complementary starts
  if (pairedManagement.length === 2) {
    const [a, b] = pairedManagement;
    for (const date of dates) {
      const ea = entryFor(entriesByKey, a.id, date);
      const eb = entryFor(entriesByKey, b.id, date);
      const aAway = isAway(ea);
      const bAway = isAway(eb);
      if (aAway && !bAway && eb?.type === 'shift') {
        warnings.push(amber('R3', `${a.name} is away on ${date} — set ${b.name}'s start time by hand.`, date, b.id));
      } else if (bAway && !aAway && ea?.type === 'shift') {
        warnings.push(amber('R3', `${b.name} is away on ${date} — set ${a.name}'s start time by hand.`, date, a.id));
      } else if (!aAway && !bAway && ea?.type === 'shift' && eb?.type === 'shift') {
        const complementary =
          (ea.patternCode === 'S1' && eb.patternCode === 'S4') ||
          (ea.patternCode === 'S4' && eb.patternCode === 'S1');
        if (!complementary) {
          warnings.push(
            amber('R3', `${a.name} and ${b.name} aren't on complementary S1/S4 starts on ${date}.`, date),
          );
        }
      }
    }
  }

  // R4 — floor balance
  for (const date of dates) {
    const openers = peopleAtTime(staff, entriesByKey, date, 'start', coverRules.openingTime);
    if (openers.length > 0 && floorBalanceRules.redOnZeroFloorAtOpenOrClose) {
      const { ground, first } = floorCounts(assignFloors(openers, roomFloorByStaffId));
      if (ground === 0 || first === 0) {
        warnings.push(red('R4', `Opening on ${date} has nobody on the ${ground === 0 ? 'ground' : '1st'} floor.`, date));
      }
    }
    const closers = peopleAtTime(staff, entriesByKey, date, 'end', coverRules.closingTime);
    if (closers.length > 0 && floorBalanceRules.redOnZeroFloorAtOpenOrClose) {
      const { ground, first } = floorCounts(assignFloors(closers, roomFloorByStaffId));
      if (ground === 0 || first === 0) {
        warnings.push(red('R4', `Closing on ${date} has nobody on the ${ground === 0 ? 'ground' : '1st'} floor.`, date));
      }
    }
    for (const code of PATTERN_CODES) {
      const people = peopleOnPattern(staff, entriesByKey, date, code);
      if (people.length === 0) continue;
      const { ground, first } = floorCounts(assignFloors(people, roomFloorByStaffId));
      if (Math.abs(ground - first) > floorBalanceRules.maxFloorImbalancePerShift) {
        warnings.push(
          amber('R4', `${code} on ${date} is floor-imbalanced: ${ground} ground vs ${first} 1st floor.`, date),
        );
      }
    }
  }

  // R5 — vacant seats, R6 — room capacity (structural, not per-day)
  for (const room of roomConfigs) {
    const occupants = occupantsByRoom.get(room.id) ?? [];
    if (occupants.length < room.seats) {
      warnings.push(amber('R5', `${room.seats - occupants.length} vacant seat(s) in ${room.name}.`));
    } else if (occupants.length > room.seats) {
      warnings.push(amber('R6', `${room.name} has ${occupants.length} people for ${room.seats} seats.`));
    }
  }

  // R7 — nobody on leave has a shift (safety net; the merged view already
  // prevents this, see src/domain/leave.ts)
  for (const leave of leaveEntries) {
    for (const date of dates) {
      if (date < leave.fromDate) continue;
      if (leave.toDate !== null && date > leave.toDate) continue;
      const entry = entryFor(entriesByKey, leave.staffId, date);
      if (entry?.type === 'shift') {
        const name = staff.find((s) => s.id === leave.staffId)?.name ?? leave.staffId;
        warnings.push(red('R7', `${name} has a shift on ${date} while on leave.`, date, leave.staffId));
      }
    }
  }

  // R8 — one pattern per week for each rotating person; day-level
  // deviations are flagged as overrides (info only)
  for (const s of roomStaffType) {
    const majority = majorityPattern(s.id, dates, entriesByKey);
    if (!majority) continue;
    for (const date of dates) {
      const entry = entryFor(entriesByKey, s.id, date);
      if (entry?.type === 'shift' && entry.patternCode && entry.patternCode !== majority) {
        warnings.push(
          info('R8', `${s.name} is on ${entry.patternCode} on ${date}, an override of the week's ${majority}.`, date, s.id),
        );
      }
    }
  }

  // R9 — no repeat of the same pattern two weeks running
  const eligibleForFairness = staff.filter((s) => s.type === 'rotating' || s.type === 'paired_management');
  const prevWeek = previousWeekStart(weekStart);
  for (const s of eligibleForFairness) {
    const thisWeek = majorityPattern(s.id, dates, entriesByKey);
    const lastWeekLedger = fairnessLedger.find((f) => f.staffId === s.id && f.weekStart === prevWeek);
    if (thisWeek && lastWeekLedger && thisWeek === lastWeekLedger.patternCode) {
      warnings.push(amber('R9', `${s.name} is on ${thisWeek} again, same as last week.`, undefined, s.id));
    }
  }

  // R10 — fairness outlier: 2+ more of a pattern than the least-served peer
  for (const code of PATTERN_CODES) {
    const counts = new Map<string, number>();
    for (const s of eligibleForFairness) counts.set(s.id, 0);
    for (const entry of fairnessLedger) {
      if (entry.patternCode === code && counts.has(entry.staffId)) {
        counts.set(entry.staffId, (counts.get(entry.staffId) ?? 0) + 1);
      }
    }
    const values = [...counts.values()];
    if (values.length < 2) continue;
    const min = Math.min(...values);
    for (const s of eligibleForFairness) {
      const count = counts.get(s.id) ?? 0;
      if (count - min >= 2) {
        warnings.push(amber('R10', `${s.name} has had ${code} ${count} times, ${count - min} more than the least-served colleague.`, undefined, s.id));
      }
    }
  }

  return warnings;
}

export interface DayCoverage {
  date: string;
  openingOk: boolean;
  closingOk: boolean;
  groundCount: number;
  firstCount: number;
}

/**
 * The Roster screen's coverage strip (SPEC.md §3): for each day, whether
 * opening/closing cover (R1/R2) is met, and the ground/1st floor
 * headcount for everyone working that day. Simplified from "per shift" to
 * one total per day, to fit a phone-width strip.
 */
export function computeCoverageStrip(
  input: Pick<EvaluateWeekRulesInput, 'dates' | 'staff' | 'roomHistory' | 'weekStart' | 'entriesByKey'>,
): DayCoverage[] {
  const { dates, staff, roomHistory, weekStart, entriesByKey } = input;
  const pairedManagement = staff.filter((s) => s.type === 'paired_management');
  const roomStaffType = staff.filter((s) => s.type === 'rotating');
  const managers = staff.filter((s) => s.type === 'manager');

  const occupantsByRoom = roomOccupantsForWeek(staff, roomHistory, weekStart);
  const roomFloorByStaffId = new Map<string, FloorId>();
  for (const room of roomConfigs) {
    for (const s of occupantsByRoom.get(room.id) ?? []) {
      roomFloorByStaffId.set(s.id, room.floor);
    }
  }

  return dates.map((date) => {
    const openers = peopleAtTime(staff, entriesByKey, date, 'start', coverRules.openingTime);
    const closers = peopleAtTime(staff, entriesByKey, date, 'end', coverRules.closingTime);
    const openingOk =
      openers.filter((s) => pairedManagement.includes(s)).length >= 1 &&
      openers.filter((s) => roomStaffType.includes(s)).length >= coverRules.minRoomStaffInCover;
    const closingOk =
      (closers.filter((s) => pairedManagement.includes(s)).length >= 1 ||
        closers.filter((s) => managers.includes(s)).length >= 1) &&
      closers.filter((s) => roomStaffType.includes(s)).length >= coverRules.minRoomStaffInCover;

    const workingToday = staff.filter((s) => entryFor(entriesByKey, s.id, date)?.type === 'shift');
    const { ground, first } = floorCounts(assignFloors(workingToday, roomFloorByStaffId));

    return { date, openingOk, closingOk, groundCount: ground, firstCount: first };
  });
}

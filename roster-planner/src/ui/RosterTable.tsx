// © 2026 David Juste. All rights reserved. Proprietary and confidential.

import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { breakLabel } from '../config/creche.config';
import { patternColors, statusColors } from '../config/theme';
import type { RosterRow } from '../domain/rosterLayout';
import { rosterCellContent } from '../domain/rosterCell';
import { weekdayLabels } from '../domain/week';
import type { RosterEntry } from '../domain/types';

const ROW_HEIGHT = 44;
const NAME_COL_WIDTH = 150;
const NO_COL_WIDTH = 36;
const DAY_COL_WIDTH = 108;
const BREAK_COL_WIDTH = 72;
const NOTES_COL_WIDTH = 90;

interface Props {
  rows: RosterRow[];
  dates: string[]; // 5 ISO dates, Mon..Fri
  entriesByKey: Record<string, RosterEntry>;
  onCellPress?: (staffId: string, date: string) => void;
}

const statusBg: Record<'holiday' | 'maternity' | 'off', string> = {
  holiday: statusColors.holiday,
  maternity: statusColors.maternityLeave,
  off: statusColors.off,
};
const statusFg: Partial<Record<'holiday' | 'maternity' | 'off', string>> = {
  holiday: '#fff',
  maternity: '#fff',
};

function cellForEntry(entry: RosterEntry | undefined): { text: string; bg?: string; fg?: string } {
  const { text, status } = rosterCellContent(entry);
  if (status) return { text, bg: statusBg[status], fg: statusFg[status] };
  if (entry?.type === 'shift' && entry.patternCode) {
    return { text, bg: `${patternColors[entry.patternCode]}33` };
  }
  return { text };
}

export function RosterTable({ rows, dates, entriesByKey }: Props) {
  return (
    <ScrollView style={styles.verticalScroll}>
      <View style={styles.rowContainer}>
        <View style={[styles.leftCol, { width: NO_COL_WIDTH + NAME_COL_WIDTH }]}>
          <View style={[styles.headerCell, { flexDirection: 'row' }]}>
            <Text style={[styles.headerText, { width: NO_COL_WIDTH }]}>No.</Text>
            <Text style={[styles.headerText, { width: NAME_COL_WIDTH }]}>Name</Text>
          </View>
          {rows.map((row) => (
            <View key={row.key} style={[styles.dataRow, { flexDirection: 'row' }]}>
              <Text style={[styles.cellText, { width: NO_COL_WIDTH }]}>{row.rowNumber ?? ''}</Text>
              <Text style={[styles.cellText, styles.nameText, { width: NAME_COL_WIDTH }]} numberOfLines={1}>
                {row.kind === 'staff' ? row.staff.name : ''}
              </Text>
            </View>
          ))}
        </View>

        <ScrollView horizontal style={styles.horizontalScroll}>
          <View>
            <View style={[styles.headerCell, { flexDirection: 'row' }]}>
              {weekdayLabels.map((label) => (
                <Text key={label} style={[styles.headerText, { width: DAY_COL_WIDTH }]}>
                  {label}
                </Text>
              ))}
              <Text style={[styles.headerText, { width: BREAK_COL_WIDTH }]}>Break</Text>
              <Text style={[styles.headerText, { width: NOTES_COL_WIDTH }]}> </Text>
            </View>
            {rows.map((row) => {
              const hasBreak = row.kind === 'staff' || row.kind === 'vacant';
              return (
                <View key={row.key} style={[styles.dataRow, { flexDirection: 'row' }]}>
                  {dates.map((date) => {
                    const staffId = row.kind === 'staff' ? row.staff.id : null;
                    const entry = staffId ? entriesByKey[`${staffId}|${date}`] : undefined;
                    const cell = cellForEntry(entry);
                    return (
                      <View
                        key={date}
                        style={[styles.dayCell, { width: DAY_COL_WIDTH, backgroundColor: cell.bg }]}
                      >
                        <Text style={[styles.cellText, cell.fg ? { color: cell.fg } : null]} numberOfLines={1}>
                          {cell.text}
                        </Text>
                      </View>
                    );
                  })}
                  <View style={[styles.dayCell, { width: BREAK_COL_WIDTH }]}>
                    <Text style={styles.cellText}>{hasBreak ? breakLabel : ''}</Text>
                  </View>
                  <View style={[styles.dayCell, { width: NOTES_COL_WIDTH }]} />
                </View>
              );
            })}
          </View>
        </ScrollView>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  verticalScroll: { flex: 1 },
  rowContainer: { flexDirection: 'row' },
  leftCol: { borderRightWidth: 1, borderRightColor: '#CBD5E0' },
  horizontalScroll: { flex: 1 },
  headerCell: {
    backgroundColor: '#1F4E79',
    height: ROW_HEIGHT,
    alignItems: 'center',
  },
  headerText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 13,
    textAlign: 'center',
    paddingHorizontal: 4,
  },
  dataRow: {
    height: ROW_HEIGHT,
    alignItems: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#CBD5E0',
  },
  dayCell: {
    height: ROW_HEIGHT,
    alignItems: 'center',
    justifyContent: 'center',
    borderRightWidth: StyleSheet.hairlineWidth,
    borderRightColor: '#E2E8F0',
  },
  cellText: {
    fontSize: 13,
    textAlign: 'center',
  },
  nameText: {
    textAlign: 'left',
    paddingLeft: 6,
  },
});

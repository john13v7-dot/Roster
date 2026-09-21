// © 2026 David Juste. All rights reserved. Proprietary and confidential.
//
// Builds the roster print HTML, rendered to PDF by expo-print (SPEC.md §2,
// §9). Same column layout and cell text as the Excel export, so both show
// identical content.

import { breakLabel } from '../config/creche.config';
import { statusColors } from '../config/theme';
import { rosterCellContent } from '../domain/rosterCell';
import type { RosterRow } from '../domain/rosterLayout';
import { formatWeekRange } from '../domain/week';
import type { RosterEntry } from '../domain/types';

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

const statusStyle: Record<'holiday' | 'maternity' | 'off', string> = {
  holiday: `background:${statusColors.holiday}; color:#fff;`,
  maternity: `background:${statusColors.maternityLeave}; color:#fff;`,
  off: `background:${statusColors.off};`,
};

export function buildRosterHtml(
  rows: RosterRow[],
  dates: string[],
  entriesByKey: Record<string, RosterEntry>,
  weekStart: string,
): string {
  const bodyRows = rows
    .map((row) => {
      const name = row.kind === 'staff' ? row.staff.name : '';
      const hasBreak = row.kind === 'staff' || row.kind === 'vacant';
      const dayCells = dates
        .map((date) => {
          const staffId = row.kind === 'staff' ? row.staff.id : null;
          const entry = staffId ? entriesByKey[`${staffId}|${date}`] : undefined;
          const { text, status } = rosterCellContent(entry);
          const style = status ? statusStyle[status] : '';
          return `<td style="${style}">${escapeHtml(text)}</td>`;
        })
        .join('');
      return `<tr>
        <td class="no">${row.rowNumber ?? ''}</td>
        <td class="name">${escapeHtml(name)}</td>
        ${dayCells}
        <td class="break">${hasBreak ? breakLabel : ''}</td>
        <td class="notes"></td>
      </tr>`;
    })
    .join('\n');

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<style>
  @page { size: A4 landscape; margin: 12mm; }
  body { font-family: 'Times New Roman', serif; margin: 0; }
  h1 { color: #E53E3E; font-size: 26px; margin: 0 0 4px 0; }
  .date-range { font-weight: bold; font-size: 16px; margin: 0 0 16px 0; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  td, th { border: 1px solid #999; padding: 4px 6px; text-align: center; }
  td.name { text-align: left; }
</style>
</head>
<body>
  <h1>STAFF ROSTER</h1>
  <p class="date-range">${escapeHtml(formatWeekRange(weekStart))}</p>
  <table>
    <tbody>
      ${bodyRows}
    </tbody>
  </table>
</body>
</html>`;
}

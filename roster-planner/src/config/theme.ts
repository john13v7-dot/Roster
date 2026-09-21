// © 2026 David Juste. All rights reserved. Proprietary and confidential.
//
// Brand and on-screen colours (SPEC.md §19). Printed Excel/PDF layouts do
// NOT use this file — they match the reference sheets exactly (§9).

export const brandColors = {
  blue: '#1F4E79',
  blueGradientStart: '#2C6FAE',
  blueGradientEnd: '#173E66',
  sun: '#F6C945',
} as const;

/** On-screen colour per shift pattern code. Printed exports stay black/white. */
export const patternColors: Record<'S1' | 'S2' | 'S3' | 'S4', string> = {
  S1: '#F6AD55',
  S2: '#68D391',
  S3: '#63B3ED',
  S4: '#F687B3',
};

/** On-screen and print colours for leave / off cells (SPEC.md §9). */
export const statusColors = {
  holiday: '#E53E3E',
  maternityLeave: '#22543D',
  off: '#C6F6D5',
};

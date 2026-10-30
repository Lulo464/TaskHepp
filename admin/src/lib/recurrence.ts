import i18n from '../i18n';
import type { Recurrence } from './types';

export type Preset = 'none' | 'daily' | 'workdays' | 'weekly' | 'biweekly' | 'monthly' | 'yearly' | 'custom';
export const PRESETS: Preset[] = ['none', 'daily', 'workdays', 'weekly', 'biweekly', 'monthly', 'yearly', 'custom'];
const WORKDAYS = [1, 2, 3, 4, 5];

/** 1 = Monday … 7 = Sunday of an ISO date (today without one). */
export const weekdayOf = (iso: string | null) => {
  const [y, m, d] = (iso ?? new Date().toLocaleDateString('sv-SE')).split('-').map(Number);
  return new Date(y, m - 1, d).getDay() || 7;
};

const same = (a: number[] = [], b: number[] = []) => a.length === b.length && [...a].sort().every((x, i) => x === [...b].sort()[i]);

export function presetOf(r: Recurrence | null): Preset {
  if (!r) return 'none';
  if (r.fromDone || r.monthDay) return 'custom';
  const days = r.weekdays ?? [];
  if (r.unit === 'day' && r.every === 1) return 'daily';
  if (r.unit === 'week' && r.every === 1 && same(days, WORKDAYS)) return 'workdays';
  if (r.unit === 'week' && days.length <= 1) return r.every === 1 ? 'weekly' : r.every === 2 ? 'biweekly' : 'custom';
  if (r.unit === 'month' && r.every === 1) return 'monthly';
  if (r.unit === 'year' && r.every === 1) return 'yearly';
  return 'custom';
}

/** The recurrence for a preset; weekly ones on the weekday of the due date. */
export function fromPreset(p: Preset, due: string | null, current: Recurrence | null): Recurrence | null {
  const day = [weekdayOf(due)];
  switch (p) {
    case 'none': return null;
    case 'daily': return { every: 1, unit: 'day' };
    case 'workdays': return { every: 1, unit: 'week', weekdays: WORKDAYS };
    case 'weekly': return { every: 1, unit: 'week', weekdays: day };
    case 'biweekly': return { every: 2, unit: 'week', weekdays: day };
    case 'monthly': return { every: 1, unit: 'month' };
    case 'yearly': return { every: 1, unit: 'year' };
    case 'custom': return current ?? { every: 1, unit: 'week', weekdays: day };
  }
}

const dayNames = (days: number[]) =>
  [...days].sort((a, b) => a - b).map(d => new Date(2024, 0, d).toLocaleDateString(i18n.language, { weekday: 'short' }).replace('.', '')).join(', ');

/** "Jeden Mo, Do", "Alle 3 Monate nach Erledigung" … */
export function describeRecurrence(r: Recurrence): string {
  const t = i18n.t.bind(i18n);
  const days = r.weekdays ?? [];
  let text: string;
  if (r.unit === 'week' && r.every === 1 && same(days, WORKDAYS)) text = t('repeat.text.workdays');
  else if (r.unit === 'week' && days.length) text = r.every === 1 ? t('repeat.text.onDays', { days: dayNames(days) }) : t('repeat.text.everyWeeksOn', { count: r.every, days: dayNames(days) });
  else text = t(`repeat.text.${r.unit}`, { count: r.every });
  if (r.unit === 'month' && r.monthDay) text += ` ${t('repeat.text.onMonthDay', { day: r.monthDay })}`;
  if (r.fromDone) text += ` ${t('repeat.text.fromDone')}`;
  return text;
}

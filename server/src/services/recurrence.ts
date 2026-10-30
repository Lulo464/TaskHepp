import { z } from 'zod';

/**
 * How a ticket repeats. `weekdays` (1 = Monday … 7 = Sunday) picks days within the weeks, `monthDay` keeps the day
 * of the month (31 → the month's last day), `fromDone` counts from the day it was done instead of the due date.
 */
export const recurrenceSchema = z.object({
  every: z.number().int().min(1).max(366),
  unit: z.enum(['day', 'week', 'month', 'year']),
  weekdays: z.array(z.number().int().min(1).max(7)).max(7).optional(),
  monthDay: z.number().int().min(1).max(31).optional(),
  fromDone: z.boolean().optional(),
});
export type Recurrence = z.infer<typeof recurrenceSchema>;

const MAX_STEPS = 1000;
const toUtc = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
};
const toIso = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (iso: string, n: number) => {
  const d = toUtc(iso);
  d.setUTCDate(d.getUTCDate() + n);
  return toIso(d);
};
/** 1 = Monday … 7 = Sunday */
const weekday = (iso: string) => toUtc(iso).getUTCDay() || 7;
const daysIn = (y: number, m: number) => new Date(Date.UTC(y, m + 1, 0)).getUTCDate();

/** The date after `base` on which the ticket comes up again. */
export function nextDate(r: Recurrence, base: string): string {
  switch (r.unit) {
    case 'day':
      return addDays(base, r.every);
    case 'week': {
      const days = [...new Set(r.weekdays ?? [])].sort((a, b) => a - b);
      if (!days.length) return addDays(base, 7 * r.every);
      const today = weekday(base);
      const later = days.find(d => d > today);
      if (later) return addDays(base, later - today); // still this week
      return addDays(base, 7 * r.every - (today - 1) + (days[0] - 1)); // first chosen day, `every` weeks on
    }
    case 'month':
    case 'year': {
      const d = toUtc(base);
      const months = r.unit === 'month' ? r.every : 12 * r.every;
      const total = d.getUTCMonth() + months;
      const y = d.getUTCFullYear() + Math.floor(total / 12);
      const m = total % 12;
      const day = Math.min(r.monthDay ?? d.getUTCDate(), daysIn(y, m));
      return toIso(new Date(Date.UTC(y, m, day)));
    }
  }
}

/**
 * Due date of the next ticket in the series. From the due date the series keeps its rhythm, skipping dates that are
 * already past when a ticket was done late; with `fromDone` (or without a due date) it counts from today.
 */
export function nextDue(r: Recurrence, due: string | null, today: string): string {
  if (r.fromDone || !due) return nextDate(r, today);
  let next = nextDate(r, due);
  for (let i = 0; next <= today && i < MAX_STEPS; i++) next = nextDate(r, next);
  return next;
}

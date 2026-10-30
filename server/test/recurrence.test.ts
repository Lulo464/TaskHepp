import { describe, expect, it } from 'vitest';
import { nextDate, nextDue } from '../src/services/recurrence.js';

describe('nextDate', () => {
  it('steps days, weeks, months and years', () => {
    expect(nextDate({ every: 1, unit: 'day' }, '2026-10-31')).toBe('2026-11-01');
    expect(nextDate({ every: 3, unit: 'day' }, '2026-12-30')).toBe('2027-01-02');
    expect(nextDate({ every: 2, unit: 'week' }, '2026-10-30')).toBe('2026-11-13');
    expect(nextDate({ every: 1, unit: 'year' }, '2028-02-29')).toBe('2029-02-28');
    expect(nextDate({ every: 3, unit: 'month' }, '2026-11-15')).toBe('2027-02-15');
  });

  it('picks the chosen weekdays', () => {
    const monWed = { every: 1, unit: 'week' as const, weekdays: [3, 1] };
    expect(nextDate(monWed, '2026-11-02')).toBe('2026-11-04'); // Mon → Wed
    expect(nextDate(monWed, '2026-11-04')).toBe('2026-11-09'); // Wed → next Mon
    expect(nextDate(monWed, '2026-11-07')).toBe('2026-11-09'); // Sat → Mon
    expect(nextDate({ every: 2, unit: 'week', weekdays: [1] }, '2026-11-02')).toBe('2026-11-16');
    expect(nextDate({ every: 1, unit: 'week', weekdays: [1, 2, 3, 4, 5] }, '2026-10-30')).toBe('2026-11-02'); // Fri → Mon
  });

  it('keeps the day of the month through short months', () => {
    const r = { every: 1, unit: 'month' as const, monthDay: 31 };
    expect(nextDate(r, '2027-01-31')).toBe('2027-02-28');
    expect(nextDate(r, '2027-02-28')).toBe('2027-03-31');
  });
});

describe('nextDue', () => {
  it('keeps the rhythm and skips dates that already passed', () => {
    const weekly = { every: 1, unit: 'week' as const, weekdays: [1] };
    expect(nextDue(weekly, '2026-11-02', '2026-11-01')).toBe('2026-11-09'); // done early
    expect(nextDue(weekly, '2026-10-12', '2026-10-30')).toBe('2026-11-02'); // done three weeks late
  });

  it('counts from today when asked or without a due date', () => {
    expect(nextDue({ every: 3, unit: 'month', fromDone: true }, '2026-06-01', '2026-10-30')).toBe('2027-01-30');
    expect(nextDue({ every: 2, unit: 'day' }, null, '2026-10-30')).toBe('2026-11-01');
  });
});

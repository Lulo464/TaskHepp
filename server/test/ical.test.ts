import { describe, expect, it } from 'vitest';
import { foldLine, icalCalendar, icalText } from '../src/lib/ical.js';
import { rruleOf } from '../src/routes/feed.js';

describe('ical', () => {
  it('escapes text and folds long lines at 75 octets without splitting characters', () => {
    expect(icalText('a;b,c\\d\nneu')).toBe('a\;b\\,c\\\\d\\nneu');
    const folded = foldLine(`SUMMARY:${'ä'.repeat(60)}`);
    for (const line of folded.split('\r\n')) expect(Buffer.byteLength(line)).toBeLessThanOrEqual(75);
    expect(folded.split('\r\n').map((l, i) => (i ? l.slice(1) : l)).join('')).toBe(`SUMMARY:${'ä'.repeat(60)}`);
  });

  it('writes all-day and timed events', () => {
    const cal = icalCalendar('Tasklog', [
      { uid: 'ticket-1@x', stamp: new Date(Date.UTC(2026, 9, 30, 8)), summary: 'Müll, raus', date: '2026-12-31', time: null, tz: 'Europe/Berlin' },
      { uid: 'ticket-2@x', stamp: new Date(Date.UTC(2026, 9, 30, 8)), summary: 'Arzt', date: '2026-11-05', time: '10:30', tz: 'Europe/Berlin' },
    ]);
    expect(cal).toContain('DTSTART;VALUE=DATE:20261231\r\nDTEND;VALUE=DATE:20270101');
    expect(cal).toContain('SUMMARY:Müll\\, raus');
    expect(cal).toContain('DTSTART;TZID=Europe/Berlin:20261105T103000\r\nDURATION:PT30M');
    expect(cal).toContain('DTSTAMP:20261030T080000Z');
    expect(cal.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true);
    expect(cal.endsWith('END:VCALENDAR\r\n')).toBe(true);
  });

  it('turns a series into an RRULE', () => {
    expect(rruleOf({ every: 1, unit: 'week', weekdays: [4, 1] }, '2026-11-02')).toBe('FREQ=WEEKLY;BYDAY=MO,TH');
    expect(rruleOf({ every: 2, unit: 'day' }, '2026-11-02')).toBe('FREQ=DAILY;INTERVAL=2');
    expect(rruleOf({ every: 1, unit: 'month' }, '2026-11-15')).toBe('FREQ=MONTHLY;BYMONTHDAY=15');
    expect(rruleOf({ every: 1, unit: 'month', monthDay: 31 }, '2026-10-31')).toBe('FREQ=MONTHLY;BYMONTHDAY=28,29,30,31;BYSETPOS=-1');
    expect(rruleOf({ every: 1, unit: 'year' }, '2026-11-15')).toBe('FREQ=YEARLY');
    expect(rruleOf({ every: 3, unit: 'month', fromDone: true }, '2026-11-15')).toBeNull();
    expect(rruleOf(null, '2026-11-15')).toBeNull();
  });
});

// Minimal iCalendar (RFC 5545) writer for the ticket feed.

/** Text value: backslash, semicolon, comma and line breaks escaped. */
export const icalText = (s: string) => s.replace(/\\/g, '\\\\').replace(/;/g, '\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');

/** Lines longer than 75 octets continue on the next line after a space; UTF-8 characters are never split. */
export function foldLine(line: string): string {
  const out: string[] = [];
  let current = '';
  let bytes = 0;
  for (const ch of line) {
    const size = Buffer.byteLength(ch);
    if (bytes + size > (out.length ? 74 : 75)) {
      out.push(current);
      current = '';
      bytes = 0;
    }
    current += ch;
    bytes += size;
  }
  out.push(current);
  return out.join('\r\n ');
}

/** 2026-11-05 → 20261105 */
export const icalDate = (iso: string) => iso.replaceAll('-', '');
/** A JS date as UTC: 20261105T091500Z */
export const icalUtc = (d: Date) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');

export interface IcalEvent {
  uid: string;
  stamp: Date;
  summary: string;
  description?: string;
  url?: string;
  categories?: string;
  /** All-day: the date. Timed: date and 'HH:MM' in `tz`. */
  date: string;
  time: string | null;
  tz: string;
  minutes?: number;
  /** RRULE value, e.g. FREQ=WEEKLY;BYDAY=MO */
  rrule?: string | null;
}

const nextDay = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
};

export function icalCalendar(name: string, events: IcalEvent[]): string {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Tasklog//Tickets//DE',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${icalText(name)}`,
    'REFRESH-INTERVAL;VALUE=DURATION:PT15M',
    'X-PUBLISHED-TTL:PT15M',
  ];
  for (const e of events) {
    lines.push('BEGIN:VEVENT', `UID:${e.uid}`, `DTSTAMP:${icalUtc(e.stamp)}`, `LAST-MODIFIED:${icalUtc(e.stamp)}`);
    if (e.time) {
      lines.push(`DTSTART;TZID=${e.tz}:${icalDate(e.date)}T${e.time.replace(':', '')}00`, `DURATION:PT${e.minutes ?? 30}M`);
    } else {
      lines.push(`DTSTART;VALUE=DATE:${icalDate(e.date)}`, `DTEND;VALUE=DATE:${icalDate(nextDay(e.date))}`, 'TRANSP:TRANSPARENT');
    }
    if (e.rrule) lines.push(`RRULE:${e.rrule}`);
    lines.push(`SUMMARY:${icalText(e.summary)}`);
    if (e.description) lines.push(`DESCRIPTION:${icalText(e.description)}`);
    if (e.url) lines.push(`URL:${e.url}`);
    if (e.categories) lines.push(`CATEGORIES:${icalText(e.categories)}`);
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.map(foldLine).join('\r\n') + '\r\n';
}

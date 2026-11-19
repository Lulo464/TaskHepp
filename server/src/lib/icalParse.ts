// Reading the VEVENT a calendar app sends (CalDAV PUT). Only what a ticket needs: uid, title, description and start.

export interface ParsedStart {
  /** "2030-07-20" */
  date: string;
  /** "07:00", null for an all-day event */
  time: string | null;
  /** How the time is meant: in UTC (…Z), in a named zone (TZID=…) or as local time without a zone. */
  zone: 'utc' | 'floating' | { tzid: string };
}

export interface ParsedEvent {
  component: string;
  uid: string | null;
  summary: string;
  description: string;
  start: ParsedStart | null;
}

/** Continuation lines (starting with a space or tab) belong to the line before. */
const unfold = (ics: string) => ics.replace(/\r\n/g, '\n').replace(/\n[ \t]/g, '').split('\n');

/** \n, \, and \; back to what they stand for. */
export const unescapeText = (s: string) => s.replace(/\\(.)/g, (_, c: string) => (c === 'n' || c === 'N' ? '\n' : c));

/** "DTSTART;TZID=Europe/Berlin:20300720T070000" → name, params, value. */
function splitLine(line: string) {
  const colon = (() => {
    // The first colon outside a quoted parameter value.
    let quoted = false;
    for (let i = 0; i < line.length; i++) {
      if (line[i] === '"') quoted = !quoted;
      else if (line[i] === ':' && !quoted) return i;
    }
    return -1;
  })();
  if (colon < 0) return null;
  const [name, ...params] = line.slice(0, colon).split(';');
  const map: Record<string, string> = {};
  for (const p of params) {
    const eq = p.indexOf('=');
    if (eq > 0) map[p.slice(0, eq).toUpperCase()] = p.slice(eq + 1).replace(/^"|"$/g, '');
  }
  return { name: name.toUpperCase(), params: map, value: line.slice(colon + 1) };
}

export function parseStart(value: string, params: Record<string, string>): ParsedStart | null {
  const m = value.trim().match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/);
  if (!m) return null;
  const date = `${m[1]}-${m[2]}-${m[3]}`;
  if (!m[4] || params.VALUE === 'DATE') return { date, time: null, zone: 'floating' };
  const time = `${m[4]}:${m[5]}`;
  if (m[7]) return { date, time, zone: 'utc' };
  return { date, time, zone: params.TZID ? { tzid: params.TZID } : 'floating' };
}

/** The first VEVENT (or other component) of a calendar object. */
export function parseEvent(ics: string): ParsedEvent | null {
  const lines = unfold(ics);
  let depth = 0;
  let inside: string | null = null;
  const found: ParsedEvent = { component: '', uid: null, summary: '', description: '', start: null };
  for (const raw of lines) {
    const line = splitLine(raw);
    if (!line) continue;
    if (line.name === 'BEGIN') {
      depth++;
      // Components directly in VCALENDAR; VALARM and the like inside them are skipped.
      if (!inside && depth === 2 && line.value.toUpperCase() !== 'VTIMEZONE') { inside = line.value.toUpperCase(); found.component = inside; }
      continue;
    }
    if (line.name === 'END') {
      if (inside && depth === 2 && line.value.toUpperCase() === inside) return found;
      depth--;
      continue;
    }
    if (!inside || depth !== 2) continue;
    if (line.name === 'UID') found.uid = line.value.trim();
    else if (line.name === 'SUMMARY') found.summary = unescapeText(line.value).trim();
    else if (line.name === 'DESCRIPTION') found.description = unescapeText(line.value).trim();
    else if (line.name === 'DTSTART') found.start = parseStart(line.value, line.params);
  }
  return found.component ? found : null;
}

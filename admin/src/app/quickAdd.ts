// Quick add: turns free text — typed, pasted or shared from WhatsApp — into tickets with a due date and time.

import type { Recurrence } from '../lib/types';

export interface Quick {
  /** The text without the date and time words. */
  title: string;
  due: string | null;
  dueTime: string | null;
  /** "jeden Montag", "alle 3 Monate" … */
  repeat: Recurrence | null;
}

export interface Message {
  sender: string | null;
  text: string;
}

const L = '\\p{L}';
const WEEKDAY = 'montag|dienstag|mittwoch|donnerstag|freitag|samstag|sonnabend|sonntag';
const WEEKDAY_SHORT = 'mo|di|mi|do|fr|sa|so';
const DAY_INDEX: Record<string, number> = {
  sonntag: 0, montag: 1, dienstag: 2, mittwoch: 3, donnerstag: 4, freitag: 5, samstag: 6, sonnabend: 6,
  so: 0, mo: 1, di: 2, mi: 3, do: 4, fr: 5, sa: 6,
};
const MONTHS = ['jan', 'feb', 'mär', 'apr', 'mai', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dez'];
const MONTH = 'januar|jan|februar|feb|märz|maerz|mär|mar|april|apr|mai|juni|jun|juli|jul|august|aug|september|sept|sep|oktober|okt|november|nov|dezember|dez';
/** "am", "bis", "ab", "zum", "bis zum" … in front of a date, removed together with it. */
const PREFIX = `(?:(?:bis\\s+zum|bis|am|ab|zum|für)\\s+)?`;
/** An optional weekday right before a date ("Do, 5.11."), removed together with it. */
const DAY_BEFORE = `(?:(?:${WEEKDAY}|(?:${WEEKDAY_SHORT})\\.?),?\\s+)?`;
const NUMBERS: Record<string, number> = { einem: 1, einer: 1, eine: 1, zwei: 2, drei: 3, vier: 4, fünf: 5 };

const pad = (n: number) => String(n).padStart(2, '0');
const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);

/** A real calendar date; without a year the next one from today on. */
function makeDate(day: number, month: number, year: number | null, now: Date): Date | null {
  const y = year === null ? now.getFullYear() : year < 100 ? 2000 + year : year;
  const d = new Date(y, month - 1, day);
  if (d.getMonth() !== month - 1 || d.getDate() !== day) return null;
  if (year === null && d < addDays(now, 0)) d.setFullYear(y + 1);
  return d;
}

type Rule = { re: RegExp; date?: (m: RegExpExecArray, now: Date) => Date | null; time?: (m: RegExpExecArray) => string | null };

const DATE_RULES: Rule[] = [
  // 2026-11-05
  { re: new RegExp(`${PREFIX}${DAY_BEFORE}(?<!\\d)(\\d{4})-(\\d{2})-(\\d{2})(?!\\d)`, 'giu'), date: m => makeDate(+m[3], +m[2], +m[1], new Date(0)) },
  // 5.11. / 05.11.2026 / 5.11.26 / 5.11 2026
  { re: new RegExp(`${PREFIX}${DAY_BEFORE}(?<![\\d.])(\\d{1,2})\\.(\\d{1,2})\\.(?:\\s?(\\d{4}|\\d{2})(?![\\d.:]))?(?![\\d])`, 'giu'), date: (m, now) => makeDate(+m[1], +m[2], m[3] ? +m[3] : null, now) },
  // 5. November / 5 Nov 2026
  {
    re: new RegExp(`${PREFIX}${DAY_BEFORE}(?<!\\d)(\\d{1,2})\\.?\\s*(${MONTH})\\.?(?:\\s+(\\d{4}))?(?![${L}])`, 'giu'),
    date: (m, now) => makeDate(+m[1], MONTHS.findIndex(x => m[2].toLowerCase().replace('ae', 'ä').replace(/^mar$/, 'mär').startsWith(x)) + 1, m[3] ? +m[3] : null, now),
  },
  // heute / morgen / übermorgen — but not "Guten Morgen"
  {
    re: new RegExp(`(?<![${L}])(?<!guten\\s)${PREFIX}(übermorgen|morgen|heute)(?![${L}])`, 'giu'),
    date: (m, now) => addDays(now, { heute: 0, morgen: 1, übermorgen: 2 }[m[1].toLowerCase()] ?? 0),
  },
  // in 3 Tagen / in einer Woche / in zwei Wochen
  {
    re: new RegExp(`(?<![${L}])in\\s+(\\d{1,2}|einem|einer|eine|zwei|drei|vier|fünf)\\s+(tag|tagen|woche|wochen)(?![${L}])`, 'giu'),
    date: (m, now) => {
      const n = /^\d+$/.test(m[1]) ? +m[1] : NUMBERS[m[1].toLowerCase()];
      return addDays(now, m[2].toLowerCase().startsWith('woche') ? n * 7 : n);
    },
  },
  // nächste Woche
  { re: new RegExp(`(?<![${L}])(?:nächste|kommende)n?\\s+woche(?![${L}])`, 'giu'), date: (_m, now) => addDays(now, 7) },
  // (am / nächsten) Donnerstag, am Do, Do. 10 Uhr — "so" and "do" are ordinary words too, so short names need "am"
  // in front or a dot and a time after them ("Ist das so." stays text)
  {
    re: new RegExp(`(?<![${L}])((?:am|ab|bis)\\s+)?(?:(?:nächsten|kommenden|diesen)\\s+)?(${WEEKDAY}|${WEEKDAY_SHORT})(\\.)?(?![${L}])`, 'giu'),
    date: (m, now) => {
      const name = m[2].toLowerCase();
      if (name.length === 2 && !m[1] && !(m[3] && /^\s*\d/.test(m.input.slice(m.index + m[0].length)))) return null;
      const diff = (DAY_INDEX[name] - now.getDay() + 7) % 7 || 7; // the next one, not today
      return addDays(now, diff);
    },
  },
];

const TIME_RULES: Rule[] = [
  // 10:30 (Uhr), 10.30 Uhr, um 10.30
  { re: new RegExp(`(?<![\\d:.])(?:(?:um|ab|gegen|bis)\\s+)?([01]?\\d|2[0-3]):([0-5]\\d)(?:\\s*uhr)?(?![\\d])`, 'giu'), time: m => `${pad(+m[1])}:${m[2]}` },
  { re: new RegExp(`(?<![\\d:.])(?:(um|ab|gegen|bis)\\s+)?([01]?\\d|2[0-3])\\.([0-5]\\d)(\\s*uhr)?(?![\\d])`, 'giu'), time: m => (m[1] || m[4] ? `${pad(+m[2])}:${m[3]}` : null) },
  // 10 Uhr, um 10 Uhr
  { re: new RegExp(`(?<![\\d:.])(?:(?:um|ab|gegen|bis)\\s+)?([01]?\\d|2[0-3])\\s*uhr(?![${L}])`, 'giu'), time: m => `${pad(+m[1])}:00` },
  // um 10
  { re: new RegExp(`(?<![${L}])(?:um|gegen)\\s+([01]?\\d|2[0-3])(?![\\d:.${L}])`, 'giu'), time: m => `${pad(+m[1])}:00` },
];

/** First rule match that yields a value; the matched text is blanked out of `text` so later rules don't see it. */
function apply<T>(text: string, rules: Rule[], pick: (r: Rule, m: RegExpExecArray) => T | null): { value: T | null; text: string } {
  for (const rule of rules) {
    rule.re.lastIndex = 0;
    for (let m = rule.re.exec(text); m; m = rule.re.exec(text)) {
      const value = pick(rule, m);
      if (value !== null) return { value, text: text.slice(0, m.index) + ' '.repeat(m[0].length) + text.slice(m.index + m[0].length) };
    }
  }
  return { value: null, text };
}

// — repeating: each rule adds to the recurrence, the matched words leave the title —

type RepeatPart = Partial<Recurrence>;
const ORDINAL: Record<string, number> = { zweite: 2, dritte: 3, vierte: 4, fünfte: 5, sechste: 6 };
const DAY_LIST = `(?:${WEEKDAY})s?(?:(?:\\s*,\\s*|\\s+und\\s+|\\s*&\\s*)(?:${WEEKDAY})s?)*`;
const REPEAT_RULES: { re: RegExp; part: (m: RegExpExecArray) => RepeatPart | null }[] = [
  { re: new RegExp(`(?<![${L}])(?:werktags|jeden\\s+werktag|an\\s+werktagen|montags?\\s+bis\\s+freitags?)(?![${L}])`, 'giu'), part: () => ({ unit: 'week', weekdays: [1, 2, 3, 4, 5] }) },
  // "jeden Montag und Donnerstag", "montags" — a plain "Montag" is a date, not a repeat
  {
    re: new RegExp(`(?<![${L}])(?:(jeden|immer)\\s+)?(${DAY_LIST})(?![${L}])`, 'giu'),
    part: m => {
      const names = m[2].toLowerCase().match(new RegExp(`(${WEEKDAY})s?`, 'gu')) ?? [];
      if (!m[1] && !names.every(n => n.endsWith('s') && !n.endsWith('ss'))) return null;
      return { unit: 'week', weekdays: [...new Set(names.map(n => DAY_INDEX[n.replace(/s$/, '')] || 7))].sort((a, b) => a - b) };
    },
  },
  {
    re: new RegExp(`(?<![${L}])alle\\s+(\\d{1,3}|zwei|drei|vier|fünf|sechs|sieben|acht|neun|zehn|zwölf)\\s+(tage|wochen|monate|jahre)(?![${L}])`, 'giu'),
    part: m => {
      const words: Record<string, number> = { ...NUMBERS, sechs: 6, sieben: 7, acht: 8, neun: 9, zehn: 10, zwölf: 12 };
      const every = /^\d+$/.test(m[1]) ? +m[1] : words[m[1].toLowerCase()];
      return every >= 1 ? { every, unit: ({ tage: 'day', wochen: 'week', monate: 'month', jahre: 'year' } as const)[m[2].toLowerCase() as 'tage'] } : null;
    },
  },
  {
    re: new RegExp(`(?<![${L}])jede[nrs]?\\s+(zweite|dritte|vierte|fünfte|sechste)[nrs]?\\s+(tag|woche|monat|jahr)(?![${L}])`, 'giu'),
    part: m => ({ every: ORDINAL[m[1].toLowerCase()], unit: ({ tag: 'day', woche: 'week', monat: 'month', jahr: 'year' } as const)[m[2].toLowerCase() as 'tag'] }),
  },
  // "jeden 15." / "am 1. jedes Monats"
  {
    re: new RegExp(`(?<![${L}])(?:(jeden)\\s+(\\d{1,2})\\.(?:\\s+(?:jedes|des)\\s+monats)?|am\\s+(\\d{1,2})\\.\\s+(?:jedes|des)\\s+monats)(?![\\d.${L}])`, 'giu'),
    part: m => {
      const day = +(m[2] ?? m[3]);
      return day >= 1 && day <= 31 ? { unit: 'month', monthDay: day } : null;
    },
  },
  { re: new RegExp(`(?<![${L}])(?:täglich|jeden\\s+tag)(?![${L}])`, 'giu'), part: () => ({ unit: 'day' }) },
  { re: new RegExp(`(?<![${L}])(?:wöchentlich|jede\\s+woche)(?![${L}])`, 'giu'), part: () => ({ unit: 'week' }) },
  { re: new RegExp(`(?<![${L}])(?:monatlich|jeden\\s+monat)(?![${L}])`, 'giu'), part: () => ({ unit: 'month' }) },
  { re: new RegExp(`(?<![${L}])(?:jährlich|jedes\\s+jahr)(?![${L}])`, 'giu'), part: () => ({ unit: 'year' }) },
  { re: new RegExp(`(?<![${L}])(?:nach|ab)\\s+(?:der\\s+)?erledigung(?![${L}])`, 'giu'), part: () => ({ fromDone: true }) },
];

function findRepeat(input: string): { repeat: Recurrence | null; text: string } {
  let text = input;
  const r: RepeatPart = {};
  for (const rule of REPEAT_RULES) {
    const found = apply(text, [{ re: rule.re }], (_r, m) => rule.part(m));
    if (!found.value) continue;
    text = found.text;
    // "alle 2 Wochen montags": the unit agrees, so the parts add up; otherwise the first one wins.
    if (r.unit && found.value.unit && r.unit !== found.value.unit) continue;
    Object.assign(r, Object.fromEntries(Object.entries(found.value).filter(([k]) => !(k in r) || k === 'every')));
  }
  if (!r.unit) return { repeat: null, text: input };
  const repeat: Recurrence = { every: r.every ?? 1, unit: r.unit };
  if (r.weekdays?.length) repeat.weekdays = r.weekdays;
  if (r.monthDay) repeat.monthDay = r.monthDay;
  if (r.fromDone) repeat.fromDone = true;
  return { repeat, text };
}

/** First date of a new series: the next chosen weekday or day of the month, today included; otherwise today. */
function firstOf(r: Recurrence, now: Date): Date {
  for (let i = 0; i < 62; i++) {
    const d = addDays(now, i);
    if (r.weekdays?.length ? r.weekdays.includes(d.getDay() || 7) : r.monthDay ? d.getDate() === r.monthDay : true) return d;
  }
  return addDays(now, 0);
}

/**
 * Finds a due date, time and repeat in German free text, e.g. "Oma Arzt Donnerstag 10 Uhr" → Thursday 10:00,
 * "Oma Arzt"; "jeden Montag Müll raus" → every Monday, starting with the next one.
 */
export function parseQuick(input: string, now = new Date()): Quick {
  const { repeat, text } = findRepeat(input);
  const date = apply(text, DATE_RULES, (r, m) => r.date!(m, now));
  const time = apply(date.text, TIME_RULES, (r, m) => r.time!(m));
  let due = date.value ? iso(date.value) : repeat ? iso(firstOf(repeat, now)) : null;
  // Only a time: today, or tomorrow when that time has passed already.
  if (!due && time.value) {
    const passed = time.value <= `${pad(now.getHours())}:${pad(now.getMinutes())}`;
    due = iso(addDays(now, passed ? 1 : 0));
  }
  const title = time.text
    .replace(/\s+/g, ' ')
    .replace(/\s+([,.;:!?])/g, '$1')
    .replace(/([,;:–-])(?=\s*([,;:–-]|$))/g, '')
    .replace(/^[\s,;:–-]+|[\s,;:–-]+$/g, '')
    .replace(/\(\s*\)/g, '')
    .trim();
  return { title: title || input.trim(), due, dueTime: time.value, repeat };
}

// WhatsApp puts "[30.10.26, 10:15:03] Oma: …" (iPhone) or "30.10.26, 10:15 - Oma: …" (Android) in front of each
// message when several are shared or a chat is exported; a single shared message is plain text.
const WA_IOS = /^‎?\[(\d{1,2}\.\d{1,2}\.\d{2,4}),?\s+\d{1,2}:\d{2}(?::\d{2})?\]\s+([^:\n]{1,60}):\s?(.*)$/;
const WA_ANDROID = /^‎?(\d{1,2}\.\d{1,2}\.\d{2,4}),?\s+\d{1,2}:\d{2}\s+-\s+([^:\n]{1,60}):\s?(.*)$/;
const BULLET = /^\s*(?:[-*•–·]|\d{1,3}[.)]|\[\s?[xX ]?\s?\])\s+/;

/** Splits shared text into messages (with sender for WhatsApp) — continuation lines belong to the message above. */
export function splitMessages(text: string): Message[] {
  const out: Message[] = [];
  for (const line of text.replace(/\r\n?/g, '\n').split('\n')) {
    const m = WA_IOS.exec(line) ?? WA_ANDROID.exec(line);
    if (m) out.push({ sender: m[2].trim(), text: m[3] });
    else if (out.length && out[out.length - 1].sender !== null) out[out.length - 1].text += `\n${line}`;
    else out.push({ sender: null, text: line });
  }
  return out.map(m => ({ ...m, text: m.text.trim() })).filter(m => m.text);
}

/** One ticket per line or message: bullets and WhatsApp prefixes removed, a heading like "Einkauf:" above a list skipped. */
export function linesOf(text: string): Message[] {
  const list = text.split('\n').some(l => BULLET.test(l));
  return splitMessages(text).flatMap(m => {
    if (m.sender) return [m];
    const lines = m.text.split('\n').filter(l => l.trim());
    return lines.filter(l => !(list && !BULLET.test(l) && /:\s*$/.test(l))).map(l => ({ sender: null, text: l.replace(BULLET, '').trim() }));
  });
}

/** Several tickets are the likely intent for several WhatsApp messages or a bulleted list. */
export function looksLikeList(text: string): boolean {
  const messages = splitMessages(text);
  if (messages.filter(m => m.sender).length >= 2) return true;
  return text.split('\n').filter(l => BULLET.test(l)).length >= 2;
}

/** Title for one ticket from longer text: on one line and cut at a word, the full text then goes to the description. */
export function shortTitle(text: string, max = 120): { title: string; cut: boolean } {
  const one = text.replace(/\s+/g, ' ').trim();
  if (one.length <= max) return { title: one, cut: false };
  const cut = one.slice(0, max);
  return { title: `${cut.slice(0, cut.lastIndexOf(' ') > 40 ? cut.lastIndexOf(' ') : max).replace(/[\s,;:–-]+$/, '')} …`, cut: true };
}

// — Web Share Target: Android's "Teilen → Tasklog" opens /share?title=…&text=…&url=… —

const SHARE_KEY = 'tasklog-share';

export interface Shared {
  text: string;
  url: string | null;
}

/**
 * Runs before the app renders: keeps a share in sessionStorage — it survives the login redirect — and moves on to
 * the new-ticket screen.
 */
export function captureShare() {
  if (window.location.pathname !== '/share') return;
  const q = new URLSearchParams(window.location.search);
  // Some apps put the link into "text", some the text into "title".
  const url = q.get('url') || null;
  const text = [q.get('title'), q.get('text')].filter((v): v is string => Boolean(v?.trim())).filter(v => v !== url).join('\n');
  try {
    if (text || url) sessionStorage.setItem(SHARE_KEY, JSON.stringify({ text, url } satisfies Shared));
  } catch { /* private mode: the share is lost, the app still opens */ }
  window.history.replaceState(null, '', '/#/new');
}

/** The pending share, once. */
export function takeShared(): Shared | null {
  try {
    const raw = sessionStorage.getItem(SHARE_KEY);
    if (!raw) return null;
    sessionStorage.removeItem(SHARE_KEY);
    return JSON.parse(raw) as Shared;
  } catch {
    return null;
  }
}

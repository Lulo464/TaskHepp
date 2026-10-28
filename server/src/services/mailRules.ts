/**
 * Turning a mail into tickets: rule matching, templates, splitting one mail into several
 * tickets and finding due dates. Pure functions, no IMAP or database here.
 */

export interface MailMessage {
  messageKey: string;
  fromAddress: string;
  fromName: string;
  subject: string;
  /** Plain text body (HTML already converted). */
  body: string;
  date: Date;
}

export interface MailRule {
  id: number;
  name: string;
  enabled: boolean;
  fromContains: string;
  subjectContains: string;
  bodyContains: string;
  subjectPattern: string;
  action: 'ticket' | 'ignore';
  split: 'none' | 'lines' | 'bullets' | 'pattern';
  splitPattern: string;
  titleTemplate: string;
  descriptionTemplate: string;
  areaId: number | null;
  prio: 'normal' | 'high';
  dueMode: 'none' | 'days' | 'detect';
  dueDays: number;
  dueTime: string | null;
  continueAfter: boolean;
}

export interface PlannedTicket {
  ruleId: number;
  title: string;
  description: string;
  areaId: number | null;
  prio: 'normal' | 'high';
  due: string | null;
  dueTime: string | null;
}

export interface MailPlan {
  result: 'created' | 'ignored' | 'nomatch';
  ruleIds: number[];
  tickets: PlannedTicket[];
}

/** Upper bounds so a huge or hostile mail can't flood the system. */
export const MAX_TICKETS_PER_MAIL = 50;
const MAX_BODY = 50_000;
const MAX_DESCRIPTION = 4000;

/** Compiles a user-supplied pattern; returns an error message instead of throwing. */
export function checkPattern(pattern: string): string | null {
  if (!pattern) return null;
  try {
    new RegExp(pattern, 'i');
    return null;
  } catch (err) {
    return (err as Error).message;
  }
}

const contains = (haystack: string, needle: string) => !needle.trim() || haystack.toLowerCase().includes(needle.trim().toLowerCase());

type Vars = Record<string, string>;

/** Whether the rule applies, plus the subject pattern's groups as template variables. */
export function matchRule(rule: MailRule, mail: MailMessage): Vars | null {
  if (!rule.enabled) return null;
  const from = `${mail.fromName} <${mail.fromAddress}>`;
  if (!contains(from, rule.fromContains) || !contains(mail.subject, rule.subjectContains) || !contains(mail.body, rule.bodyContains)) return null;
  if (!rule.subjectPattern) return {};
  let m: RegExpMatchArray | null;
  try {
    m = mail.subject.match(new RegExp(rule.subjectPattern, 'i'));
  } catch {
    return null; // invalid pattern never matches
  }
  return m ? groupVars(m) : null;
}

function groupVars(m: RegExpMatchArray): Vars {
  const vars: Vars = {};
  m.slice(1).forEach((g, i) => { vars[String(i + 1)] = (g ?? '').trim(); });
  for (const [k, v] of Object.entries(m.groups ?? {})) vars[k] = (v ?? '').trim();
  return vars;
}

/** Replaces {name} placeholders; unknown ones become empty. */
export function render(template: string, vars: Vars): string {
  return template.replace(/\{([\wäöüÄÖÜß]+)\}/g, (_, key: string) => vars[key] ?? '').replace(/[ \t]+\n/g, '\n').trim();
}

/** The mail text without quoted replies and signature. */
function mainText(body: string): string[] {
  const lines = body.slice(0, MAX_BODY).replace(/\r\n?/g, '\n').split('\n');
  const end = lines.findIndex(l => l === '-- ' || l === '--');
  return (end >= 0 ? lines.slice(0, end) : lines).filter(l => !l.startsWith('>'));
}

const BULLET = /^\s*(?:[-*•–·]|\d{1,3}[.)]|\[[ xX]?\])\s+(.+)$/;

/** One entry per ticket to create; a single empty entry when the rule does not split. */
export function splitItems(rule: MailRule, body: string): Vars[] {
  if (rule.split === 'none') return [{}];
  const lines = mainText(body);
  let items: Vars[] = [];
  if (rule.split === 'lines') {
    items = lines.map(l => l.trim()).filter(Boolean).map(item => ({ item: item.replace(BULLET, '$1').trim() }));
  } else if (rule.split === 'bullets') {
    items = lines.map(l => l.match(BULLET)).filter((m): m is RegExpMatchArray => Boolean(m)).map(m => ({ item: m[1].trim() }));
  } else if (rule.split === 'pattern' && rule.splitPattern) {
    try {
      const re = new RegExp(rule.splitPattern, 'gim');
      items = [...lines.join('\n').matchAll(re)].filter(m => m[0].trim()).map(m => ({ item: m[0].trim(), ...groupVars(m) }));
    } catch {
      items = [];
    }
  }
  return items.slice(0, MAX_TICKETS_PER_MAIL);
}

const pad = (n: number) => String(n).padStart(2, '0');
const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/**
 * First date in the text: 03.11.2026, 3.11.26, 03.11. (next occurrence) or 2026-11-03,
 * optionally followed by a time ("um 19:00", "19 Uhr").
 */
export function detectDue(text: string, today: Date): { date: string; time: string | null } | null {
  // Four-digit years before two-digit ones; no digit or dot around the date, so "1.2.3" is no date.
  const re = /(?<![\d.])(?:(\d{4})-(\d{2})-(\d{2})|(\d{1,2})\.(\d{1,2})\.(\d{4}|\d{2})?)(?![\d.])(?:[,\s]+(?:um\s+|ab\s+)?(\d{1,2})(?::(\d{2}))?\s*(?:Uhr|h\b)?)?/i;
  for (const m of text.matchAll(new RegExp(re, 'gi'))) {
    let y: number;
    let mo: number;
    let d: number;
    if (m[1]) {
      [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
    } else {
      d = Number(m[4]);
      mo = Number(m[5]);
      if (m[6]) y = m[6].length === 2 ? 2000 + Number(m[6]) : Number(m[6]);
      else {
        // No year: the next time this day comes round.
        y = today.getFullYear();
        if (new Date(y, mo - 1, d) < new Date(today.getFullYear(), today.getMonth(), today.getDate())) y += 1;
      }
    }
    const date = new Date(y, mo - 1, d);
    if (date.getMonth() !== mo - 1 || date.getDate() !== d || y < 2000 || y > 2100) continue; // e.g. 31.02. or a version number
    // A time only counts with a minute part or an "Uhr" after it, so "03.11. 2 Tonnen" is not 02:00.
    let time: string | null = null;
    if (m[7] !== undefined && (m[8] !== undefined || /uhr|h\b/i.test(m[0]))) {
      const h = Number(m[7]);
      const min = Number(m[8] ?? 0);
      if (h < 24 && min < 60) time = `${pad(h)}:${pad(min)}`;
    }
    return { date: iso(date), time };
  }
  return null;
}

function addDays(today: Date, days: number): string {
  const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() + days);
  return iso(d);
}

/** Decides what a mail becomes. `today` is the household's local date. */
export function planMail(rules: MailRule[], mail: MailMessage, today: Date): MailPlan {
  const base: Vars = {
    subject: mail.subject,
    from: mail.fromName ? `${mail.fromName} <${mail.fromAddress}>` : mail.fromAddress,
    fromName: mail.fromName || mail.fromAddress,
    fromAddress: mail.fromAddress,
    date: `${pad(mail.date.getDate())}.${pad(mail.date.getMonth() + 1)}.${mail.date.getFullYear()}`,
    body: mainText(mail.body).join('\n').trim().slice(0, MAX_DESCRIPTION),
    bodyFirstLine: mainText(mail.body).map(l => l.trim()).find(Boolean) ?? '',
  };

  const plan: MailPlan = { result: 'nomatch', ruleIds: [], tickets: [] };
  for (const rule of rules) {
    const groups = matchRule(rule, mail);
    if (!groups) continue;
    plan.ruleIds.push(rule.id);
    if (rule.action === 'ignore') {
      if (plan.result === 'nomatch') plan.result = 'ignored';
    } else {
      for (const item of splitItems(rule, mail.body)) {
        if (plan.tickets.length >= MAX_TICKETS_PER_MAIL) break;
        const vars = { ...base, ...groups, ...item, item: item.item ?? mail.subject };
        let due: string | null = null;
        let dueTime = rule.dueTime;
        if (rule.dueMode === 'days') due = addDays(today, rule.dueDays);
        if (rule.dueMode === 'detect') {
          const found = detectDue(`${item.item ?? ''}\n${mail.subject}\n${mail.body.slice(0, MAX_BODY)}`, today);
          if (found) {
            due = found.date;
            dueTime = rule.dueTime ?? found.time;
          }
        }
        plan.tickets.push({
          ruleId: rule.id,
          title: (render(rule.titleTemplate, vars) || mail.subject || '(ohne Betreff)').slice(0, 200),
          description: render(rule.descriptionTemplate, vars).slice(0, MAX_DESCRIPTION),
          areaId: rule.areaId,
          prio: rule.prio,
          due,
          dueTime: due ? dueTime : null,
        });
      }
      if (plan.tickets.length) plan.result = 'created';
      else if (plan.result === 'nomatch') plan.result = 'ignored'; // matched, but splitting found nothing
    }
    if (!rule.continueAfter) break;
  }
  return plan;
}

/** Very small HTML → text conversion for mails without a text part. */
export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style|head)[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|tr|h\d)>/gi, '\n')
    .replace(/<li[^>]*>/gi, '- ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

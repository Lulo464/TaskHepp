/**
 * Turns the free-text rule conditions from the admin UI into Home Assistant templates.
 *
 * Supported forms (entity comes from the rule, or leads the extra condition):
 *   > 1.8 · <= 5 · = on · != idle          compare state (numbers compare numerically)
 *   on > 2 h · off > 30 min                 state held for a duration
 *   in 1 Tag · in 2 h                       calendar: next event starts within that time
 *   on                                      bare state
 */

export interface ParsedCondition {
  template: string;
  /** HA `for:` duration, HH:MM:SS. */
  holdFor?: string;
}

const NUM = /^-?\d+(?:[.,]\d+)?$/;
const q = (s: string) => `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
const num = (s: string) => s.replace(',', '.');

const UNIT_SECONDS: Record<string, number> = { s: 1, sek: 1, min: 60, m: 60, h: 3600, std: 3600, stunde: 3600, stunden: 3600, tag: 86400, tage: 86400, d: 86400, day: 86400, days: 86400 };

function hms(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return [h, m, s].map(v => String(v).padStart(2, '0')).join(':');
}

export function parseCondition(entity: string, cond: string): ParsedCondition | null {
  const c = cond.trim();
  const e = q(entity);
  let m: RegExpMatchArray | null;

  // "on > 2 h": a non-numeric state held for a duration
  if ((m = c.match(/^([a-z_][\w-]*)\s*>\s*(\d+(?:[.,]\d+)?)\s*([a-zäöü]+)$/i)) && !NUM.test(m[1])) {
    const unit = UNIT_SECONDS[m[3].toLowerCase()];
    if (!unit) return null;
    return { template: `is_state(${e}, ${q(m[1])})`, holdFor: hms(Number(num(m[2])) * unit) };
  }

  // "in 1 Tag": calendar event starts within the given time
  if ((m = c.match(/^in\s+(\d+(?:[.,]\d+)?)\s*([a-zäöü]+)$/i))) {
    const unit = UNIT_SECONDS[m[2].toLowerCase()];
    if (!unit) return null;
    const seconds = Number(num(m[1])) * unit;
    return { template: `(as_timestamp(state_attr(${e}, 'start_time'), 0) - as_timestamp(now())) | int(0) in range(0, ${Math.round(seconds) + 1})` };
  }

  // comparisons
  if ((m = c.match(/^(>=|<=|!=|==|=|>|<)\s*(.+)$/))) {
    const op = m[1] === '=' ? '==' : m[1];
    const value = m[2].trim();
    if (NUM.test(value)) return { template: `states(${e}) | float(0) ${op} ${num(value)}` };
    if (op === '==') return { template: `is_state(${e}, ${q(value)})` };
    if (op === '!=') return { template: `not is_state(${e}, ${q(value)})` };
    return null;
  }

  // bare state
  if (/^[\w-]+$/.test(c)) return { template: `is_state(${e}, ${q(c)})` };
  return null;
}

/** Parses "sensor.x < 5" (entity first) as used for the extra condition. */
export function parseExpression(expr: string): ParsedCondition | null {
  const m = expr.trim().match(/^([a-z_]+\.[\w]+)\s+(.+)$/i);
  return m ? parseCondition(m[1], m[2]) : null;
}

export interface RuleConditionInput {
  entity: string;
  cond: string;
  join: 'and' | 'or';
  cond2: string;
}

/** Combined template (without the {{ }}) and hold time, or null if something can't be translated. */
export function ruleTemplate(rule: RuleConditionInput): ParsedCondition | null {
  const main = parseCondition(rule.entity, rule.cond);
  if (!main) return null;
  if (!rule.cond2.trim()) return main;
  const extra = parseExpression(rule.cond2);
  if (!extra) return null;
  return { template: `(${main.template}) ${rule.join} (${extra.template})`, holdFor: main.holdFor };
}

/** "17:00–21:00" → ['17:00:00', '21:00:00']; null for the whole day or anything unparsable. */
export function parseWindow(window: string): [string, string] | null {
  const m = window.trim().match(/^(\d{1,2}):(\d{2})\s*[–—-]\s*(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const from = `${m[1].padStart(2, '0')}:${m[2]}:00`;
  const to = `${m[3].padStart(2, '0')}:${m[4]}:00`;
  if (from === '00:00:00' && (to === '23:59:00' || to === '24:00:00')) return null;
  return [from, to];
}

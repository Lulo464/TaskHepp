import { describe, expect, it } from 'vitest';
import { checkPattern, detectDue, htmlToText, planMail, render, splitItems, type MailMessage, type MailRule } from '../src/services/mailRules.js';

const today = new Date(2026, 9, 28); // 28.10.2026

const rule = (over: Partial<MailRule> = {}): MailRule => ({
  id: 1, name: 'R', enabled: true, fromContains: '', subjectContains: '', bodyContains: '', subjectPattern: '',
  action: 'ticket', split: 'none', splitPattern: '', titleTemplate: '{subject}', descriptionTemplate: '{body}',
  areaId: 1, prio: 'normal', dueMode: 'none', dueDays: 0, dueTime: null, continueAfter: false, ...over,
});

const mail = (over: Partial<MailMessage> = {}): MailMessage => ({
  messageKey: '<1@x>', fromAddress: 'anna@example.com', fromName: 'Anna', subject: 'Einkauf', body: 'Bitte erledigen.', date: today, ...over,
});

describe('planMail', () => {
  it('makes one ticket from subject and body by default', () => {
    const plan = planMail([rule()], mail(), today);
    expect(plan).toMatchObject({ result: 'created', ruleIds: [1] });
    expect(plan.tickets).toEqual([{ ruleId: 1, title: 'Einkauf', description: 'Bitte erledigen.', areaId: 1, prio: 'normal', due: null, dueTime: null }]);
  });

  it('checks conditions case-insensitively and in order', () => {
    const rules = [
      rule({ id: 1, fromContains: 'NEWSLETTER', action: 'ignore' }),
      rule({ id: 2, subjectContains: 'rechnung', titleTemplate: 'Rechnung von {fromName} prüfen', prio: 'high' }),
      rule({ id: 3 }),
    ];
    expect(planMail(rules, mail({ fromAddress: 'newsletter@shop.de' }), today)).toMatchObject({ result: 'ignored', ruleIds: [1], tickets: [] });
    expect(planMail(rules, mail({ subject: 'Ihre RECHNUNG 4711' }), today).tickets[0]).toMatchObject({ title: 'Rechnung von Anna prüfen', prio: 'high', ruleId: 2 });
    expect(planMail(rules, mail(), today).tickets[0].ruleId).toBe(3);
    expect(planMail([rule({ subjectContains: 'xyz' })], mail(), today)).toMatchObject({ result: 'nomatch', tickets: [] });
  });

  it('uses subject pattern groups in templates', () => {
    const r = rule({ subjectPattern: 'Auftrag (?<nr>\\d+): (.+)', titleTemplate: '#{nr} {2}' });
    expect(planMail([r], mail({ subject: 'Auftrag 815: Heizung warten' }), today).tickets[0].title).toBe('#815 Heizung warten');
    expect(planMail([r], mail({ subject: 'Hallo' }), today).result).toBe('nomatch');
  });

  it('can create several tickets from one mail', () => {
    const body = 'Hallo,\nbitte noch:\n- Milch kaufen\n* Müll rausbringen\n1. Rasen mähen\n\nDanke\n-- \nAnna\n> - alt';
    const r = rule({ split: 'bullets', titleTemplate: '{item}', descriptionTemplate: 'Aus Mail von {fromName}: {subject}' });
    const plan = planMail([r], mail({ body }), today);
    expect(plan.tickets.map(t => t.title)).toEqual(['Milch kaufen', 'Müll rausbringen', 'Rasen mähen']);
    expect(plan.tickets[0].description).toBe('Aus Mail von Anna: Einkauf');
  });

  it('splits by pattern with groups', () => {
    const r = rule({ split: 'pattern', splitPattern: 'Termin: (\\S+) (.+)', titleTemplate: '{2}', dueMode: 'detect' });
    const plan = planMail([r], mail({ body: 'Termin: 03.11. Wartung Heizung\nTermin: 10.11.2026 Schornsteinfeger' }), today);
    expect(plan.tickets.map(t => [t.title, t.due])).toEqual([['Wartung Heizung', '2026-11-03'], ['Schornsteinfeger', '2026-11-10']]);
  });

  it('lets several rules contribute when they say so', () => {
    const rules = [rule({ id: 1, titleTemplate: 'Antworten: {subject}', continueAfter: true }), rule({ id: 2, bodyContains: 'rechnung', titleTemplate: 'Rechnung bezahlen' })];
    const plan = planMail(rules, mail({ body: 'Anbei die Rechnung' }), today);
    expect(plan.ruleIds).toEqual([1, 2]);
    expect(plan.tickets.map(t => t.title)).toEqual(['Antworten: Einkauf', 'Rechnung bezahlen']);
  });

  it('sets due dates by days or from the text', () => {
    expect(planMail([rule({ dueMode: 'days', dueDays: 3, dueTime: '09:00' })], mail(), today).tickets[0]).toMatchObject({ due: '2026-10-31', dueTime: '09:00' });
    expect(planMail([rule({ dueMode: 'detect' })], mail({ body: 'Abholung am 05.11.2026 um 14:30' }), today).tickets[0]).toMatchObject({ due: '2026-11-05', dueTime: '14:30' });
    expect(planMail([rule({ dueMode: 'detect' })], mail({ body: 'kein Datum' }), today).tickets[0]).toMatchObject({ due: null, dueTime: null });
  });

  it('caps the number of tickets per mail', () => {
    const body = Array.from({ length: 80 }, (_, i) => `- Punkt ${i}`).join('\n');
    expect(planMail([rule({ split: 'bullets' })], mail({ body }), today).tickets).toHaveLength(50);
  });
});

describe('helpers', () => {
  it('detects dates', () => {
    expect(detectDue('bis 01.02.', today)).toEqual({ date: '2027-02-01', time: null }); // next occurrence
    expect(detectDue('am 3.11.26 19 Uhr', today)).toEqual({ date: '2026-11-03', time: '19:00' });
    expect(detectDue('2026-12-24', today)).toEqual({ date: '2026-12-24', time: null });
    expect(detectDue('Version 1.2.3 und 31.02.2026', today)).toBeNull();
    expect(detectDue('03.11. 2 Tonnen', today)).toEqual({ date: '2026-11-03', time: null });
  });

  it('splits lines without quotes and signature', () => {
    expect(splitItems(rule({ split: 'lines' }), 'A\n\n- B\n> C\n-- \nSig')).toEqual([{ item: 'A' }, { item: 'B' }]);
  });

  it('renders templates and validates patterns', () => {
    expect(render('{a} – {missing}!', { a: 'x' })).toBe('x – !');
    expect(checkPattern('(')).not.toBeNull();
    expect(checkPattern('Auftrag (\\d+)')).toBeNull();
  });

  it('converts HTML mails to text', () => {
    expect(htmlToText('<p>Hallo&nbsp;Welt</p><ul><li>Eins</li><li>Zwei</li></ul><style>x{}</style>')).toBe('Hallo Welt\n- Eins\n- Zwei');
  });
});

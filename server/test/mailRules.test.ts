import { describe, expect, it } from 'vitest';
import { fixLatin1Headers } from '../src/services/mailImport.js';
import { checkPattern, detectDue, htmlToText, mailBody, planMail, render, splitItems, type MailMessage, type MailRule } from '../src/services/mailRules.js';

const today = new Date(2026, 9, 28); // 28.10.2026

const rule = (over: Partial<MailRule> = {}): MailRule => ({
  id: 1, name: 'R', enabled: true, fromContains: '', subjectContains: '', bodyContains: '', subjectPattern: '',
  action: 'ticket', split: 'none', splitPattern: '', splitExclude: '', titleTemplate: '{subject}', descriptionTemplate: '{body}',
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

describe('links as tickets', () => {
  // The pattern from the docs: one ticket per line with a link, list markers in front are skipped.
  const LINK = String.raw`^\s*(?:[-*•–·]|\d{1,3}[.)])?\s*(.*?)[\s\[(<:]*((?:https?://|www\.)[^\s\]>)"]+).*$`;
  const body = [
    '* https://youtube.com/watch?v=abc',
    '- Neue Kaffeemaschine https://shop.de/kaffee?id=1',
    '* Startseite https://www.herbrand.de/start',
    '1. Rezept: www.chefkoch.de/rezept/123',
    'Angebot: Hier klicken [https://shop.de/deal]',
    'Ohne Link',
  ].join('\n');

  it('uses the text before the link, else the link, and skips excluded sites', () => {
    const r = rule({ split: 'pattern', splitPattern: LINK, titleTemplate: '{1|2}', descriptionTemplate: '{2}', splitExclude: 'herbrand.de, abmelden' });
    expect(planMail([r], mail({ body }), today).tickets.map(t => [t.title, t.description])).toEqual([
      ['https://youtube.com/watch?v=abc', 'https://youtube.com/watch?v=abc'],
      ['Neue Kaffeemaschine', 'https://shop.de/kaffee?id=1'],
      ['Rezept', 'www.chefkoch.de/rezept/123'],
      ['Angebot: Hier klicken', 'https://shop.de/deal'],
    ]);
  });

  it('applies the exclusions to lines and bullets too', () => {
    expect(planMail([rule({ split: 'bullets', titleTemplate: '{item}', splitExclude: 'HERBRAND' })], mail({ body }), today).tickets).toHaveLength(3);
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
    expect(render('{1|2|subject}', { 1: ' ', 2: '', subject: 'Betreff' })).toBe('Betreff');
    expect(render('{1|2}', { 1: 'Text', 2: 'https://x' })).toBe('Text');
    expect(checkPattern('(')).not.toBeNull();
    expect(checkPattern('Auftrag (\\d+)')).toBeNull();
  });

  it('converts HTML mails to text', () => {
    expect(htmlToText('<p>Hallo&nbsp;Welt</p><ul><li>Eins</li><li>Zwei</li></ul><style>x{}</style>')).toBe('Hallo Welt\n- Eins\n- Zwei');
  });
});

describe('header charset', () => {
  it('reads unencoded Latin-1 headers and leaves UTF-8 alone', () => {
    const latin1 = Buffer.concat([Buffer.from('From: Werkstatt Müller <a@b.de>\r\n', 'latin1'), Buffer.from('\r\nKörper', 'utf8')]);
    expect(fixLatin1Headers(latin1).toString('utf8')).toBe('From: Werkstatt Müller <a@b.de>\r\n\r\nKörper');
    const utf8 = Buffer.from('From: Müller <a@b.de>\r\n\r\nText', 'utf8');
    expect(fixLatin1Headers(utf8)).toBe(utf8);
  });
});

describe('values from the mail text', () => {
  // As a ticket system sends it: the link only in the HTML part, behind "Link zum Ticket".
  const subject = 'WG: [herbrand#305564 IT Solutions-Ticket] "ITA - Tobias Horster - neuer Mitarbeiter" - Ticket ist zugewiesen';
  const html = '<p>Hallo,</p><p>das Ticket wurde Ihnen zugewiesen.</p>' +
    '<p><a href="https://support.herbrand.de/ticket/305564?a=1&amp;b=2" target="_blank"><b>Link zum Ticket</b></a></p>' +
    '<p>Mit freundlichen Grüßen<br>Ihr IT-Team</p>';
  const text = 'Hallo,\n\ndas Ticket wurde Ihnen zugewiesen.\n\nLink zum Ticket\n\nMit freundlichen Grüßen\nIhr IT-Team';
  const ticketRule = rule({
    subjectPattern: '["„“](.+?)["“”]',
    bodyPattern: 'Link zum Ticket\\W*(https?://[^\\s<>\\])"]+)',
    titleTemplate: '{1}',
    descriptionTemplate: '{text1}',
  });

  it('keeps link addresses when turning HTML into text', () => {
    expect(htmlToText('<a href="https://x.de/a?b=1&amp;c=2">Link zum Ticket</a>')).toBe('Link zum Ticket <https://x.de/a?b=1&c=2>');
    expect(htmlToText('<a href="https://x.de">https://x.de</a>')).toBe('https://x.de');
    expect(htmlToText('<a href="mailto:a@b.de">a@b.de</a>')).toBe('a@b.de');
  });

  it('uses the HTML part when the text part lost its links', () => {
    expect(mailBody(text, html)).toContain('Link zum Ticket <https://support.herbrand.de/ticket/305564?a=1&b=2>');
    expect(mailBody('Siehe https://x.de', '<a href="https://x.de">x</a>')).toBe('Siehe https://x.de');
    expect(mailBody('nur Text', undefined)).toBe('nur Text');
    expect(mailBody(undefined, '<p>nur HTML</p>')).toBe('nur HTML');
  });

  it('takes the title from the quotes and only the ticket link as description', () => {
    const plan = planMail([ticketRule], mail({ subject, body: mailBody(text, html) }), today);
    expect(plan.tickets).toEqual([expect.objectContaining({
      title: 'ITA - Tobias Horster - neuer Mitarbeiter',
      description: 'https://support.herbrand.de/ticket/305564?a=1&b=2',
    })]);
    // Typographic quotes work as well; a mail without the link still gets its ticket, with an empty description.
    const other = planMail([ticketRule], mail({ subject: 'WG: „Drucker defekt“ - zugewiesen', body: 'kein Link' }), today);
    expect(other.tickets).toEqual([expect.objectContaining({ title: 'Drucker defekt', description: '' })]);
    // The same pattern finds the link however the text part writes it.
    for (const body of ['Link zum Ticket: https://t.de/1', 'Link zum Ticket [https://t.de/1]', 'Link zum Ticket\nhttps://t.de/1', 'Link zum Ticket (https://t.de/1)']) {
      expect(planMail([ticketRule], mail({ subject, body }), today).tickets[0].description).toBe('https://t.de/1');
    }
  });

  it('names groups of the text pattern {text1}, {text2} and by name', () => {
    const r = rule({ bodyPattern: 'Kunde: (?<kunde>\\w+), Nr\\. (\\d+)', titleTemplate: '{kunde} {text2}', descriptionTemplate: '{text1}' });
    expect(planMail([r], mail({ body: 'Kunde: Meier, Nr. 42' }), today).tickets[0]).toMatchObject({ title: 'Meier 42', description: 'Meier' });
    expect(planMail([rule({ bodyPattern: '(' })], mail(), today).result).toBe('created'); // broken pattern extracts nothing
  });
});

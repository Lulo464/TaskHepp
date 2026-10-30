import { describe, expect, it } from 'vitest';
import { linesOf, looksLikeList, parseQuick, shortTitle, splitMessages } from './quickAdd';

const now = new Date(2026, 9, 30, 9, 0); // Friday, 30.10.2026, 09:00
const q = (text: string) => parseQuick(text, now);

describe('parseQuick', () => {
  it('finds weekday and time and removes them from the title', () => {
    expect(q('Oma Arzt Donnerstag 10 Uhr')).toEqual({ title: 'Oma Arzt', due: '2026-11-05', dueTime: '10:00' });
    expect(q('Kannst du mich am Do um 14:30 zum Arzt fahren?')).toEqual({ title: 'Kannst du mich zum Arzt fahren?', due: '2026-11-05', dueTime: '14:30' });
    expect(q('Do. 10 Uhr Physio')).toEqual({ title: 'Physio', due: '2026-11-05', dueTime: '10:00' });
    expect(q('Freitag Kuchen backen').due).toBe('2026-11-06'); // today is Friday: the next one
    expect(q('Brot bis Samstag')).toEqual({ title: 'Brot', due: '2026-10-31', dueTime: null });
    expect(q('nächsten Montag Auto in die Werkstatt')).toEqual({ title: 'Auto in die Werkstatt', due: '2026-11-02', dueTime: null });
  });

  it('reads numeric dates and month names', () => {
    expect(q('Rezept abholen bis 5.11.')).toEqual({ title: 'Rezept abholen', due: '2026-11-05', dueTime: null });
    expect(q('Geburtstag Tante 03.01.').due).toBe('2027-01-03'); // already past this year
    expect(q('Termin 12. November 2026 9:15')).toEqual({ title: 'Termin', due: '2026-11-12', dueTime: '09:15' });
    expect(q('Zahnarzt am Mi, 4.11.26 um 8.30 Uhr')).toEqual({ title: 'Zahnarzt', due: '2026-11-04', dueTime: '08:30' });
    expect(q('Steuer 2026-12-24')).toEqual({ title: 'Steuer', due: '2026-12-24', dueTime: null });
  });

  it('understands relative days', () => {
    expect(q('morgen Müll raus')).toEqual({ title: 'Müll raus', due: '2026-10-31', dueTime: null });
    expect(q('übermorgen Paket abholen').due).toBe('2026-11-01');
    expect(q('in 3 Tagen Reifen wechseln')).toEqual({ title: 'Reifen wechseln', due: '2026-11-02', dueTime: null });
    expect(q('in einer Woche Blumen gießen').due).toBe('2026-11-06');
    expect(q('nächste Woche Fenster putzen')).toEqual({ title: 'Fenster putzen', due: '2026-11-06', dueTime: null });
  });

  it('puts a time without a date on today, or tomorrow when it has passed', () => {
    expect(q('um 18 Uhr Essen')).toEqual({ title: 'Essen', due: '2026-10-30', dueTime: '18:00' });
    expect(q('Treffen 10.30 Uhr').dueTime).toBe('10:30');
    expect(q('um 8 anrufen')).toEqual({ title: 'anrufen', due: '2026-10-31', dueTime: '08:00' });
  });

  it('leaves ordinary text alone', () => {
    for (const text of ['Guten Morgen, kannst du Milch mitbringen', 'Ist das so.', 'Version 1.2.3 updaten', 'Zahlung 31.02.2026 prüfen', 'Mach das so wie immer']) {
      expect(q(text)).toEqual({ title: text, due: null, dueTime: null });
    }
  });
});

describe('shared text', () => {
  it('splits WhatsApp messages with sender, continuation lines included', () => {
    const ios = '[30.10.26, 10:15:03] Oma: Kannst du Donnerstag Milch holen\n[30.10.26, 10:16:10] Oma: Und die Tabletten\nbitte die blauen';
    expect(splitMessages(ios)).toEqual([
      { sender: 'Oma', text: 'Kannst du Donnerstag Milch holen' },
      { sender: 'Oma', text: 'Und die Tabletten\nbitte die blauen' },
    ]);
    expect(splitMessages('30.10.26, 10:15 - Opa Heinz: Hallo')).toEqual([{ sender: 'Opa Heinz', text: 'Hallo' }]);
    expect(looksLikeList(ios)).toBe(true);
  });

  it('makes one ticket per line or bullet, without the heading', () => {
    expect(linesOf('Einkauf:\n- Milch\n* Brot\n\n1. Eier').map(l => l.text)).toEqual(['Milch', 'Brot', 'Eier']);
    expect(looksLikeList('- Milch\n- Brot')).toBe(true);
    expect(looksLikeList('Hallo mein Schatz,\nkannst du morgen kommen?\nLG Oma')).toBe(false);
  });

  it('shortens long text for a title', () => {
    expect(shortTitle('kurz\nund knapp')).toEqual({ title: 'kurz und knapp', cut: false });
    const long = shortTitle('Hallo mein Schatz, kannst du mir morgen beim Einkaufen helfen, ich brauche noch Kartoffeln, Milch, Butter und die Tabletten aus der Apotheke');
    expect(long.cut).toBe(true);
    expect(long.title.length).toBeLessThanOrEqual(122);
    expect(long.title.endsWith(' …')).toBe(true);
  });
});

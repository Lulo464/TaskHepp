import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ticketTitle } from '../src/services/calendars.js';
import { fakeHomeAssistant, setup, type FakeHa, type TestApp } from './helpers.js';

let t: TestApp;
let ha: FakeHa;
let admin: string;

/** YYYY-MM-DD in Europe/Berlin, `days` from today. */
const day = (days: number) => new Date(Date.now() + days * 86400000).toLocaleDateString('sv-SE', { timeZone: 'Europe/Berlin' });

beforeAll(async () => {
  t = await setup();
  admin = await t.login('admin');
  ha = await fakeHomeAssistant();
  ha.calendars.set('calendar.abfall_io', [
    { summary: 'Restmüll', start: { date: day(3) } },
    { summary: 'Papier', start: { date: day(3) } },
    { summary: 'Gelber Sack', start: { date: day(10) } },
    { summary: 'Biotonne', start: { date: day(40) } }, // beyond the 14-day lookahead
    { summary: 'Restmüll', start: { date: day(-5) } }, // in the past
  ]);
  await call('PATCH', '/api/settings', { ha: { url: ha.url, token: 'ha-token' } });
});
afterAll(async () => {
  await ha.close();
  await t.close();
});

const call = (method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, payload?: unknown) =>
  t.app.inject({ method, url, payload: payload as object, headers: { cookie: admin } });

const source = { entityId: 'calendar.abfall_io', name: 'Abfall', areaId: 2, titleTemplate: '{title} rausstellen', leadDays: 1, lookaheadDays: 14, prio: 'normal', autoClose: true, enabled: true };

describe('calendar import', () => {
  let id: number;

  it('lists the calendars Home Assistant offers', async () => {
    expect((await call('GET', '/api/ha/calendars')).json()).toEqual([{ entity_id: 'calendar.abfall_io', name: 'abfall_io' }]);
  });

  it('creates one ticket per upcoming event, due the day before', async () => {
    const res = await call('POST', '/api/calendars', source);
    expect(res.statusCode).toBe(201);
    id = res.json().id;
    expect(res.json()).toMatchObject({ lastError: null });

    const tickets = (await call('GET', '/api/tickets?q=rausstellen')).json();
    expect(tickets.map((x: { title: string }) => x.title).sort()).toEqual(['Gelber Sack rausstellen', 'Papier rausstellen', 'Restmüll rausstellen']);
    const rest = tickets.find((x: { title: string }) => x.title === 'Restmüll rausstellen');
    expect(rest).toMatchObject({ due: day(2), area: 'Zuhause', source: 'ha', status: 'open' });
  });

  it('does not create duplicates, not even after a ticket was deleted', async () => {
    const paper = (await call('GET', '/api/tickets?q=Papier')).json()[0];
    await call('DELETE', `/api/tickets/${paper.id}`);
    expect((await call('POST', `/api/calendars/${id}/sync`)).json()).toEqual({ events: 3, created: 0, closed: 0 });
    expect((await call('GET', '/api/tickets?q=rausstellen')).json()).toHaveLength(2);
  });

  it('previews events with their ticket state', async () => {
    const { events, types } = (await call('GET', `/api/calendars/${id}/events`)).json();
    expect(types.map((x: { name: string }) => x.name)).toEqual(['Biotonne', 'Gelber Sack', 'Papier', 'Restmüll']);
    expect(events.map((e: { summary: string }) => e.summary)).toEqual(['Papier', 'Restmüll', 'Gelber Sack', 'Biotonne']);
    expect(events[3]).toMatchObject({ imported: false, ticketTitle: 'Biotonne rausstellen', createFrom: day(26) });
    expect(events[1]).toMatchObject({ imported: true, ticketStatus: 'open' });
  });

  it('updates open tickets when title or due date settings change', async () => {
    await call('PATCH', `/api/calendars/${id}`, { leadDays: 0, titleTemplate: '{title} am {date} raus' });
    const sack = (await call('GET', '/api/tickets?q=Gelber Sack')).json()[0];
    const [, m, d] = day(10).split('-');
    expect(sack).toMatchObject({ title: `Gelber Sack am ${d}.${m}. raus`, due: day(10) });
    await call('PATCH', `/api/calendars/${id}`, source);
  });

  it('closes open tickets once the event day is over', async () => {
    // Move the Restmüll pickup into the past.
    await t.db.query("UPDATE calendar_imports SET event_date = current_date - 1 WHERE event_key LIKE '%|Restmüll'");
    expect((await call('POST', `/api/calendars/${id}/sync`)).json().closed).toBe(1);
    expect((await call('GET', '/api/tickets?q=Restmüll rausstellen')).json()[0].status).toBe('done');
  });

  it('reports Home Assistant errors on the source', async () => {
    ha.fail = true;
    expect((await call('POST', `/api/calendars/${id}/sync`)).statusCode).toBe(502);
    expect((await call('GET', '/api/calendars')).json()[0].lastError).toContain('500');
    ha.fail = false;
    await call('POST', `/api/calendars/${id}/sync`);
    expect((await call('GET', '/api/calendars')).json()[0].lastError).toBeNull();
  });

  it('skips excluded waste types and brings them back when switched on again', async () => {
    const before = (await call('GET', '/api/tickets?q=Gelber Sack')).json();
    expect(before).toHaveLength(1);
    const res = await call('PATCH', `/api/calendars/${id}`, { excludedTypes: ['Gelber Sack'] });
    expect(res.json().excludedTypes).toEqual(['Gelber Sack']);
    expect((await call('GET', '/api/tickets?q=Gelber Sack')).json()).toHaveLength(0);
    expect((await call('POST', `/api/calendars/${id}/sync`)).json().created).toBe(0);
    const preview = (await call('GET', `/api/calendars/${id}/events`)).json();
    expect(preview.events.some((e: { summary: string }) => e.summary === 'Gelber Sack')).toBe(false);
    expect(preview.types.find((x: { name: string }) => x.name === 'Gelber Sack').excluded).toBe(true);

    await call('PATCH', `/api/calendars/${id}`, { excludedTypes: [] });
    expect((await call('GET', '/api/tickets?q=Gelber Sack')).json()).toHaveLength(1);
  });

  it('rejects linking the same calendar twice', async () => {
    expect((await call('POST', '/api/calendars', source)).statusCode).toBe(409);
  });
});

describe('due date', () => {
  it('is the day before the pickup, for all-day and timed events', async () => {
    ha.calendars.set('calendar.zweiter', [
      { summary: 'Restabfall', start: { date: day(7) } },
      // Timed event at local midnight, as some calendars deliver all-day dates
      { summary: 'Papier', start: { dateTime: `${day(8)}T00:00:00+01:00` } },
    ]);
    await call('POST', '/api/calendars', { ...source, entityId: 'calendar.zweiter', name: 'Zweiter', titleTemplate: '{title} 2' });
    const tickets = (await call('GET', '/api/tickets?q= 2')).json();
    expect(tickets.find((x: { title: string }) => x.title === 'Restabfall 2').due).toBe(day(6));
    expect(tickets.find((x: { title: string }) => x.title === 'Papier 2').due).toBe(day(7));
  });
});

describe('ticketTitle', () => {
  it('fills title and date', () => {
    expect(ticketTitle('{title} am {date} rausstellen', 'Papier', '2026-11-03')).toBe('Papier am 03.11. rausstellen');
  });
});

describe('calendar due time', () => {
  it('gives the calendar tickets a time of day', async () => {
    const [source] = (await call('GET', '/api/calendars')).json();
    await call('PATCH', `/api/calendars/${source.id}`, { dueTime: '19:00' });
    const open = (await call('GET', '/api/tickets?q=rausstellen&open=true')).json();
    expect(open.length).toBeGreaterThan(0);
    expect(open.every((x: { dueTime: string }) => x.dueTime === '19:00')).toBe(true);
  });
});

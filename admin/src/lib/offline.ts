// Offline support for the app: changes made without a connection wait in an outbox (localStorage) and are sent
// in order once Tasklog answers again. Until then the data the service worker kept is shown with them applied,
// so a ticket ticked off offline looks ticked off. Tickets created offline get a temporary negative id that is
// swapped for the real one after sending.

import type { Area, ChecklistItem, Me, Person, RunningTimer, Ticket, TicketNote } from './types';

export interface Op {
  id: string;
  method: string;
  path: string;
  body?: Record<string, unknown>;
  /** When it was done, ISO. */
  at: string;
  /** For a ticket created offline: its temporary id. */
  tempId?: number;
}

export interface OfflineState {
  /** Tasklog did not answer the last time it was asked. */
  offline: boolean;
  /** When the shown data was last fetched live, while offline. */
  dataFrom: string | null;
  pending: number;
  syncing: boolean;
}

const OUTBOX = 'tasklog-outbox';
const IDS = 'tasklog-temp-ids';
const NEXT = 'tasklog-temp-next';

let enabled = false;
/** Only the app queues changes; the admin UI shows errors as before. */
export function enableOffline() {
  enabled = true;
}
export const offlineEnabled = () => enabled;

const read = <T,>(key: string, fallback: T): T => {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
};
const write = (key: string, value: unknown) => {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage full or blocked: the change stays in memory until the app closes.
  }
};

let outbox: Op[] = read<Op[]>(OUTBOX, []);
/** Temporary id → real id, for tickets created offline and sent since. */
let ids: Record<string, number> = read<Record<string, number>>(IDS, {});
let state: OfflineState = { offline: false, dataFrom: null, pending: outbox.length, syncing: false };
const listeners = new Set<() => void>();

const emit = (change: Partial<OfflineState>) => {
  state = { ...state, ...change, pending: outbox.length };
  listeners.forEach(l => l());
};
export const getOfflineState = () => state;
export function subscribeOffline(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
export function setOffline(offline: boolean, dataFrom: string | null = null) {
  if (offline !== state.offline || dataFrom !== state.dataFrom) emit({ offline, dataFrom: offline ? dataFrom ?? state.dataFrom : null });
}
const saveOutbox = () => { write(OUTBOX, outbox); emit({}); };

/** Signed out: nothing personal stays behind. */
export function clearOffline() {
  outbox = [];
  ids = {};
  write(OUTBOX, []);
  write(IDS, {});
  emit({});
  navigator.serviceWorker?.controller?.postMessage('tasklog:clear');
}

// — what the app knows, for building temporary data —

const known: { areas: Area[]; people: Person[]; me: Me | null; titles: Record<number, string> } = { areas: [], people: [], me: null, titles: {} };

/** Remembers names from answers, so offline tickets show their area and timers their title. */
export function remember(path: string, data: unknown) {
  if (path === '/api/areas' && Array.isArray(data)) known.areas = data as Area[];
  else if (path === '/api/people' && Array.isArray(data)) known.people = data as Person[];
  else if (path === '/api/me' && data && typeof data === 'object') known.me = data as Me;
  else if (/^\/api\/tickets(\?|$)/.test(path) && Array.isArray(data)) for (const t of data as Ticket[]) known.titles[t.id] = t.title;
  else if (/^\/api\/tickets\/\d+$/.test(path) && data && typeof data === 'object') known.titles[(data as Ticket).id] = (data as Ticket).title;
}

// — temporary ids —

const TEMP = /\/(-\d+)(?=\/|$|\?)/g;
/** Swaps temporary ids that have a real one by now. */
export function realPath(path: string) {
  return path.replace(TEMP, (m, id: string) => (ids[id] ? `/${ids[id]}` : m));
}
const hasTemp = (path: string) => /\/-\d+(\/|$|\?)/.test(path);
const realId = (id: unknown) => (typeof id === 'number' && id < 0 && ids[String(id)] ? ids[String(id)] : id);
function nextTemp() {
  const n = read<number>(NEXT, -1);
  write(NEXT, n - 1);
  return n;
}

// — what can wait —

const QUEUEABLE: [string, RegExp][] = [
  ['POST', /^\/api\/tickets$/],
  ['PATCH', /^\/api\/tickets\/-?\d+$/],
  ['DELETE', /^\/api\/tickets\/-?\d+$/],
  ['POST', /^\/api\/tickets\/-?\d+\/(notes|checklist|time|timer)$/],
  ['PATCH', /^\/api\/checklist\/-?\d+$/],
  ['DELETE', /^\/api\/checklist\/-?\d+$/],
  ['DELETE', /^\/api\/notes\/-?\d+$/],
  ['POST', /^\/api\/timer\/stop$/],
  ['PUT', /^\/api\/me\/areas$/],
];
export const queueable = (method: string, path: string) => enabled && QUEUEABLE.some(([m, re]) => m === method && re.test(path.split('?')[0]));
/** Waits behind earlier changes so the order stays, e.g. a note on a ticket created offline. */
export const mustWait = (method: string, path: string) => queueable(method, path) && (outbox.length > 0 || hasTemp(path));

const STAMPED = /\/(timer|time)$|^\/api\/timer\/stop$/;

/** Puts a change in the outbox and answers like Tasklog would have. */
export function enqueue(method: string, path: string, body?: unknown): unknown {
  const at = new Date().toISOString();
  const op: Op = { id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, method, path, at, body: body as Record<string, unknown> | undefined };
  // Timers and time count from when it happened, not from when it is sent.
  if (STAMPED.test(path)) op.body = { ...(op.body ?? {}), at };
  let answer: unknown = {};
  if (method === 'POST' && path === '/api/tickets') {
    op.tempId = nextTemp();
    answer = tempTicket(op);
  } else if (method === 'POST' && path.endsWith('/notes')) {
    answer = { id: nextTemp(), body: op.body?.body, createdAt: at, userId: known.me?.id ?? null, user: known.me?.name ?? null };
  }
  outbox.push(op);
  saveOutbox();
  return answer;
}

// — showing the outbox in the data —

function tempTicket(op: Op): Ticket {
  const b = op.body ?? {};
  const areaId = Number(b.areaId);
  const assigneeId = b.assigneeId === undefined ? known.me?.id ?? null : (b.assigneeId as number | null);
  return {
    id: op.tempId!, title: String(b.title ?? ''), description: String(b.description ?? ''), status: (b.status as Ticket['status']) ?? 'open',
    prio: (b.prio as Ticket['prio']) ?? 'normal', due: (b.due as string) ?? null, dueTime: (b.dueTime as string) ?? null, source: 'app',
    areaId, area: known.areas.find(a => a.id === areaId)?.name ?? '', projectId: (b.projectId as number) ?? null, project: null,
    assigneeId, assignee: known.people.find(p => p.id === assigneeId)?.name ?? (assigneeId === known.me?.id ? known.me?.name ?? null : null),
    minutes: 0, seconds: 0, running: false, createdAt: op.at, doneAt: null, recurrence: (b.recurrence as Ticket['recurrence']) ?? null, followupId: null,
    checkTotal: 0, checkDone: 0, photos: 0, autoClose: (b.autoClose as Ticket['autoClose']) ?? null,
  };
}

const idOf = (path: string, re: RegExp) => Number(path.match(re)?.[1]);
const sameId = (a: number, b: number) => a === b || realId(a) === b || a === realId(b);

function patchTicket(t: Ticket, b: Record<string, unknown>, at: string): Ticket {
  const next = { ...t, ...(b as Partial<Ticket>) };
  if ('areaId' in b) next.area = known.areas.find(a => a.id === b.areaId)?.name ?? t.area;
  if ('assigneeId' in b) next.assignee = known.people.find(p => p.id === b.assigneeId)?.name ?? null;
  if ('due' in b && b.due === null) next.dueTime = null;
  if (b.status === 'done') { next.doneAt = at; next.running = false; }
  else if (b.status) next.doneAt = null;
  return next;
}

/** One ticket as it looks with the outbox applied, or null when deleted. */
function applyToTicket(t: Ticket | null, ticketId: number): Ticket | null {
  let cur = t;
  for (const op of outbox) {
    if (op.tempId !== undefined && sameId(op.tempId, ticketId)) cur = tempTicket(op);
    if (!cur) continue;
    const target = idOf(op.path, /^\/api\/tickets\/(-?\d+)/);
    if (!sameId(target, ticketId)) {
      if (op.path === '/api/timer/stop' && (!op.body?.ticketId || sameId(Number(op.body.ticketId), ticketId))) cur = { ...cur, running: false };
      continue;
    }
    if (op.method === 'PATCH') cur = patchTicket(cur, op.body ?? {}, op.at);
    else if (op.method === 'DELETE') return null;
    else if (op.path.endsWith('/timer')) cur = { ...cur, running: true, status: cur.status === 'open' ? 'inProgress' : cur.status };
    else if (op.path.endsWith('/time')) cur = { ...cur, minutes: cur.minutes + Number(op.body?.minutes ?? 0), seconds: (cur.seconds ?? 0) + Number(op.body?.minutes ?? 0) * 60 };
    else if (op.path.endsWith('/checklist')) {
      const n = String(op.body?.text ?? '').split('\n').filter(l => l.trim()).length;
      cur = { ...cur, checkTotal: cur.checkTotal + n };
    }
  }
  return cur;
}

function applyToList(path: string, list: Ticket[]): Ticket[] {
  const q = new URLSearchParams(path.split('?')[1] ?? '');
  const created = outbox.filter(op => op.tempId !== undefined && !list.some(t => sameId(op.tempId!, t.id))).map(op => tempTicket(op));
  return [...list, ...created]
    .map(t => applyToTicket(t, t.id))
    .filter((t): t is Ticket => Boolean(t))
    .filter(t => (q.get('open') === 'true' ? t.status !== 'done' : q.get('open') === 'false' ? t.status === 'done' : true))
    .filter(t => !q.get('areaId') || t.areaId === Number(q.get('areaId')))
    .filter(t => !q.get('q') || t.title.toLowerCase().includes(q.get('q')!.toLowerCase()));
}

function applyToChecklist(ticketId: number, items: ChecklistItem[]): ChecklistItem[] {
  let cur = [...items];
  for (const op of outbox) {
    if (op.method === 'POST' && sameId(idOf(op.path, /^\/api\/tickets\/(-?\d+)\/checklist$/), ticketId)) {
      const lines = String(op.body?.text ?? '').split('\n').map(l => l.trim()).filter(Boolean);
      cur = [...cur, ...lines.map((text, i) => ({ id: -(Date.parse(op.at) % 1e9) - i, text, done: false, position: cur.length + i }))];
    }
    const itemId = idOf(op.path, /^\/api\/checklist\/(-?\d+)$/);
    if (op.method === 'PATCH' && itemId) cur = cur.map(i => (i.id === itemId ? { ...i, ...(op.body as Partial<ChecklistItem>) } : i));
    if (op.method === 'DELETE' && itemId) cur = cur.filter(i => i.id !== itemId);
  }
  return cur;
}

function applyToNotes(ticketId: number, notes: TicketNote[]): TicketNote[] {
  let cur = [...notes];
  for (const op of outbox) {
    if (op.method === 'POST' && sameId(idOf(op.path, /^\/api\/tickets\/(-?\d+)\/notes$/), ticketId)) {
      cur = [...cur, { id: -(Date.parse(op.at) % 1e9), body: String(op.body?.body ?? ''), createdAt: op.at, userId: known.me?.id ?? null, user: known.me?.name ?? null }];
    }
    const noteId = idOf(op.path, /^\/api\/notes\/(-?\d+)$/);
    if (op.method === 'DELETE' && noteId) cur = cur.filter(n => n.id !== noteId);
  }
  return cur;
}

function applyToTimers(timers: RunningTimer[]): RunningTimer[] {
  let cur = [...timers];
  for (const op of outbox) {
    const started = idOf(op.path, /^\/api\/tickets\/(-?\d+)\/timer$/);
    if (started) {
      cur = cur.filter(x => !sameId(x.ticketId, started));
      cur.unshift({ id: -(Date.parse(op.at) % 1e9), ticketId: started, title: known.titles[started] ?? known.titles[realId(started) as number] ?? '…', startedAt: String(op.body?.at ?? op.at) });
    } else if (op.path === '/api/timer/stop') {
      cur = op.body?.ticketId ? cur.filter(x => !sameId(x.ticketId, Number(op.body!.ticketId))) : [];
    } else if (op.method === 'PATCH' && op.body?.status === 'done') {
      const id = idOf(op.path, /^\/api\/tickets\/(-?\d+)$/);
      cur = cur.filter(x => !sameId(x.ticketId, id));
    }
  }
  return cur;
}

/** The answer for `path` with the outbox applied. */
export function overlay<T>(path: string, data: T): T {
  if (!outbox.length) return data;
  const p = path.split('?')[0];
  if (p === '/api/tickets' && Array.isArray(data)) return applyToList(path, data as Ticket[]) as T;
  let m = p.match(/^\/api\/tickets\/(-?\d+)$/);
  if (m) return (applyToTicket(data as Ticket | null, Number(m[1])) ?? data) as T;
  if ((m = p.match(/^\/api\/tickets\/(-?\d+)\/checklist$/)) && Array.isArray(data)) return applyToChecklist(Number(m[1]), data as ChecklistItem[]) as T;
  if ((m = p.match(/^\/api\/tickets\/(-?\d+)\/notes$/)) && Array.isArray(data)) return applyToNotes(Number(m[1]), data as TicketNote[]) as T;
  if (p === '/api/timer' && Array.isArray(data)) return applyToTimers(data as RunningTimer[]) as T;
  if (p === '/api/me/areas') {
    const last = [...outbox].reverse().find(op => op.path === '/api/me/areas');
    if (last) return last.body as T;
  }
  return data;
}

/** Answers for tickets that so far exist only on this device. */
export function localAnswer(path: string): { found: boolean; data?: unknown } {
  if (!hasTemp(path)) return { found: false };
  const p = path.split('?')[0];
  let m = p.match(/^\/api\/tickets\/(-?\d+)$/);
  if (m) {
    const t = applyToTicket(null, Number(m[1]));
    return t ? { found: true, data: t } : { found: false };
  }
  if ((m = p.match(/^\/api\/tickets\/(-?\d+)\/(checklist|notes|history|attachments)$/))) {
    const id = Number(m[1]);
    return { found: true, data: m[2] === 'checklist' ? applyToChecklist(id, []) : m[2] === 'notes' ? applyToNotes(id, []) : [] };
  }
  if (p === '/api/tags') return { found: true, data: [] };
  return { found: false };
}

// — sending —

let flushing: Promise<{ sent: number; failed: string[] }> | null = null;
const syncedListeners = new Set<(result: { sent: number; failed: string[] }) => void>();
/** Called after each send, e.g. to reload the data and say what got through. */
export function onSynced(listener: (result: { sent: number; failed: string[] }) => void) {
  syncedListeners.add(listener);
  return () => { syncedListeners.delete(listener); };
}

/** Sends the outbox in order. Stops at the first change that cannot get through yet; drops ones Tasklog refuses. */
export function flush(): Promise<{ sent: number; failed: string[] }> {
  if (flushing) return flushing;
  if (!outbox.length) return Promise.resolve({ sent: 0, failed: [] });
  flushing = (async () => {
    emit({ syncing: true });
    let sent = 0;
    const failed: string[] = [];
    while (outbox.length) {
      const op = outbox[0];
      const path = realPath(op.path);
      if (hasTemp(path)) {
        // Its ticket never reached Tasklog.
        outbox.shift();
        saveOutbox();
        continue;
      }
      const body = op.body && 'ticketId' in op.body ? { ...op.body, ticketId: realId(op.body.ticketId) } : op.body;
      let res: Response;
      try {
        res = await fetch(path, {
          method: op.method,
          credentials: 'same-origin',
          headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
          body: body === undefined ? undefined : JSON.stringify(body),
          signal: AbortSignal.timeout(15_000),
        });
      } catch {
        setOffline(true);
        break;
      }
      // Signed out, or Tasklog has a problem right now: try again later.
      if (res.status === 401 || res.status >= 500 || res.status === 429) break;
      if (res.ok) {
        if (op.tempId !== undefined) {
          const made = (await res.json().catch(() => null)) as { id?: number } | null;
          if (made?.id) { ids[String(op.tempId)] = made.id; write(IDS, ids); }
        }
        sent++;
      } else {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        failed.push(`${data?.error ?? res.status}`);
      }
      outbox.shift();
      saveOutbox();
      setOffline(false);
    }
    const result = { sent, failed };
    if (sent || failed.length) syncedListeners.forEach(l => l(result));
    return result;
  })().finally(() => {
    flushing = null;
    emit({ syncing: false });
  });
  return flushing;
}

import type { ApiToken, Area, Entity, LogEntry, Rule, Session, Ticket, Toggle, User } from './types';

// Sample data until the Tasklog API exists.

export const tickets: Ticket[] = [
  { id: 1, title: 'Wärmepumpe: Filter reinigen', area: 'Zuhause', project: 'Haus & Technik', status: 'inProgress', prio: 'high', assignee: 'Max', due: 'Heute', hours: 0.4, fromHa: true },
  { id: 2, title: 'Steuererklärung 2025 abgeben', area: 'Zuhause', project: 'Finanzen', status: 'inProgress', prio: 'high', assignee: 'Max', due: 'Heute', hours: 0.75 },
  { id: 3, title: 'Sprint-Review vorbereiten', area: 'Arbeit', project: 'Sprint 42', status: 'open', prio: 'normal', assignee: 'Anna', due: 'Heute', hours: 1.5 },
  { id: 4, title: 'Rauchmelder Batterien tauschen', area: 'Zuhause', project: 'Haus & Technik', status: 'open', prio: 'normal', assignee: 'Max', due: 'Sa', hours: 0 },
  { id: 5, title: 'API-Doku Auth-Flow ergänzen', area: 'Arbeit', project: 'Plattform / Auth', status: 'inProgress', prio: 'normal', assignee: 'Jonas', due: 'Fr', hours: 6.5 },
  { id: 6, title: 'Hecke schneiden', area: 'Zuhause', project: 'Garten', status: 'done', prio: 'normal', assignee: 'Max', due: '–', hours: 1 },
  { id: 7, title: 'Code-Review PR #482', area: 'Arbeit', project: 'Plattform / Auth', status: 'done', prio: 'normal', assignee: 'Anna', due: '–', hours: 0.5 },
  { id: 8, title: 'NAS überhitzt', area: 'Arbeit', project: 'Plattform / Auth', status: 'open', prio: 'high', assignee: 'Jonas', due: 'Heute', hours: 0.2, fromHa: true },
];

export const areas: Area[] = [
  { name: 'Arbeit', icon: 'briefcase', prio: 'normal', projects: [{ name: 'Plattform / Auth', open: 4 }, { name: 'Sprint 42', open: 3 }] },
  { name: 'Zuhause', icon: 'house', prio: 'normal', projects: [{ name: 'Haus & Technik', open: 3 }, { name: 'Garten', open: 2 }, { name: 'Finanzen', open: 1 }] },
];

export const rules: Rule[] = [
  { name: 'Filterdruck zu hoch', entity: 'sensor.filterdruck', cond: '> 1.8', join: 'and', cond2: '', window: '00:00–23:59', title: 'Wärmepumpe: Filter reinigen', area: 'Zuhause', prio: 'high', onEnd: 'close', dedupe: true, enabled: true },
  { name: 'Müllabfuhr morgen', entity: 'calendar.muell', cond: 'in 1 Tag', join: 'and', cond2: '', window: '17:00–21:00', title: 'Müll rausstellen', area: 'Zuhause', prio: 'normal', onEnd: 'close', dedupe: true, enabled: true },
  { name: 'Fenster lange offen', entity: 'binary_sensor.fenster', cond: 'on > 2 h', join: 'and', cond2: 'sensor.aussen_temp < 5', window: '00:00–23:59', title: 'Fenster schließen', area: 'Zuhause', prio: 'normal', onEnd: 'keepOpen', dedupe: false, enabled: false },
  { name: 'Server-Alarm', entity: 'sensor.nas_temp', cond: '> 60', join: 'or', cond2: 'sensor.nas_fan = 0', window: '00:00–23:59', title: 'NAS überhitzt', area: 'Arbeit', prio: 'high', onEnd: 'close', dedupe: true, enabled: true },
];

export const users: User[] = [
  { name: 'Max Mustermann', mail: 'max@example.com', group: 'tasklog-admins', role: 'admin', seen: 'jetzt' },
  { name: 'Anna Beispiel', mail: 'anna@example.com', group: 'tasklog-team', role: 'member', seen: 'vor 12 min' },
  { name: 'Jonas Test', mail: 'jonas@example.com', group: 'tasklog-team', role: 'member', seen: 'gestern' },
  { name: 'Lea Gast', mail: 'lea@example.com', group: 'tasklog-guests', role: 'read', seen: 'vor 3 Tagen' },
];

export const groupMap: [string, User['role']][] = [
  ['tasklog-admins', 'admin'],
  ['tasklog-team', 'member'],
  ['tasklog-guests', 'read'],
];

export const sessions: Session[] = [
  { device: 'iPhone 15 · Tasklog App', where: 'Max · Berlin · jetzt', icon: 'device-mobile' },
  { device: 'Chrome · Admin UI', where: 'Max · Berlin · jetzt', icon: 'desktop' },
  { device: 'Wanddisplay · Monitor-Link', where: 'Flur · seit 12 Tagen', icon: 'monitor' },
];

export const tokens: ApiToken[] = [
  { name: 'Home Assistant', key: 'tl_live_8f3c••••', scope: 'tickets:write' },
  { name: 'Monitor', key: 'tl_ro_9d2e••••', scope: 'read' },
];

export const logs: LogEntry[] = [
  { time: '13:30', dir: 'in', what: 'Webhook: ungültiges Token', status: 'rejected' },
  { time: '12:03', dir: 'out', what: 'sensor.tasklog_open_tickets = 12', status: 'sent' },
  { time: '09:15', dir: 'in', what: 'Regel „Fenster lange offen“ übersprungen (deaktiviert)', status: 'ignored' },
  { time: '08:40', dir: 'out', what: 'binary_sensor.tasklog_timer_running = on', status: 'sent' },
  { time: '07:12', dir: 'in', what: 'Ticket „Wärmepumpe: Filter reinigen“ erstellt', status: 'done' },
  { time: '06:58', dir: 'out', what: 'sensor.tasklog_next_due: Zeitüberschreitung', status: 'error' },
];

export const entities: Entity[] = [
  { id: 'sensor.tasklog_open_tickets', desc: 'openTickets', enabled: true },
  { id: 'sensor.tasklog_today_time', desc: 'todayTime', enabled: true },
  { id: 'binary_sensor.tasklog_timer_running', desc: 'timerRunning', enabled: true },
  { id: 'binary_sensor.tasklog_overdue', desc: 'overdue', enabled: false },
  { id: 'sensor.tasklog_next_due', desc: 'nextDue', enabled: true },
];

export const notifications: Toggle[] = [
  { key: 'dueSoon', enabled: true },
  { key: 'haCreated', enabled: true },
  { key: 'weeklyReport', enabled: false },
  { key: 'dailyDigest', enabled: true },
];

export const widgets: Toggle[] = [
  { key: 'clock', enabled: true },
  { key: 'timer', enabled: true },
  { key: 'next', enabled: true },
  { key: 'later', enabled: false },
  { key: 'haSensors', enabled: true },
];

export const timeRules: Toggle[] = [
  { key: 'autoStop', enabled: true },
  { key: 'longTimer', enabled: false },
  { key: 'singleTimer', enabled: true },
];

export const monitorPreview: [string, string][] = [
  ['15:30', 'Sprint-Review vorbereiten'],
  ['17:00', 'Steuererklärung abgeben'],
  ['18:30', 'Rauchmelder tauschen'],
  ['20:00', 'Müll rausstellen'],
];

// Shapes returned by the Tasklog API (server/src/routes).

export type TicketStatus = 'open' | 'inProgress' | 'done';
export type Prio = 'normal' | 'high';
export type Role = 'admin' | 'member' | 'read';
export type LogStatus = 'rejected' | 'sent' | 'ignored' | 'done' | 'error';

export interface Me {
  kind: 'user' | 'token';
  id?: number;
  name?: string;
  email?: string;
  role?: Role;
  authMode: 'oidc' | 'dev';
}

export interface Ticket {
  id: number;
  title: string;
  description: string;
  status: TicketStatus;
  prio: Prio;
  due: string | null;
  /** 'HH:MM', or null for the whole day. */
  dueTime: string | null;
  source: 'manual' | 'app' | 'ha' | 'mail';
  areaId: number;
  area: string;
  projectId: number | null;
  project: string | null;
  assigneeId: number | null;
  assignee: string | null;
  minutes: number;
  /** Exact tracked time, for "to the second". */
  seconds: number;
  running: boolean;
  createdAt: string;
  doneAt: string | null;
  recurrence: Recurrence | null;
  /** The next ticket of the series, once this one is done. */
  followupId: number | null;
  checkTotal: number;
  checkDone: number;
  photos: number;
  /** Closes itself when this Home Assistant entity changes to this state. */
  autoClose: { entity: string; state: string } | null;
}

export interface Attachment {
  id: number;
  fileName: string;
  mime: string;
  size: number;
  createdAt: string;
  userId: number | null;
  user: string | null;
}

export interface ChecklistItem {
  id: number;
  text: string;
  done: boolean;
  position: number;
}

/** How a ticket repeats; weekdays 1 = Monday … 7 = Sunday. */
export interface Recurrence {
  every: number;
  unit: 'day' | 'week' | 'month' | 'year';
  weekdays?: number[];
  monthDay?: number;
  fromDone?: boolean;
}

export interface Area {
  id: number;
  name: string;
  icon: string;
  defaultPrio: Prio;
  projects: { id: number; name: string; open: number }[];
}

export interface Rule {
  id: number;
  name: string;
  entity: string;
  cond: string;
  join: 'and' | 'or';
  cond2: string;
  window: string;
  title: string;
  areaId: number;
  area: string;
  prio: Prio;
  onEnd: 'close' | 'keepOpen';
  dedupe: boolean;
  enabled: boolean;
  translatable: boolean;
}

export interface RuleTest {
  ticket: { title: string; area: string; prio: Prio };
  wouldCreate: boolean;
  enabled: boolean;
  duplicateOf: { id: number; title: string } | null;
  haTemplate: string | null;
  holdFor: string | null;
}

export interface User {
  id: number;
  name: string;
  email: string;
  group: string | null;
  role: Role;
  roleOverride: boolean;
  lastSeenAt: string | null;
}

export interface Session {
  id: string;
  device: string;
  user: string;
  lastSeenAt: string;
  current: boolean;
}

export interface ApiToken {
  id: number;
  name: string;
  prefix: string;
  scope: 'read' | 'tickets:write' | 'admin';
  lastUsedAt: string | null;
  token?: string;
}

export interface LogEntry {
  id: number;
  at: string;
  direction: 'in' | 'out';
  message: string;
  status: LogStatus;
  retryable: boolean;
}

export interface Entity {
  id: string;
  enabled: boolean;
  lastState: string | null;
}

export interface Settings {
  notifications: { dueSoon: boolean; haCreated: boolean; weeklyReport: boolean; dailyDigest: boolean };
  channel: 'push' | 'haNotify' | 'email';
  quietFrom: string;
  quietTo: string;
  widgets: { clock: boolean; timer: boolean; next: boolean; later: boolean; haSensors: boolean };
  monitorInterval: 15 | 30 | 60;
  monitorToken: string;
  timeRules: { autoStop: boolean; longTimer: boolean; singleTimer: boolean };
  /** Minutes a stopped timer is rounded up to; 0 = to the second. */
  rounding: number;
  enforceSignature: boolean;
  webhookId: string;
  ha: { url: string; hasToken: boolean };
  lastBackupAt: string | null;
  legal: { imprint: string; privacy: string };
  retention: { logDays: number; doneTicketsDays: number };
}

export interface HaInfo {
  url: string;
  hasToken: boolean;
  webhookUrl: string;
  enforceSignature: boolean;
}

export interface SystemInfo {
  version: string;
  database: string;
  jobs: number;
  ha: { configured: boolean };
  auth: { mode: 'oidc' | 'dev'; issuer: string | null; clientId: string | null };
  language: string;
  timezone: string;
  lastBackupAt: string | null;
  monitorUrl: string;
  exactTime: boolean;
}

export interface Overview {
  openTickets: number;
  dueToday: number;
  fromHa30d: number;
  activeRules: number;
  totalRules: number;
  webhook: { lastAt: string; ok: boolean } | null;
}

export interface MonitorData {
  now: string;
  /** Name of the area the monitor is limited to, null for all areas. */
  area: string | null;
  interval: number;
  widgets: Settings['widgets'];
  openTickets: number;
  todayMinutes: number;
  todaySeconds: number;
  exactTime: boolean;
  timer: { title: string; area: string; source: string; startedAt: string; user: string | null } | null;
  next: MonitorItem[];
  later: MonitorItem[];
  sensors: { entity: string; state: string; unit?: string; name?: string }[];
}

export interface CalendarSource {
  id: number;
  entityId: string;
  name: string;
  areaId: number;
  titleTemplate: string;
  leadDays: number;
  dueTime: string | null;
  lookaheadDays: number;
  prio: Prio;
  autoClose: boolean;
  enabled: boolean;
  excludedTypes: string[];
  lastSyncAt: string | null;
  lastError: string | null;
}

export interface CalendarPreview {
  events: CalendarEventPreview[];
  /** All event titles in the next weeks, with whether they are switched off. */
  types: { name: string; excluded: boolean }[];
}

export interface CalendarEventPreview {
  date: string;
  summary: string;
  ticketTitle: string;
  due: string;
  dueTime: string | null;
  imported: boolean;
  ticketId: number | null;
  ticketStatus: TicketStatus | null;
  createFrom: string;
}

export interface RunningTimer {
  id: number;
  ticketId: number;
  title: string;
  startedAt: string;
}

export interface TicketNote {
  id: number;
  body: string;
  createdAt: string;
  userId: number | null;
  user: string | null;
}

export interface HistoryEvent {
  at: string;
  kind: 'created' | 'createdByHa' | 'createdByMail' | 'timerStarted' | 'timerStopped' | 'timeAdded' | 'done';
  user?: string | null;
  minutes?: number;
}

export interface MyTime {
  today: { total: number; totalSeconds: number; byArea: { name: string; icon: string; minutes: number; seconds: number }[] };
  week: { total: number; totalSeconds: number; days: { date: string; minutes: number; seconds: number }[]; byArea: { name: string; icon: string; minutes: number; seconds: number }[] };
  top: { id: number; title: string; minutes: number; seconds: number }[];
}

export interface AuthInfo {
  mode: 'oidc' | 'dev';
  issuer: string | null;
}

export interface MonitorItem {
  id: number;
  title: string;
  area: string;
  prio: Prio;
  overdue: boolean;
  dueTime: string | null;
}

export interface MailAccount {
  id: number;
  name: string;
  host: string;
  port: number;
  tls: 'tls' | 'starttls' | 'none';
  username: string;
  hasPassword: boolean;
  mailbox: string;
  pollMinutes: number;
  onlyUnseen: boolean;
  afterImport: 'seen' | 'move' | 'delete' | 'none';
  moveTo: string;
  enabled: boolean;
  lastPollAt: string | null;
  lastError: string | null;
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
  splitExclude: string;
  titleTemplate: string;
  descriptionTemplate: string;
  areaId: number | null;
  prio: Prio;
  dueMode: 'none' | 'days' | 'detect';
  dueDays: number;
  dueTime: string | null;
  continueAfter: boolean;
}

export interface MailPlan {
  result: 'created' | 'ignored' | 'nomatch';
  ruleIds: number[];
  tickets: { ruleId: number; title: string; description: string; due: string | null; dueTime: string | null; prio: Prio }[];
}

export interface MailPreview {
  fromAddress: string;
  fromName: string;
  subject: string;
  date: string;
  seen: boolean;
  imported: boolean;
  plan: MailPlan;
}

export interface MailImportEntry {
  id: number;
  createdAt: string;
  from: string;
  subject: string;
  result: 'created' | 'ignored' | 'nomatch' | 'error';
  rules: string[];
  ticketIds: number[];
}

/** Someone a ticket can be assigned to. */
export interface Person {
  id: number;
  name: string;
}

/** An NFC tag (or QR code): scanning it closes a ticket, starts/stops its timer or creates a ticket. */
export interface Tag {
  id: number;
  code: string;
  name: string;
  action: 'done' | 'timer' | 'create';
  ticketId: number | null;
  ticket: string | null;
  ticketStatus: TicketStatus | null;
  title: string | null;
  areaId: number | null;
  area: string | null;
  prio: Prio;
  haTagId: string | null;
  scans: number;
  lastScanAt: string | null;
  lastScanBy: string | null;
}

export interface TagScan {
  tag: string;
  tagId: number;
  action: Tag['action'];
  result: 'done' | 'alreadyDone' | 'started' | 'stopped' | 'created' | 'exists' | 'missing';
  ticketId?: number;
  title?: string;
  followupId?: number | null;
}

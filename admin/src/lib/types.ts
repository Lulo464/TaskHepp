export type TicketStatus = 'open' | 'inProgress' | 'done';
export type Prio = 'normal' | 'high';
export type Role = 'admin' | 'member' | 'read';
export type Join = 'and' | 'or';
export type OnEnd = 'close' | 'keepOpen';
export type LogDirection = 'in' | 'out';
export type LogStatus = 'rejected' | 'sent' | 'ignored' | 'done' | 'error';

export interface Ticket {
  id: number;
  title: string;
  area: string;
  project: string;
  status: TicketStatus;
  prio: Prio;
  assignee: string;
  due: string;
  hours: number;
  fromHa?: boolean;
}

export interface Project {
  name: string;
  open: number;
}

export interface Area {
  name: string;
  icon: string;
  prio: Prio;
  projects: Project[];
}

export interface Rule {
  name: string;
  entity: string;
  cond: string;
  join: Join;
  cond2: string;
  window: string;
  title: string;
  area: string;
  prio: Prio;
  onEnd: OnEnd;
  dedupe: boolean;
  enabled: boolean;
}

export interface User {
  name: string;
  mail: string;
  group: string;
  role: Role;
  seen: string;
}

export interface Session {
  device: string;
  where: string;
  icon: string;
}

export interface ApiToken {
  name: string;
  key: string;
  scope: string;
}

export interface LogEntry {
  time: string;
  dir: LogDirection;
  what: string;
  status: LogStatus;
}

export interface Entity {
  id: string;
  /** i18n key for the description */
  desc: string;
  enabled: boolean;
}

export interface Toggle {
  /** i18n key prefix: `<key>.title` / `<key>.desc` */
  key: string;
  enabled: boolean;
}

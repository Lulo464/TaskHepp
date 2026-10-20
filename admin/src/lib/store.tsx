import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import * as mock from './mockData';
import type { ApiToken, Area, Entity, LogEntry, Rule, Session, Ticket, Toggle, User } from './types';

export interface AdminState {
  tickets: Ticket[];
  areas: Area[];
  rules: Rule[];
  users: User[];
  sessions: Session[];
  tokens: ApiToken[];
  logs: LogEntry[];
  entities: Entity[];
  notifications: Toggle[];
  widgets: Toggle[];
  timeRules: Toggle[];
  channel: 'push' | 'haNotify' | 'email';
  quietFrom: string;
  quietTo: string;
  interval: 15 | 30 | 60;
  rounding: 0 | 5 | 15;
  enforceSignature: boolean;
}

const initialState: AdminState = {
  tickets: mock.tickets,
  areas: mock.areas,
  rules: mock.rules,
  users: mock.users,
  sessions: mock.sessions,
  tokens: mock.tokens,
  logs: mock.logs,
  entities: mock.entities,
  notifications: mock.notifications,
  widgets: mock.widgets,
  timeRules: mock.timeRules,
  channel: 'push',
  quietFrom: '22:00',
  quietTo: '07:00',
  interval: 30,
  rounding: 15,
  enforceSignature: true,
};

type Update = Partial<AdminState> | ((s: AdminState) => Partial<AdminState>);

interface Store {
  state: AdminState;
  update: (u: Update) => void;
}

const StoreContext = createContext<Store | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState(initialState);
  const update = useCallback((u: Update) => setState(s => ({ ...s, ...(typeof u === 'function' ? u(s) : u) })), []);
  const value = useMemo(() => ({ state, update }), [state, update]);
  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore(): Store {
  const store = useContext(StoreContext);
  if (!store) throw new Error('useStore must be used inside <StoreProvider>');
  return store;
}

/** Flips `enabled` on the item at `index` of a toggle list. */
export function flipAt<T extends { enabled: boolean }>(list: T[], index: number): T[] {
  return list.map((x, i) => (i === index ? { ...x, enabled: !x.enabled } : x));
}

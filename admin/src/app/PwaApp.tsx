import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Icon } from '../components/ui';
import { api, setOnUnauthorized, useApiError, useRefresh } from '../lib/api';
import type { Me } from '../lib/types';
import { href, navigate, useRoute, type Route } from './router';
import { Areas } from './screens/Areas';
import { Login } from './screens/Login';
import { More } from './screens/More';
import { NewTicket } from './screens/NewTicket';
import { Notifications } from './screens/Notifications';
import { Plan } from './screens/Plan';
import { Presence } from './screens/Presence';
import { TicketDetail } from './screens/TicketDetail';
import { TicketList } from './screens/TicketList';
import { Time } from './screens/Time';
import { Today } from './screens/Today';
import { clock, useNow, useTimers } from './timer';
import { dismissToast, useToast } from './toast';

const REFRESH_MS = 60_000;
/** From this width the tabs become a sidebar and tickets show list and detail side by side (matches pwa.css). */
const WIDE = '(min-width: 960px)';

function useWide() {
  const [wide, setWide] = useState(() => window.matchMedia(WIDE).matches);
  useEffect(() => {
    const mq = window.matchMedia(WIDE);
    const onChange = () => setWide(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return wide;
}

/** App after design/Ticket App.dc.html: tabs Heute · Tickets · Neu · Zeit · Mehr; on wide screens a sidebar instead. */
export function PwaApp() {
  const [me, setMe] = useState<Me | null | undefined>(undefined); // undefined = still checking
  useEffect(() => {
    setOnUnauthorized(() => setMe(null));
    api<Me>('/api/me', { noLoginRedirect: true }).then(setMe).catch(() => setMe(null));
  }, []);

  if (me === undefined) return <div className="pwa-splash"><Icon name="check-square-offset" /></div>;
  if (me === null || me.kind !== 'user') return <Login />;
  return <Shell me={me} />;
}

function Shell({ me }: { me: Me }) {
  const { t } = useTranslation();
  const route = useRoute();
  const wide = useWide();
  const timers = useTimers();
  const refresh = useRefresh();
  const { error, clear } = useApiError();
  const toast = useToast();

  // Fresh data when the app comes back to the foreground, and once a minute while open.
  useEffect(() => {
    const onVisible = () => document.visibilityState === 'visible' && refresh();
    document.addEventListener('visibilitychange', onVisible);
    const id = window.setInterval(() => document.visibilityState === 'visible' && refresh(), REFRESH_MS);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.clearInterval(id);
    };
  }, [refresh]);

  const running = timers.timers[0] ?? null;
  const now = useNow(Boolean(running));
  const showMini = running && !(route.name === 'ticket' && route.id === running.ticketId);
  const canEdit = me.role !== 'read';

  const tabs: { route: Route; icon: string; label: string; active: boolean }[] = [
    { route: { name: 'today' }, icon: 'house', label: t('app.tab.today'), active: route.name === 'today' },
    { route: { name: 'tickets' }, icon: 'list-checks', label: t('app.tab.tickets'), active: route.name === 'tickets' || route.name === 'ticket' },
    { route: { name: 'plan' }, icon: 'calendar-dots', label: t('app.tab.plan'), active: route.name === 'plan' },
    ...(canEdit ? [{ route: { name: 'new' } as Route, icon: 'plus-circle', label: t('app.tab.new'), active: route.name === 'new' }] : []),
    { route: { name: 'time' }, icon: 'chart-bar', label: t('app.tab.time'), active: route.name === 'time' },
    { route: { name: 'more' }, icon: 'gear', label: t('app.tab.more'), active: route.name === 'more' || route.name === 'areas' || route.name === 'presence' || route.name === 'notifications' },
  ];

  return (
    <div className="pwa">
      {error && (
        <div className="pwa-toast" role="alert" onClick={clear}>
          <Icon name="warning" /> <span className="grow">{error}</span> <Icon name="x" />
        </div>
      )}
      <main className="pwa-content">
        {route.name === 'today' && <Today me={me} timers={timers} canEdit={canEdit} />}
        {wide && (route.name === 'tickets' || route.name === 'ticket') ? (
          <div className="pwa-split">
            <TicketList timers={timers} canEdit={canEdit} selectedId={route.name === 'ticket' ? route.id : undefined} />
            <div className="pwa-split-detail">
              {route.name === 'ticket'
                ? <TicketDetail key={route.id} id={route.id} me={me} timers={timers} canEdit={canEdit} />
                : <div className="pwa-split-empty"><Icon name="cursor-click" /> {t('app.selectTicket')}</div>}
            </div>
          </div>
        ) : (
          <>
            {route.name === 'tickets' && <TicketList timers={timers} canEdit={canEdit} />}
            {route.name === 'ticket' && <TicketDetail id={route.id} me={me} timers={timers} canEdit={canEdit} />}
          </>
        )}
        {route.name === 'plan' && <Plan me={me} />}
        {route.name === 'new' && <NewTicket timers={timers} />}
        {route.name === 'time' && <Time />}
        {route.name === 'more' && <More me={me} />}
        {route.name === 'areas' && <Areas me={me} />}
        {route.name === 'presence' && <Presence />}
        {route.name === 'notifications' && <Notifications />}
      </main>

      {showMini && (
        <div className="pwa-mini" role="button" tabIndex={0} onClick={() => navigate({ name: 'ticket', id: running.ticketId })} onKeyDown={e => e.key === 'Enter' && navigate({ name: 'ticket', id: running.ticketId })}>
          <span className="dot" />
          <span className="grow pwa-ellipsis">{running.title}</span>
          <span className="pwa-num">{clock(now - Date.parse(running.startedAt))}</span>
          <button type="button" className="btn btn-icon btn-ghost" aria-label={t('app.stopTimer')} onClick={e => { e.stopPropagation(); void timers.stop(running.ticketId); }}>
            <Icon name="stop" fill />
          </button>
        </div>
      )}

      {toast && (
        <div key={toast.id} className="pwa-snackbar" role="status">
          <span className="grow">{toast.text}</span>
          {toast.action && <button type="button" className="btn btn-ghost" onClick={() => { toast.action!.run(); dismissToast(); }}>{toast.action.label}</button>}
          <button type="button" className="btn btn-icon btn-ghost" aria-label={t('common.close')} onClick={dismissToast}><Icon name="x" /></button>
        </div>
      )}

      <nav className="pwa-tabs" aria-label={t('app.navigation')}>
        <div className="pwa-brand"><span className="pwa-brand-logo"><Icon name="check-square-offset" /></span> {t('brand.name')}</div>
        {tabs.map(tab => (
          <a key={tab.label} href={href(tab.route)} className={`pwa-tab${tab.active ? ' is-active' : ''}`} aria-current={tab.active ? 'page' : undefined}>
            <Icon name={tab.icon} fill={tab.active} />
            {tab.label}
          </a>
        ))}
      </nav>
    </div>
  );
}

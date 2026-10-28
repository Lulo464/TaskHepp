import { useEffect, useState, type ComponentType } from 'react';
import { useTranslation } from 'react-i18next';
import { Icon } from './components/ui';
import { post, useApi, useApiError } from './lib/api';
import type { Me } from './lib/types';
import { Areas } from './sections/Areas';
import { Calendars } from './sections/Calendars';
import { Config } from './sections/Config';
import { HomeAssistant } from './sections/HomeAssistant';
import { Log } from './sections/Log';
import { Mail } from './sections/Mail';
import { Monitor } from './sections/Monitor';
import { Notifications } from './sections/Notifications';
import { Overview } from './sections/Overview';
import { Reports } from './sections/Reports';
import { Rules } from './sections/Rules';
import { System } from './sections/System';
import { Tickets } from './sections/Tickets';
import { Users } from './sections/Users';

interface Section {
  id: string;
  icon: string;
  view: ComponentType;
}

const navGroups: { group: string; sections: Section[] }[] = [
  { group: 'ops', sections: [
    { id: 'overview', icon: 'squares-four', view: Overview },
    { id: 'tickets', icon: 'list-checks', view: Tickets },
    { id: 'areas', icon: 'folders', view: Areas },
    { id: 'reports', icon: 'chart-bar', view: Reports },
  ] },
  { group: 'ha', sections: [
    { id: 'ha', icon: 'house-line', view: HomeAssistant },
    { id: 'rules', icon: 'flow-arrow', view: Rules },
    { id: 'notify', icon: 'bell', view: Notifications },
  ] },
  { group: 'import', sections: [
    { id: 'calendars', icon: 'calendar-check', view: Calendars },
    { id: 'mail', icon: 'envelope-simple', view: Mail },
  ] },
  { group: 'monitor', sections: [
    { id: 'monitor', icon: 'monitor', view: Monitor },
  ] },
  { group: 'system', sections: [
    { id: 'users', icon: 'users', view: Users },
    { id: 'log', icon: 'scroll', view: Log },
    { id: 'system', icon: 'gear', view: System },
    { id: 'config', icon: 'code', view: Config },
  ] },
];

const allSections = navGroups.flatMap(g => g.sections);
const fromHash = () => allSections.find(s => s.id === window.location.hash.slice(1)) ?? allSections[0];

export function App() {
  const { t } = useTranslation();
  const [current, setCurrent] = useState(fromHash);

  // The section lives in the URL hash so reloads and links keep it.
  useEffect(() => {
    const onHash = () => setCurrent(fromHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const me = useApi<Me>('/api/me');
  const { error, clear } = useApiError();
  const View = current.view;

  // The admin UI is for admins; everyone else uses the app.
  useEffect(() => {
    if (me?.kind === 'user' && me.role !== 'admin') window.location.replace('/');
  }, [me]);

  const logout = async () => {
    await post('/api/logout');
    window.location.href = '/auth/login';
  };

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark"><Icon name="check-square-offset" /></span>
          <span className="brand-name">{t('brand.name')} <span className="brand-suffix">{t('brand.suffix')}</span></span>
        </div>
        <nav style={{ display: 'contents' }}>
          {navGroups.map((g, gi) => (
            <div key={g.group} style={{ display: 'contents' }}>
              <div className={`nav-group${gi === 0 ? ' is-first' : ''}`}>{t(`nav.groups.${g.group}`)}</div>
              {g.sections.map(s => {
                const active = s.id === current.id;
                return (
                  <a key={s.id} href={`#${s.id}`} className={`nav-item${active ? ' is-active' : ''}`} aria-current={active ? 'page' : undefined}>
                    <Icon name={s.icon} fill={active} />
                    {t(`sections.${s.id}.label`)}
                  </a>
                );
              })}
            </div>
          ))}
        </nav>
        <a className="nav-item" href="/" style={{ marginTop: 'auto' }}><Icon name="device-mobile" />{t('account.toApp')}</a>
        {me?.kind === 'user' && (
          <div className="account" style={{ marginTop: 0 }}>
            <span className="avatar">{(me.name ?? me.email ?? '?').charAt(0).toUpperCase()}</span>
            <span className="grow" title={me.email}>{me.email}</span>
            <button type="button" className="icon-btn" aria-label={t('account.logout')} title={t('account.logout')} onClick={logout}><Icon name="sign-out" /></button>
          </div>
        )}
      </aside>
      <main className="main">
        <h1 className="page-title">{t(`sections.${current.id}.label`)}</h1>
        <div className="page-sub">{t(`sections.${current.id}.sub`)}</div>
        {error && (
          <div className="error-banner" role="alert">
            <Icon name="warning" /> <span className="grow">{error}</span>
            <button type="button" className="icon-btn" aria-label={t('common.close')} onClick={clear}><Icon name="x" /></button>
          </div>
        )}
        <View />
      </main>
    </div>
  );
}

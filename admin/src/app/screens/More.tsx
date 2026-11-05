import { useTranslation } from 'react-i18next';
import { Icon, Switch } from '../../components/ui';
import { patch, post, useAction, useApi } from '../../lib/api';
import { clearOffline, getOfflineState } from '../../lib/offline';
import type { AuthInfo, Me, Rule, SystemInfo } from '../../lib/types';
import { href } from '../router';
import { CalendarFeed } from './CalendarFeed';
import { LegalLinks } from './Legal';

/** "Mehr": account, Home Assistant, areas, admin link, sign-out — after design screen 7. */
export function More({ me }: { me: Me }) {
  const { t } = useTranslation();
  const auth = useApi<AuthInfo>('/api/auth/info');
  const system = useApi<SystemInfo>('/api/system');
  const rules = useApi<Rule[]>('/api/rules');
  const act = useAction();
  const isAdmin = me.role === 'admin';

  const logout = async () => {
    const waiting = getOfflineState().pending;
    if (waiting && !window.confirm(t('app.offline.logoutConfirm', { count: waiting }))) return;
    await post('/api/logout');
    // Nothing personal stays on the device.
    clearOffline();
    window.location.reload();
  };

  return (
    <div className="pwa-screen">
      <h1 className="pwa-h1" style={{ marginBottom: 18 }}>{t('app.more.title')}</h1>

      <div className="pwa-kicker">{t('app.more.account')}</div>
      <div className="card pwa-card">
        <div className="pwa-account">
          <span className="avatar pwa-avatar">{(me.name ?? me.email ?? '?').charAt(0).toUpperCase()}</span>
          <div className="grow">
            <div>{me.name}</div>
            <div className="pwa-row-meta">{me.email}</div>
          </div>
          <span className="tag tag-accent">{t(`role.${me.role}`)}</span>
        </div>
        <div className="pwa-row-meta">
          {auth?.mode === 'oidc' && auth.issuer ? t('app.more.issuer', { issuer: auth.issuer.replace(/^https?:\/\//, '') }) : t('app.more.devMode')}
        </div>
      </div>

      <div className="pwa-kicker" style={{ marginTop: 22 }}>{t('app.more.ha')}</div>
      <div className="card pwa-card">
        <div className="pwa-account">
          <Icon name="house-line" className="accent" />
          <span className="grow">Home Assistant</span>
          <span className={`tag ${system?.ha.configured ? 'tag-accent' : 'tag-outline'}`}>{t(system?.ha.configured ? 'app.more.haOnline' : 'app.more.haMissing')}</span>
        </div>
        {rules?.map(r => (
          <button
            key={r.id}
            type="button"
            role="switch"
            aria-checked={r.enabled}
            className="pwa-rule"
            disabled={!isAdmin}
            onClick={() => act(() => patch(`/api/rules/${r.id}`, { enabled: !r.enabled }))}
          >
            <span className="grow">
              <span className="pwa-rule-name">{r.name}</span>
              <span className="pwa-row-meta mono">{r.entity} {r.cond}</span>
            </span>
            <Switch on={r.enabled} />
          </button>
        ))}
        {rules?.length === 0 && <div className="pwa-row-meta">{t('app.more.noRules')}</div>}
      </div>

      <CalendarFeed />

      <div className="stack" style={{ gap: 10, marginTop: 22 }}>
        <a className="btn btn-secondary btn-block" href={href({ name: 'areas' })}><Icon name="folders" /> {t('app.more.areas')}</a>
        <a className="btn btn-secondary btn-block" href={href({ name: 'notifications' })}><Icon name="bell-ringing" /> {t('app.notify.title')}</a>
        <a className="btn btn-secondary btn-block" href={href({ name: 'tags' })}><Icon name="contactless-payment" /> {t('app.tags.title')}</a>
        <a className="btn btn-secondary btn-block" href={href({ name: 'presence' })}><Icon name="map-pin-area" /> {t('app.presence.title')}</a>
        <a className="btn btn-secondary btn-block" href={href({ name: 'mydata' })}><Icon name="shield-check" /> {t('app.mydata.title')}</a>
        {isAdmin && <a className="btn btn-secondary btn-block" href="/admin"><Icon name="gear-six" /> {t('app.more.admin')}</a>}
        {isAdmin && system && <a className="btn btn-secondary btn-block" href={system.monitorUrl} target="_blank" rel="noreferrer"><Icon name="monitor" /> {t('app.more.monitor')}</a>}
        <button type="button" className="btn btn-ghost btn-block" onClick={logout}><Icon name="sign-out" /> {t('account.logout')}</button>
      </div>
      <div className="pwa-row-meta" style={{ textAlign: 'center', marginTop: 18 }}>{t('brand.name')} {system?.version}</div>
      <LegalLinks />
    </div>
  );
}

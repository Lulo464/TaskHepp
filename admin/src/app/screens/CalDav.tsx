import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Icon } from '../../components/ui';
import { del, post, useAction, useApi } from '../../lib/api';
import { formatAgo } from '../../lib/format';

interface CalDavInfo {
  url: string;
  server: string;
  username: string;
  hasPassword: boolean;
  createdAt: string | null;
}

/** Copies a value; falls back to a prompt where the clipboard is not allowed. */
function CopyField({ label, value, mono = true }: { label: string; value: string; mono?: boolean }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      window.prompt(t('app.calendar.copyManually'), value);
    }
  };
  return (
    <div className="pwa-caldav-field">
      <span className="pwa-label">{label}</span>
      <div className="row" style={{ gap: 6 }}>
        <input className={`input grow${mono ? ' mono' : ''}`} value={value} readOnly aria-label={label} onFocus={e => e.target.select()} />
        <button type="button" className="btn btn-icon btn-ghost" aria-label={t('app.calendar.copy')} onClick={copy}><Icon name={copied ? 'check' : 'copy'} /></button>
      </div>
    </div>
  );
}

/** "Zwei-Wege-Kalender": Tasklog as a CalDAV calendar in the phone's own calendar app, one calendar per area. */
export function CalDav() {
  const { t } = useTranslation();
  const info = useApi<CalDavInfo>('/api/me/caldav');
  const act = useAction();
  const [password, setPassword] = useState<string | null>(null);
  const [help, setHelp] = useState(false);
  if (!info) return null;

  const create = async () => {
    if (info.hasPassword && !window.confirm(t('app.caldav.renewConfirm'))) return;
    const res = await act(() => post<{ password: string }>('/api/me/caldav/password'));
    if (res) setPassword(res.password);
  };
  const revoke = () => window.confirm(t('app.caldav.revokeConfirm')) && act(async () => {
    await del('/api/me/caldav/password');
    setPassword(null);
  });
  const insecure = info.url.startsWith('http:');

  return (
    <>
      <div className="pwa-kicker" style={{ marginTop: 22 }}>{t('app.caldav.title')}</div>
      <div className="card pwa-card pwa-caldav">
        <div className="pwa-row-meta">{t('app.caldav.intro')}</div>
        <CopyField label={t('app.caldav.server')} value={info.url} />
        <CopyField label={t('app.caldav.username')} value={info.username} />
        {password ? (
          <>
            <CopyField label={t('app.caldav.password')} value={password} />
            <p className="pwa-caldav-once" role="status"><Icon name="warning" /> {t('app.caldav.once')}</p>
          </>
        ) : (
          <div className="pwa-row-meta">
            {info.hasPassword ? t('app.caldav.hasPassword', { when: formatAgo(info.createdAt) }) : t('app.caldav.noPassword')}
          </div>
        )}
        {insecure && <p className="pwa-caldav-once"><Icon name="lock-simple-open" /> {t('app.caldav.insecure')}</p>}
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <button type="button" className="btn btn-secondary" onClick={create}><Icon name="key" /> {t(info.hasPassword ? 'app.caldav.renew' : 'app.caldav.create')}</button>
          {info.hasPassword && <button type="button" className="btn btn-ghost" onClick={revoke}><Icon name="prohibit" /> {t('app.caldav.revoke')}</button>}
        </div>
        <button type="button" className="btn btn-ghost pwa-feed-help-toggle" aria-expanded={help} onClick={() => setHelp(h => !h)}>
          <Icon name={help ? 'caret-up' : 'caret-down'} /> {t('app.caldav.how')}
        </button>
        {help && (
          <ul className="pwa-feed-help">
            <li>{t('app.caldav.helpIphone', { server: info.server })}</li>
            <li>{t('app.caldav.helpAndroid', { url: info.url })}</li>
            <li>{t('app.caldav.helpThunderbird', { url: info.url })}</li>
            <li>{t('app.caldav.helpRules')}</li>
          </ul>
        )}
      </div>
    </>
  );
}

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Icon, Switch } from '../../components/ui';
import { post, useAction, useApi } from '../../lib/api';
import { useMyAreas } from '../areas';

/** "Kalender-Abo": a secret link for Google, Apple or Outlook calendar and Home Assistant with the own tickets. */
export function CalendarFeed() {
  const { t } = useTranslation();
  const feed = useApi<{ url: string }>('/api/me/calendar-feed');
  const areas = useMyAreas();
  const act = useAction();
  const [mine, setMine] = useState(false);
  const [area, setArea] = useState(0);
  const [copied, setCopied] = useState(false);
  const [help, setHelp] = useState(false);

  if (!feed) return null;
  const q = new URLSearchParams();
  if (mine) q.set('mine', 'true');
  if (area) q.set('area', String(area));
  const url = feed.url + (q.size ? `?${q}` : '');

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      window.prompt(t('app.calendar.copyManually'), url);
      return;
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  };

  return (
    <>
      <div className="pwa-kicker" style={{ marginTop: 22 }}>{t('app.calendar.title')}</div>
      <div className="card pwa-card">
        <div className="pwa-row-meta">{t('app.calendar.intro')}</div>
        <button type="button" role="switch" aria-checked={mine} className="pwa-rule" onClick={() => setMine(m => !m)}>
          <span className="grow pwa-rule-name">{t('app.calendar.mine')}</span>
          <Switch on={mine} />
        </button>
        <div className="pwa-feed-row">
          <span className="pwa-rule-name grow">{t('app.calendar.area')}</span>
          <select className="input" value={area} onChange={e => setArea(Number(e.target.value))} aria-label={t('app.calendar.area')}>
            <option value={0}>{t('app.calendar.allAreas')}</option>
            {areas?.visible.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </div>
        <input className="input mono pwa-feed-url" value={url} readOnly onFocus={e => e.target.select()} aria-label={t('app.calendar.link')} />
        <div className="row" style={{ gap: 8 }}>
          <button type="button" className="btn btn-secondary" onClick={copy}><Icon name={copied ? 'check' : 'copy'} /> {t(copied ? 'app.calendar.copied' : 'app.calendar.copy')}</button>
          <a className="btn btn-secondary" href={url.replace(/^https?:/, 'webcal:')}><Icon name="calendar-plus" /> {t('app.calendar.subscribe')}</a>
        </div>
        <button type="button" className="btn btn-ghost pwa-feed-help-toggle" aria-expanded={help} onClick={() => setHelp(h => !h)}>
          <Icon name={help ? 'caret-up' : 'caret-down'} /> {t('app.calendar.how')}
        </button>
        {help && (
          <ul className="pwa-feed-help">
            <li>{t('app.calendar.helpGoogle')}</li>
            <li>{t('app.calendar.helpApple')}</li>
            <li>{t('app.calendar.helpOutlook')}</li>
            <li>{t('app.calendar.helpHa')}</li>
            <li>{t('app.calendar.helpDelay')}</li>
          </ul>
        )}
        <button type="button" className="btn btn-ghost pwa-feed-renew"
          onClick={() => window.confirm(t('app.calendar.renewConfirm')) && act(() => post('/api/me/calendar-feed/rotate'))}>
          <Icon name="arrows-clockwise" /> {t('app.calendar.renew')}
        </button>
      </div>
    </>
  );
}

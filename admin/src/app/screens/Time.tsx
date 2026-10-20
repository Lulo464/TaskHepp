import { useTranslation } from 'react-i18next';
import { Icon, Loading } from '../../components/ui';
import { useApi } from '../../lib/api';
import { formatMinutes } from '../../lib/format';
import type { MyTime } from '../../lib/types';
import { navigate } from '../router';

const BAR_HEIGHT = 110;

/** The own tracked time this week, after the design's "Zeit" tab. */
export function Time() {
  const { t, i18n } = useTranslation();
  const time = useApi<MyTime>('/api/me/time');
  if (!time) return <div className="pwa-screen"><Loading /></div>;

  const today = new Date().toLocaleDateString('sv-SE');
  const max = Math.max(...time.week.days.map(d => d.minutes), 1);

  return (
    <div className="pwa-screen">
      <h1 className="pwa-h1" style={{ marginBottom: 4 }}>{t('app.tab.time')}</h1>
      <div className="pwa-date">{t('app.time.thisWeek', { total: formatMinutes(time.week.total) })}</div>

      <div className="pwa-bars" role="img" aria-label={t('app.time.chartLabel')}>
        {time.week.days.map(d => {
          const isToday = d.date === today;
          const [y, m, day] = d.date.split('-').map(Number);
          return (
            <div key={d.date} className="pwa-bar-col" title={formatMinutes(d.minutes)}>
              <div className={`pwa-bar${isToday ? ' is-today' : ''}`} style={{ height: Math.round((d.minutes / max) * BAR_HEIGHT) }} />
              <span className={isToday ? 'is-today' : ''}>{new Date(y, m - 1, day).toLocaleDateString(i18n.language, { weekday: 'short' }).replace('.', '')}</span>
            </div>
          );
        })}
      </div>

      {time.week.byArea.length > 0 && (
        <div className="pwa-area-cards">
          {time.week.byArea.map(a => (
            <div key={a.name} className="card pwa-area-card">
              <div className="pwa-label"><Icon name={a.icon} /> {a.name}</div>
              <div className="pwa-area-value">{formatMinutes(a.minutes)}</div>
            </div>
          ))}
        </div>
      )}

      <div className="pwa-section-head"><span>{t('app.time.top')}</span></div>
      {time.top.map(x => (
        <div key={x.id} className="pwa-top-row" role="button" tabIndex={0} onClick={() => navigate({ name: 'ticket', id: x.id })} onKeyDown={e => e.key === 'Enter' && navigate({ name: 'ticket', id: x.id })}>
          <span className="pwa-ellipsis">{x.title}</span>
          <span className="pwa-num soft">{formatMinutes(x.minutes)}</span>
        </div>
      ))}
      {time.top.length === 0 && <div className="pwa-empty">{t('app.time.nothing')}</div>}
    </div>
  );
}

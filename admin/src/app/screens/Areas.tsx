import { useTranslation } from 'react-i18next';
import { Icon, Loading } from '../../components/ui';
import { post, useAction, useApi } from '../../lib/api';
import { formatMinutes } from '../../lib/format';
import type { Area, Me } from '../../lib/types';
import { href } from '../router';

/** Areas with their projects and this week's time — design screen 6. */
export function Areas({ me }: { me: Me }) {
  const { t } = useTranslation();
  const areas = useApi<Area[]>('/api/areas');
  const week = useApi<{ rows: { name: string; minutes: number }[] }>('/api/reports/time?groupBy=area&range=week');
  const act = useAction();
  const isAdmin = me.role === 'admin';

  const addProject = (a: Area) => {
    const name = window.prompt(t('areas.projectName'))?.trim();
    if (name) void act(() => post(`/api/areas/${a.id}/projects`, { name }));
  };

  return (
    <div className="pwa-screen">
      <a className="btn btn-ghost pwa-back" href={href({ name: 'more' })}><Icon name="caret-left" /> {t('app.more.title')}</a>
      <h1 className="pwa-h1" style={{ margin: '10px 0 16px' }}>{t('app.more.areas')}</h1>
      {!areas ? <Loading /> : areas.map(a => (
        <div key={a.id} className="card pwa-card" style={{ marginBottom: 12 }}>
          <div className="pwa-account">
            <Icon name={a.icon} className="accent pwa-area-icon" />
            <span className="grow pwa-area-name">{a.name}</span>
            <span className="pwa-row-meta">{t('app.areas.week', { time: formatMinutes(week?.rows.find(r => r.name === a.name)?.minutes ?? 0) })}</span>
          </div>
          {a.projects.map(p => (
            <div key={p.id} className="pwa-project">
              <span>{p.name}</span>
              <span className="soft">{t('areas.openCount', { count: p.open })}</span>
            </div>
          ))}
          {isAdmin && (
            <button type="button" className="btn btn-ghost" style={{ alignSelf: 'flex-start', marginTop: 4 }} onClick={() => addProject(a)}>
              <Icon name="plus" /> {t('areas.addProject')}
            </button>
          )}
        </div>
      ))}
      {areas?.length === 0 && <div className="pwa-empty">{t('areas.empty')}</div>}
    </div>
  );
}

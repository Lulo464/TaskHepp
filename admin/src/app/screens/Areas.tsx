import { useTranslation } from 'react-i18next';
import { Icon, Loading } from '../../components/ui';
import { post, put, useAction, useApi } from '../../lib/api';
import { formatMinutes } from '../../lib/format';
import type { Area, Me } from '../../lib/types';
import { useMyAreas, type AreaPrefs } from '../areas';
import { href } from '../router';

/** Areas with their projects and this week's time — design screen 6. Each user sorts and hides areas for themselves. */
export function Areas({ me }: { me: Me }) {
  const { t } = useTranslation();
  const my = useMyAreas();
  const areas = my?.all;
  const week = useApi<{ rows: { name: string; minutes: number }[] }>('/api/reports/time?groupBy=area&range=week');
  const act = useAction();
  const isAdmin = me.role === 'admin';

  const savePrefs = (prefs: AreaPrefs) => act(() => put('/api/me/areas', prefs));
  const move = (index: number, by: -1 | 1) => {
    if (!my) return;
    const order = my.all.map(a => a.id);
    [order[index], order[index + by]] = [order[index + by], order[index]];
    void savePrefs({ ...my.prefs, order });
  };
  const toggleHidden = (a: Area) => my && void savePrefs({
    ...my.prefs,
    hidden: my.isHidden(a.id) ? my.prefs.hidden.filter(id => id !== a.id) : [...my.prefs.hidden, a.id],
  });

  const addProject = (a: Area) => {
    const name = window.prompt(t('areas.projectName'))?.trim();
    if (name) void act(() => post(`/api/areas/${a.id}/projects`, { name }));
  };

  return (
    <div className="pwa-screen">
      <a className="btn btn-ghost pwa-back" href={href({ name: 'more' })}><Icon name="caret-left" /> {t('app.more.title')}</a>
      <h1 className="pwa-h1" style={{ margin: '10px 0 6px' }}>{t('app.more.areas')}</h1>
      <p className="pwa-date" style={{ margin: '0 0 16px' }}>{t('app.areas.prefsHint')}</p>
      {!areas || !my ? <Loading /> : areas.map((a, i) => (
        <div key={a.id} className={`card pwa-card${my.isHidden(a.id) ? ' is-hidden' : ''}`} style={{ marginBottom: 12 }}>
          <div className="pwa-account">
            <Icon name={a.icon} className="accent pwa-area-icon" />
            <div className="grow">
              <div className="pwa-area-name">{a.name}</div>
              <div className="pwa-row-meta">
                {my.isHidden(a.id) ? t('app.areas.hidden') : t('app.areas.week', { time: formatMinutes(week?.rows.find(r => r.name === a.name)?.minutes ?? 0) })}
              </div>
            </div>
            <div className="pwa-area-tools">
              <button type="button" className="btn btn-icon btn-ghost" aria-label={t('app.areas.up', { name: a.name })} title={t('app.areas.up', { name: a.name })} disabled={i === 0} onClick={() => move(i, -1)}><Icon name="caret-up" /></button>
              <button type="button" className="btn btn-icon btn-ghost" aria-label={t('app.areas.down', { name: a.name })} title={t('app.areas.down', { name: a.name })} disabled={i === areas.length - 1} onClick={() => move(i, 1)}><Icon name="caret-down" /></button>
              <button type="button" className="btn btn-icon btn-ghost" aria-pressed={!my.isHidden(a.id)}
                aria-label={t(my.isHidden(a.id) ? 'app.areas.show' : 'app.areas.hide', { name: a.name })} title={t(my.isHidden(a.id) ? 'app.areas.show' : 'app.areas.hide', { name: a.name })}
                onClick={() => toggleHidden(a)}>
                <Icon name={my.isHidden(a.id) ? 'eye-slash' : 'eye'} />
              </button>
            </div>
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

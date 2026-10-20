import { useTranslation } from 'react-i18next';
import { Icon, Loading } from '../components/ui';
import { post, useAction, useApi } from '../lib/api';
import type { Area } from '../lib/types';

const projectColors = ['var(--color-accent)', 'var(--color-accent-400)', 'var(--color-neutral-400)'];

export function Areas() {
  const { t } = useTranslation();
  const areas = useApi<Area[]>('/api/areas');
  const act = useAction();
  if (!areas) return <Loading />;

  const addProject = (a: Area) => {
    const name = window.prompt(t('areas.projectName'), t('areas.newProject', { n: a.projects.length + 1 }));
    if (name?.trim()) void act(() => post(`/api/areas/${a.id}/projects`, { name: name.trim() }));
  };

  return (
    <div className="area-grid">
      {areas.map(a => (
        <div key={a.id} className="card pad-lg" style={{ gap: 0 }}>
          <div className="area-head">
            <Icon name={a.icon} />
            <div className="area-name">{a.name}</div>
            <span className="tag tag-neutral">{t('areas.defaultPrio', { prio: t(`prio.${a.defaultPrio}`) })}</span>
          </div>
          {a.projects.map((p, pi) => (
            <div key={p.id} className="project-row">
              <span className="dot" style={{ background: projectColors[pi % projectColors.length] }} />
              <span className="grow">{p.name}</span>
              <span className="muted">{t('areas.openCount', { count: p.open })}</span>
            </div>
          ))}
          <div>
            <button type="button" className="btn btn-secondary" style={{ marginTop: 14 }} onClick={() => addProject(a)}>
              <Icon name="plus" /> {t('areas.addProject')}
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

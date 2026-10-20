import { useTranslation } from 'react-i18next';
import { Icon } from '../components/ui';
import { useStore } from '../lib/store';

const projectColors = ['var(--color-accent)', 'var(--color-accent-400)', 'var(--color-neutral-400)'];

export function Areas() {
  const { t } = useTranslation();
  const { state, update } = useStore();

  const addProject = (areaIndex: number) =>
    update(s => ({
      areas: s.areas.map((a, i) =>
        i === areaIndex ? { ...a, projects: [...a.projects, { name: t('areas.newProject', { n: a.projects.length + 1 }), open: 0 }] } : a),
    }));

  return (
    <div className="area-grid">
      {state.areas.map((a, ai) => (
        <div key={a.name} className="card pad-lg" style={{ gap: 0 }}>
          <div className="area-head">
            <Icon name={a.icon} />
            <div className="area-name">{a.name}</div>
            <span className="tag tag-neutral">{t('areas.defaultPrio', { prio: t(`prio.${a.prio}`) })}</span>
          </div>
          {a.projects.map((p, pi) => (
            <div key={p.name} className="project-row">
              <span className="dot" style={{ background: projectColors[pi % projectColors.length] }} />
              <span className="grow">{p.name}</span>
              <span className="muted">{t('areas.openCount', { count: p.open })}</span>
            </div>
          ))}
          <div>
            <button type="button" className="btn btn-secondary" style={{ marginTop: 14 }} onClick={() => addProject(ai)}>
              <Icon name="plus" /> {t('areas.addProject')}
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

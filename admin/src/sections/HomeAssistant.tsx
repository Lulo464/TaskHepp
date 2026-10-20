import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Field, Icon, ToggleList } from '../components/ui';
import { flipAt, useStore } from '../lib/store';

export function HomeAssistant() {
  const { t } = useTranslation();
  const { state, update } = useStore();
  const [conn, setConn] = useState<'idle' | 'busy' | 'ok'>('idle');
  const timer = useRef<number>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  // Placeholder until the backend exposes a real connection check.
  const testConnection = () => {
    setConn('busy');
    timer.current = window.setTimeout(() => setConn('ok'), 900);
  };

  return (
    <>
      <div className="ha-bridge">
        <div className="card pad-lg" style={{ gap: 0 }}>
          <div className="ha-card-head">
            <span><Icon name="house-line" /> {t('ha.title')}</span>
            <span className="tag tag-accent" aria-live="polite">{t(`ha.state.${conn}`)}</span>
          </div>
          <div className="ha-card-meta">{t('ha.host')}</div>
          <Field label={t('ha.token')}><input className="input" value="••••••••••••••••••••" readOnly /></Field>
          <div>
            <button type="button" className="btn btn-secondary" style={{ marginTop: 14 }} onClick={testConnection} disabled={conn === 'busy'}>
              <Icon name="plugs-connected" /> {t('ha.test')}
            </button>
          </div>
        </div>
        <div className="ha-flow" aria-hidden="true">
          <span>{t('ha.flowTickets')}</span>
          <Icon name="arrow-right" />
          <Icon name="arrow-left" />
          <span>{t('ha.flowStates')}</span>
        </div>
        <div className="card pad-lg" style={{ gap: 0 }}>
          <div className="ha-card-head">
            <span><Icon name="check-square-offset" /> {t('ha.tasklog')}</span>
            <span className="tag tag-accent">{t('ha.ready')}</span>
          </div>
          <div className="ha-card-meta">{t('ha.tasklogDesc')}</div>
          <Field label={t('ha.webhookUrl')}><input className="input" value="https://tasks.example.com/api/hooks/ha/8f3c…" readOnly /></Field>
        </div>
      </div>

      <div className="section-title" style={{ marginBottom: 4 }}>{t('ha.entitiesTitle')}</div>
      <div className="section-hint" style={{ marginTop: 0 }}>{t('ha.entitiesSub')}</div>
      <ToggleList
        mono
        items={state.entities.map(e => ({ title: e.id, desc: t(`ha.entity.${e.desc}`), on: e.enabled }))}
        onToggle={i => update(s => ({ entities: flipAt(s.entities, i) }))}
      />
    </>
  );
}

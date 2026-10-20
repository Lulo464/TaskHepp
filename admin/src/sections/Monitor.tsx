import { useTranslation } from 'react-i18next';
import { Field, Icon, Seg, ToggleList } from '../components/ui';
import { monitorPreview } from '../lib/mockData';
import { flipAt, useStore } from '../lib/store';

export function Monitor() {
  const { t } = useTranslation();
  const { state, update } = useStore();

  return (
    <div className="two-col">
      <div>
        <ToggleList
          items={state.widgets.map(w => ({ title: t(`monitor.widget.${w.key}`), on: w.enabled }))}
          onToggle={i => update(s => ({ widgets: flipAt(s.widgets, i) }))}
        />
        <div className="control-label" style={{ margin: '20px 0 6px' }}>{t('monitor.refresh')}</div>
        <Seg
          label={t('monitor.refresh')}
          options={([15, 30, 60] as const).map(n => ({ value: n, label: t('monitor.seconds', { n }) }))}
          value={state.interval}
          onChange={interval => update({ interval })}
        />
        <div style={{ marginTop: 20 }}>
          <Field label={t('monitor.publicLink')}><input className="input" value="https://tasks.example.com/monitor?t=9d2e…" readOnly /></Field>
        </div>
        <button type="button" className="btn btn-secondary" style={{ marginTop: 12 }}>
          <Icon name="arrows-clockwise" /> {t('monitor.renewLink')}
        </button>
      </div>
      <div className="monitor-preview">
        <div className="monitor-label">{t('monitor.preview', { n: state.interval })}</div>
        <div className="monitor-clock">14:32</div>
        {monitorPreview.map(([at, title]) => (
          <div key={at} className="monitor-row"><span className="at">{at}</span><span>{title}</span></div>
        ))}
      </div>
    </div>
  );
}

import { useTranslation } from 'react-i18next';
import { Field, Icon, Loading, Seg, ToggleList } from '../components/ui';
import { patch, post, useAction, useApi } from '../lib/api';
import type { MonitorData, Settings, SystemInfo } from '../lib/types';

const WIDGETS = ['clock', 'timer', 'next', 'later', 'haSensors'] as const;

export function Monitor() {
  const { t } = useTranslation();
  const settings = useApi<Settings>('/api/settings');
  const system = useApi<SystemInfo>('/api/system');
  const preview = useApi<MonitorData>('/api/monitor', { refreshMs: (settings?.monitorInterval ?? 30) * 1000 });
  const act = useAction();
  if (!settings || !system) return <Loading />;

  const items = preview ? [...preview.next, ...preview.later] : [];

  return (
    <div className="two-col">
      <div>
        <ToggleList
          items={WIDGETS.map(w => ({ title: t(`monitor.widget.${w}`), on: settings.widgets[w] }))}
          onToggle={i => act(() => patch('/api/settings', { widgets: { [WIDGETS[i]]: !settings.widgets[WIDGETS[i]] } }))}
        />
        <div className="control-label" style={{ margin: '20px 0 6px' }}>{t('monitor.refresh')}</div>
        <Seg
          label={t('monitor.refresh')}
          options={([15, 30, 60] as const).map(n => ({ value: n, label: t('monitor.seconds', { n }) }))}
          value={settings.monitorInterval}
          onChange={monitorInterval => act(() => patch('/api/settings', { monitorInterval }))}
        />
        <div style={{ marginTop: 20 }}>
          <Field label={t('monitor.publicLink')}><input className="input mono" value={system.monitorUrl} readOnly onFocus={e => e.target.select()} /></Field>
        </div>
        <div className="row" style={{ marginTop: 12 }}>
          <button type="button" className="btn btn-secondary" onClick={() => window.confirm(t('monitor.renewConfirm')) && act(() => post('/api/settings/monitor-token/rotate'))}>
            <Icon name="arrows-clockwise" /> {t('monitor.renewLink')}
          </button>
          <a className="btn btn-ghost" href={system.monitorUrl} target="_blank" rel="noreferrer"><Icon name="arrow-square-out" /> {t('monitor.open')}</a>
        </div>
      </div>
      <div className="monitor-preview">
        <div className="monitor-label">{t('monitor.preview', { n: settings.monitorInterval })}</div>
        <div className="monitor-clock">{new Date(preview?.now ?? Date.now()).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}</div>
        {preview?.timer && (
          <div className="monitor-row"><span className="at"><Icon name="timer" /></span><span>{preview.timer.title}</span></div>
        )}
        {items.map(p => (
          <div key={p.id} className="monitor-row"><span className="at">{p.overdue ? '!' : p.dueTime ?? (p.prio === 'high' ? '↑' : '·')}</span><span>{p.title}</span></div>
        ))}
        {preview && items.length === 0 && <div className="muted">{t('monitor.nothingToday')}</div>}
      </div>
    </div>
  );
}

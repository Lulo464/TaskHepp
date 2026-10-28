import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Field, Icon, Loading, Seg, ToggleList } from '../components/ui';
import { patch, post, useAction, useApi } from '../lib/api';
import type { Area, MonitorData, Settings, SystemInfo } from '../lib/types';

const WIDGETS = ['clock', 'timer', 'next', 'later', 'haSensors'] as const;

export function Monitor() {
  const { t } = useTranslation();
  const settings = useApi<Settings>('/api/settings');
  const system = useApi<SystemInfo>('/api/system');
  const areas = useApi<Area[]>('/api/areas');
  const [area, setArea] = useState(0); // 0 = all areas
  const preview = useApi<MonitorData>(area ? `/api/monitor?area=${area}` : '/api/monitor', { refreshMs: (settings?.monitorInterval ?? 30) * 1000 });
  const act = useAction();
  if (!settings || !system || !areas) return <Loading />;

  const links = [{ id: 0, name: t('monitor.allAreas') }, ...areas].map(a => ({ ...a, url: a.id ? `${system.monitorUrl}&area=${a.id}` : system.monitorUrl }));

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
        <div className="control-label" style={{ margin: '20px 0 6px' }}>{t('monitor.publicLinks')}</div>
        {links.map(l => (
          <Field key={l.id} label={l.name}>
            <div className="row" style={{ flexWrap: 'nowrap' }}>
              <input className="input mono" style={{ flex: 1, minWidth: 0 }} value={l.url} readOnly onFocus={e => e.target.select()} />
              <a className="btn btn-ghost" href={l.url} target="_blank" rel="noreferrer" title={t('monitor.open')} aria-label={t('monitor.open')}><Icon name="arrow-square-out" /></a>
            </div>
          </Field>
        ))}
        <div className="field-hint">{t('monitor.linksHint')}</div>
        <div className="row" style={{ marginTop: 12 }}>
          <button type="button" className="btn btn-secondary" onClick={() => window.confirm(t('monitor.renewConfirm')) && act(() => post('/api/settings/monitor-token/rotate'))}>
            <Icon name="arrows-clockwise" /> {t('monitor.renewLink')}
          </button>
        </div>
      </div>
      <div className="monitor-preview">
        <div className="row" style={{ justifyContent: 'space-between', marginBottom: 10 }}>
          <div className="monitor-label" style={{ margin: 0 }}>{t('monitor.preview', { n: settings.monitorInterval })}</div>
          <select className="input" style={{ width: 'auto' }} aria-label={t('monitor.previewArea')} value={area} onChange={e => setArea(Number(e.target.value))}>
            {links.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
        </div>
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

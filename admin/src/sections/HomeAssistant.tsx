import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Field, Icon, Loading, Note, ToggleList } from '../components/ui';
import { patch, post, useAction, useApi } from '../lib/api';
import type { Entity, HaInfo } from '../lib/types';

type Check = { state: 'idle' } | { state: 'busy' } | { state: 'ok'; version?: string } | { state: 'error'; message: string };

const entityDesc: Record<string, string> = {
  'sensor.tasklog_open_tickets': 'openTickets',
  'sensor.tasklog_today_time': 'todayTime',
  'binary_sensor.tasklog_timer_running': 'timerRunning',
  'binary_sensor.tasklog_overdue': 'overdue',
  'sensor.tasklog_next_due': 'nextDue',
};

export function HomeAssistant() {
  const { t } = useTranslation();
  const info = useApi<HaInfo>('/api/ha');
  const entities = useApi<Entity[]>('/api/entities');
  const act = useAction();
  const [check, setCheck] = useState<Check>({ state: 'idle' });
  const [url, setUrl] = useState('');
  const [token, setToken] = useState('');

  useEffect(() => { if (info) setUrl(info.url); }, [info?.url]);

  if (!info || !entities) return <Loading />;
  const configured = Boolean(info.url && info.hasToken);

  const testConnection = async () => {
    setCheck({ state: 'busy' });
    const res = await act(() => post<{ ok: boolean; version?: string; message: string }>('/api/ha/test'));
    setCheck(res?.ok ? { state: 'ok', version: res.version } : { state: 'error', message: res?.message ?? '' });
  };
  const save = () => act(async () => {
    await patch('/api/settings', { ha: token ? { url, token } : { url } });
    setToken('');
    setCheck({ state: 'idle' });
  });

  const stateLabel =
    check.state === 'busy' ? t('ha.state.busy')
      : check.state === 'ok' ? t('ha.state.ok')
        : check.state === 'error' ? t('ha.state.error')
          : t(configured ? 'ha.state.idle' : 'ha.state.unconfigured');

  return (
    <>
      <div className="ha-bridge">
        <div className="card pad-lg" style={{ gap: 0 }}>
          <div className="ha-card-head">
            <span><Icon name="house-line" /> {t('ha.title')}</span>
            <span className={`tag ${check.state === 'error' || !configured ? 'tag-outline' : 'tag-accent'}`} aria-live="polite">{stateLabel}</span>
          </div>
          <div className="ha-card-meta">
            {info.url ? info.url.replace(/^https?:\/\//, '') : t('ha.noUrl')}
            {check.state === 'ok' && check.version ? ` · v${check.version}` : ''}
          </div>
          <div className="stack" style={{ gap: 12 }}>
            <Field label={t('ha.url')}><input className="input" value={url} placeholder="http://homeassistant.local:8123" onChange={e => setUrl(e.target.value)} /></Field>
            <Field label={t('ha.token')}>
              <input className="input" type="password" autoComplete="off" value={token} placeholder={info.hasToken ? '••••••••••••••••••••' : t('ha.tokenPlaceholder')} onChange={e => setToken(e.target.value)} />
            </Field>
          </div>
          {check.state === 'error' && <Note>{check.message}</Note>}
          <div className="row" style={{ marginTop: 14 }}>
            {(url !== info.url || token) && <button type="button" className="btn btn-primary" onClick={save}>{t('common.save')}</button>}
            <button type="button" className="btn btn-secondary" onClick={testConnection} disabled={check.state === 'busy' || !configured}>
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
          <Field label={t('ha.webhookUrl')}><input className="input mono" value={info.webhookUrl} readOnly onFocus={e => e.target.select()} /></Field>
          <div className="field-hint">{t('ha.webhookHint')}</div>
        </div>
      </div>

      <div className="section-title" style={{ marginBottom: 4 }}>{t('ha.entitiesTitle')}</div>
      <div className="section-hint" style={{ marginTop: 0 }}>{t('ha.entitiesSub')}</div>
      <ToggleList
        mono
        items={entities.map(e => ({
          title: e.id,
          desc: t(`ha.entity.${entityDesc[e.id] ?? 'unknown'}`) + (e.lastState !== null ? ` · ${t('ha.lastState', { state: e.lastState })}` : ''),
          on: e.enabled,
        }))}
        onToggle={i => act(() => patch(`/api/entities/${encodeURIComponent(entities[i].id)}`, { enabled: !entities[i].enabled }))}
      />
    </>
  );
}

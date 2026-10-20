import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Field, Icon, Loading, Note, Seg, ToggleList, ToggleRow } from '../components/ui';
import { api, del, patch, post, put, useAction, useApi } from '../lib/api';
import { formatAgo } from '../lib/format';
import type { ApiToken, Settings, SystemInfo } from '../lib/types';

const TIME_RULES = ['autoStop', 'longTimer', 'singleTimer'] as const;
const SCOPES = ['read', 'tickets:write', 'admin'] as const;

export function System() {
  const { t } = useTranslation();
  const system = useApi<SystemInfo>('/api/system');
  const settings = useApi<Settings>('/api/settings');
  const tokens = useApi<ApiToken[]>('/api/tokens');
  const act = useAction();
  const [newToken, setNewToken] = useState<{ name: string; scope: ApiToken['scope'] } | null>(null);
  const [created, setCreated] = useState<string | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  if (!system || !settings || !tokens) return <Loading />;
  const save = (body: object) => act(() => patch('/api/settings', body));

  const status = [
    { label: t('system.version'), value: system.version },
    { label: t('system.database'), value: system.database },
    { label: t('system.jobs'), value: t('system.jobsValue', { count: system.jobs }) },
    { label: t('system.ha'), value: t(system.ha.configured ? 'system.haConfigured' : 'system.haMissing') },
  ];

  const createToken = () => newToken && act(async () => {
    const res = await post<ApiToken>('/api/tokens', newToken);
    setCreated(res.token ?? null);
    setNewToken(null);
  });

  const restore = (file: File) => act(async () => {
    if (!window.confirm(t('system.importConfirm'))) return;
    await put('/api/backup', JSON.parse(await file.text()));
    window.location.reload(); // sessions were reset by the restore
  });

  return (
    <>
      <div className="stat-grid">
        {status.map(s => (
          <div key={s.label} className="card" style={{ padding: 16, gap: 0 }}>
            <div className="stat-label">{s.label}</div>
            <div className="status-value"><span className="dot" />{s.value}</div>
          </div>
        ))}
      </div>

      <div className="two-col">
        <div className="stack">
          <div className="card pad" style={{ gap: 14 }}>
            <div className="row-title">{t('system.general')}</div>
            <Field label={t('system.language')}><input className="input" value={t('system.languageValue')} readOnly /></Field>
            <Field label={t('system.timezone')}><input className="input" value={system.timezone} readOnly /></Field>
          </div>

          <ToggleList
            heading={t('system.timeTracking')}
            items={TIME_RULES.map(k => ({ title: t(`system.timeRule.${k}.title`), desc: t(`system.timeRule.${k}.desc`), on: settings.timeRules[k] }))}
            onToggle={i => save({ timeRules: { [TIME_RULES[i]]: !settings.timeRules[TIME_RULES[i]] } })}
          >
            <div style={{ padding: '14px 0' }}>
              <div className="control-label">{t('system.roundTo')}</div>
              <Seg
                label={t('system.roundTo')}
                options={([0, 5, 15] as const).map(n => ({ value: n, label: n ? t('system.roundMin', { n }) : t('system.roundNone') }))}
                value={settings.rounding}
                onChange={rounding => save({ rounding })}
              />
            </div>
          </ToggleList>

          <div className="card pad" style={{ gap: 14 }}>
            <div className="row-title">{t('system.oidc')}</div>
            {system.auth.mode === 'dev' ? <Note>{t('system.devMode')}</Note> : (
              <>
                <Field label={t('system.issuer')}><input className="input" value={system.auth.issuer ?? ''} readOnly /></Field>
                <Field label={t('system.clientId')}><input className="input" value={system.auth.clientId ?? ''} readOnly /></Field>
              </>
            )}
            <div className="field-hint">{t('system.oidcHint')}</div>
          </div>
        </div>

        <div className="stack">
          <div className="card pad" style={{ gap: 0 }}>
            <div className="row-title" style={{ marginBottom: 6 }}>{t('system.tokens')}</div>
            {tokens.map(tok => (
              <div key={tok.id} className="list-row" style={{ padding: '12px 0', gap: 12 }}>
                <span className="grow">{tok.name}<div className="user-mail mono">{tok.prefix}•••• · {t('system.tokenUsed', { when: formatAgo(tok.lastUsedAt) })}</div></span>
                <span className="tag tag-outline">{tok.scope}</span>
                <button type="button" className="btn btn-ghost btn-icon" aria-label={t('system.revokeToken')} onClick={() => window.confirm(t('system.revokeConfirm', { name: tok.name })) && act(() => del(`/api/tokens/${tok.id}`))}><Icon name="trash" /></button>
              </div>
            ))}
            {created && (
              <div className="secret-box">
                <div className="field-hint">{t('system.tokenOnce')}</div>
                <input className="input mono" value={created} readOnly onFocus={e => e.target.select()} />
                <button type="button" className="btn btn-ghost" onClick={() => setCreated(null)}>{t('common.done')}</button>
              </div>
            )}
            {newToken ? (
              <div className="stack" style={{ gap: 10, marginTop: 14 }}>
                <Field label={t('system.tokenName')}><input className="input" autoFocus value={newToken.name} onChange={e => setNewToken({ ...newToken, name: e.target.value })} /></Field>
                <Seg options={SCOPES.map(s => ({ value: s, label: s }))} value={newToken.scope} onChange={scope => setNewToken({ ...newToken, scope })} />
                <div className="row">
                  <button type="button" className="btn btn-primary" disabled={!newToken.name.trim()} onClick={createToken}>{t('system.createToken')}</button>
                  <button type="button" className="btn btn-ghost" onClick={() => setNewToken(null)}>{t('common.cancel')}</button>
                </div>
              </div>
            ) : (
              <div>
                <button type="button" className="btn btn-secondary" style={{ marginTop: 14 }} onClick={() => setNewToken({ name: t('system.newToken'), scope: 'tickets:write' })}><Icon name="plus" /> {t('system.createToken')}</button>
              </div>
            )}
          </div>

          <div className="card list-card">
            <ToggleRow last title={t('system.signature')} desc={t('system.signatureDesc')} on={settings.enforceSignature} onToggle={() => save({ enforceSignature: !settings.enforceSignature })} />
            {settings.enforceSignature && (
              <div style={{ paddingBottom: 14 }}>
                {secret
                  ? <Field label={t('system.signatureSecret')}><input className="input mono" value={secret} readOnly onFocus={e => e.target.select()} /></Field>
                  : <button type="button" className="btn btn-ghost" onClick={async () => setSecret((await api<{ secret: string }>('/api/settings/webhook-secret')).secret)}>{t('system.showSecret')}</button>}
              </div>
            )}
          </div>

          <div className="card pad" style={{ gap: 0 }}>
            <div className="row-title" style={{ marginBottom: 12 }}>{t('system.backup')}</div>
            <div className="row">
              <a className="btn btn-secondary" href="/api/backup" download onClick={() => window.setTimeout(() => act(async () => {}), 1500)}><Icon name="download-simple" /> {t('system.exportAll')}</a>
              <button type="button" className="btn btn-secondary" onClick={() => fileInput.current?.click()}><Icon name="upload-simple" /> {t('system.import')}</button>
              <input ref={fileInput} type="file" accept="application/json" hidden onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void restore(f); }} />
            </div>
            <div className="user-mail" style={{ marginTop: 10 }}>
              {settings.lastBackupAt ? t('system.lastBackup', { when: formatAgo(settings.lastBackupAt) }) : t('system.noBackup')}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

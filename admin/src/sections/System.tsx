import { useTranslation } from 'react-i18next';
import { Field, Icon, Seg, ToggleList, ToggleRow } from '../components/ui';
import { flipAt, useStore } from '../lib/store';

export function System() {
  const { t } = useTranslation();
  const { state, update } = useStore();

  const status = [
    { label: t('system.version'), value: '1.4.2' },
    { label: t('system.database'), value: 'PostgreSQL 16' },
    { label: t('system.jobs'), value: t('system.jobsValue', { count: 3 }) },
    { label: t('system.ha'), value: t('system.haConnected') },
  ];

  const addToken = () =>
    update(s => ({ tokens: [...s.tokens, { name: t('system.newToken'), key: `tl_new_${Math.random().toString(36).slice(2, 6)}••••`, scope: 'read' }] }));
  const revokeToken = (index: number) => update(s => ({ tokens: s.tokens.filter((_, i) => i !== index) }));

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
            <Field label={t('system.timezone')}><input className="input" value="Europe/Berlin" readOnly /></Field>
          </div>

          <ToggleList
            heading={t('system.timeTracking')}
            items={state.timeRules.map(r => ({ title: t(`system.timeRule.${r.key}.title`), desc: t(`system.timeRule.${r.key}.desc`), on: r.enabled }))}
            onToggle={i => update(s => ({ timeRules: flipAt(s.timeRules, i) }))}
          >
            <div style={{ padding: '14px 0' }}>
              <div className="control-label">{t('system.roundTo')}</div>
              <Seg
                label={t('system.roundTo')}
                options={([0, 5, 15] as const).map(n => ({ value: n, label: n ? t('system.roundMin', { n }) : t('system.roundNone') }))}
                value={state.rounding}
                onChange={rounding => update({ rounding })}
              />
            </div>
          </ToggleList>

          <div className="card pad" style={{ gap: 14 }}>
            <div className="row-title">{t('system.oidc')}</div>
            <Field label={t('system.issuer')}><input className="input" value="https://auth.example.com" readOnly /></Field>
            <Field label={t('system.clientId')}><input className="input" value="tasklog-app" readOnly /></Field>
          </div>
        </div>

        <div className="stack">
          <div className="card pad" style={{ gap: 0 }}>
            <div className="row-title" style={{ marginBottom: 6 }}>{t('system.tokens')}</div>
            {state.tokens.map((tok, i) => (
              <div key={tok.key} className="list-row" style={{ padding: '12px 0', gap: 12 }}>
                <span className="grow">{tok.name}<div className="user-mail mono">{tok.key}</div></span>
                <span className="tag tag-outline">{tok.scope}</span>
                <button type="button" className="btn btn-ghost btn-icon" aria-label={t('system.revokeToken')} onClick={() => revokeToken(i)}><Icon name="trash" /></button>
              </div>
            ))}
            <div>
              <button type="button" className="btn btn-secondary" style={{ marginTop: 14 }} onClick={addToken}><Icon name="plus" /> {t('system.createToken')}</button>
            </div>
          </div>

          <div className="card list-card">
            <ToggleRow last title={t('system.signature')} desc={t('system.signatureDesc')} on={state.enforceSignature} onToggle={() => update(s => ({ enforceSignature: !s.enforceSignature }))} />
          </div>

          <div className="card pad" style={{ gap: 0 }}>
            <div className="row-title" style={{ marginBottom: 12 }}>{t('system.backup')}</div>
            <div className="row">
              <button type="button" className="btn btn-secondary"><Icon name="download-simple" /> {t('system.exportAll')}</button>
              <button type="button" className="btn btn-secondary"><Icon name="upload-simple" /> {t('system.import')}</button>
            </div>
            <div className="user-mail" style={{ marginTop: 10 }}>{t('system.lastBackup')}</div>
          </div>
        </div>
      </div>
    </>
  );
}

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Field, Icon, Loading, Note } from '../components/ui';
import { api, patch, useAction, useApi } from '../lib/api';
import type { Settings } from '../lib/types';

/** Imprint, privacy notice (with a template that fits this installation) and how long data is kept. */
export function Privacy() {
  const { t } = useTranslation();
  const settings = useApi<Settings>('/api/settings');
  const act = useAction();
  const [imprint, setImprint] = useState<string | null>(null);
  const [privacy, setPrivacy] = useState<string | null>(null);

  useEffect(() => {
    if (settings && imprint === null) {
      setImprint(settings.legal.imprint);
      setPrivacy(settings.legal.privacy);
    }
  }, [settings, imprint]);

  if (!settings || imprint === null || privacy === null) return <Loading />;
  const dirty = imprint !== settings.legal.imprint || privacy !== settings.legal.privacy;

  const template = async () => {
    if ((imprint.trim() || privacy.trim()) && !window.confirm(t('privacy.templateConfirm'))) return;
    const tpl = await act(() => api<{ imprint: string; privacy: string }>('/api/legal/template'));
    if (!tpl) return;
    setImprint(tpl.imprint);
    setPrivacy(tpl.privacy);
  };
  const placeholders = /\[[^\]]+\]/.test(imprint + privacy);

  return (
    <>
      <Note>{t('privacy.intro')}</Note>
      <div className="row" style={{ gap: 8, margin: '16px 0' }}>
        <button type="button" className="btn btn-secondary" onClick={() => void template()}><Icon name="magic-wand" /> {t('privacy.template')}</button>
        <button type="button" className="btn btn-primary" disabled={!dirty} onClick={() => act(() => patch('/api/settings', { legal: { imprint, privacy } }))}>
          <Icon name="check" /> {t('common.save')}
        </button>
        <a className="btn btn-ghost" href="/#/impressum" target="_blank" rel="noreferrer"><Icon name="arrow-square-out" /> {t('privacy.viewImprint')}</a>
        <a className="btn btn-ghost" href="/#/datenschutz" target="_blank" rel="noreferrer"><Icon name="arrow-square-out" /> {t('privacy.viewPrivacy')}</a>
      </div>
      {placeholders && <Note>{t('privacy.placeholders')}</Note>}
      <div className="grid-2" style={{ alignItems: 'start', marginTop: 12 }}>
        <Field label={t('privacy.imprint')}>
          <textarea className="input mono legal-edit" rows={16} value={imprint} onChange={e => setImprint(e.target.value)} placeholder={t('privacy.emptyHint')} />
        </Field>
        <Field label={t('privacy.privacy')}>
          <textarea className="input mono legal-edit" rows={16} value={privacy} onChange={e => setPrivacy(e.target.value)} placeholder={t('privacy.emptyHint')} />
        </Field>
      </div>
      <div className="field-hint">{t('privacy.format')}</div>

      <div className="section-title" style={{ marginTop: 28 }}>{t('privacy.retention')}</div>
      <div className="grid-2" style={{ maxWidth: 640 }}>
        <Field label={t('privacy.logDays')}>
          <input className="input" type="number" min={0} max={3650} defaultValue={settings.retention.logDays}
            onBlur={e => Number(e.target.value) !== settings.retention.logDays && act(() => patch('/api/settings', { retention: { logDays: Number(e.target.value) } }))} />
        </Field>
        <Field label={t('privacy.doneTicketsDays')}>
          <input className="input" type="number" min={0} max={3650} defaultValue={settings.retention.doneTicketsDays}
            onBlur={e => Number(e.target.value) !== settings.retention.doneTicketsDays && act(() => patch('/api/settings', { retention: { doneTicketsDays: Number(e.target.value) } }))} />
        </Field>
      </div>
      <div className="field-hint" style={{ maxWidth: 640 }}>{t('privacy.retentionHint')}</div>
    </>
  );
}

import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Icon } from '../../components/ui';
import { patch, useAction } from '../../lib/api';
import type { Ticket } from '../../lib/types';

/** Title and description of a ticket; the pencil turns them into fields (Strg+Enter saves, Escape cancels). */
export function TicketText({ ticket, canEdit }: { ticket: Ticket; canEdit: boolean }) {
  const { t } = useTranslation();
  const act = useAction();
  const [draft, setDraft] = useState<{ title: string; description: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const id = useId();

  const save = async () => {
    if (!draft || !draft.title.trim() || busy) return;
    setBusy(true);
    const saved = await act(() => patch(`/api/tickets/${ticket.id}`, { title: draft.title.trim(), description: draft.description.trim() }));
    setBusy(false);
    if (saved) setDraft(null);
  };
  const keys = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') setDraft(null);
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); void save(); }
  };

  if (draft) {
    return (
      <form className="pwa-text-edit" onSubmit={e => { e.preventDefault(); void save(); }}>
        <div className="field">
          <label className="field-label" htmlFor={`${id}-title`}>{t('app.new.what')}</label>
          <input id={`${id}-title`} className="input" autoFocus maxLength={200} value={draft.title} onKeyDown={keys}
            onChange={e => setDraft({ ...draft, title: e.target.value })} />
        </div>
        <div className="field">
          <label className="field-label" htmlFor={`${id}-desc`}>{t('app.new.description')}</label>
          <textarea id={`${id}-desc`} className="input pwa-quick" rows={4} maxLength={4000} placeholder={t('app.new.optional')} value={draft.description} onKeyDown={keys}
            onChange={e => setDraft({ ...draft, description: e.target.value })} />
        </div>
        <div className="row" style={{ gap: 8 }}>
          <button type="submit" className="btn btn-primary" disabled={!draft.title.trim() || busy}><Icon name="check" /> {t('common.save')}</button>
          <button type="button" className="btn btn-ghost" onClick={() => setDraft(null)}>{t('common.cancel')}</button>
        </div>
      </form>
    );
  }

  return (
    <>
      <div className="pwa-title-row">
        <h1 className="pwa-h1 pwa-detail-title grow">{ticket.title}</h1>
        {canEdit && (
          <button type="button" className="btn btn-icon btn-ghost" aria-label={t('app.detail.edit')} title={t('app.detail.edit')}
            onClick={() => setDraft({ title: ticket.title, description: ticket.description })}>
            <Icon name="pencil-simple" />
          </button>
        )}
      </div>
      <p className="pwa-desc">{ticket.description || t('app.detail.noDescription')}</p>
    </>
  );
}

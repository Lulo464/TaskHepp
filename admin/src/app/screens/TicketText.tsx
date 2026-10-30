import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Icon, Seg } from '../../components/ui';
import { patch, useAction } from '../../lib/api';
import type { Ticket } from '../../lib/types';
import { useMyAreas } from '../areas';

/** Title, description, area and project of a ticket; the pencil turns them into fields (Strg+Enter saves, Escape cancels). */
export function TicketText({ ticket, canEdit }: { ticket: Ticket; canEdit: boolean }) {
  const { t } = useTranslation();
  const act = useAction();
  const areas = useMyAreas();
  const [draft, setDraft] = useState<{ title: string; description: string; areaId: number; projectId: number | null } | null>(null);
  const [busy, setBusy] = useState(false);
  const id = useId();

  const save = async () => {
    if (!draft || !draft.title.trim() || busy) return;
    setBusy(true);
    const saved = await act(() => patch(`/api/tickets/${ticket.id}`, { title: draft.title.trim(), description: draft.description.trim(), areaId: draft.areaId, projectId: draft.projectId }));
    setBusy(false);
    if (saved) setDraft(null);
  };
  const keys = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') setDraft(null);
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); void save(); }
  };

  if (draft) {
    // All areas, hidden ones too: the ticket may sit in one of them.
    const all = areas?.all ?? [];
    const projects = all.find(a => a.id === draft.areaId)?.projects ?? [];
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
        {all.length > 1 && (
          <div className="field">
            <span className="field-label">{t('rules.area')}</span>
            <Seg options={all.map(a => ({ value: a.id, label: a.name }))} value={draft.areaId} label={t('rules.area')}
              onChange={areaId => setDraft({ ...draft, areaId, projectId: areaId === draft.areaId ? draft.projectId : null })} />
          </div>
        )}
        {projects.length > 0 && (
          <div className="field">
            <label className="field-label" htmlFor={`${id}-project`}>{t('app.detail.project')}</label>
            <select id={`${id}-project`} className="input" value={draft.projectId ?? 0} onChange={e => setDraft({ ...draft, projectId: Number(e.target.value) || null })}>
              <option value={0}>{t('app.detail.noProject')}</option>
              {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
        )}
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
            onClick={() => setDraft({ title: ticket.title, description: ticket.description, areaId: ticket.areaId, projectId: ticket.projectId })}>
            <Icon name="pencil-simple" />
          </button>
        )}
      </div>
      <p className="pwa-desc">{ticket.description || t('app.detail.noDescription')}</p>
    </>
  );
}

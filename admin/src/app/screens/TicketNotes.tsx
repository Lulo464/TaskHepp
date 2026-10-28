import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Icon } from '../../components/ui';
import { del, post, useAction, useApi } from '../../lib/api';
import { formatTime } from '../../lib/format';
import type { Me, TicketNote } from '../../lib/types';

/** Today only the time, otherwise date and time. */
function formatWhen(iso: string, language: string) {
  const d = new Date(iso);
  if (d.toDateString() === new Date().toDateString()) return formatTime(iso);
  return `${d.toLocaleDateString(language, { day: 'numeric', month: 'short' })} ${formatTime(iso)}`;
}

/** Notes on a ticket: everyone reads them, members add, authors (and admins) delete their own. */
export function TicketNotes({ ticketId, me, canEdit }: { ticketId: number; me: Me; canEdit: boolean }) {
  const { t, i18n } = useTranslation();
  const notes = useApi<TicketNote[]>(`/api/tickets/${ticketId}/notes`);
  const act = useAction();
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);

  const add = async () => {
    if (!draft.trim() || busy) return;
    setBusy(true);
    const saved = await act(() => post(`/api/tickets/${ticketId}/notes`, { body: draft }));
    setBusy(false);
    if (saved) setDraft('');
  };
  const remove = (note: TicketNote) => window.confirm(t('app.notes.deleteConfirm')) && act(() => del(`/api/notes/${note.id}`));

  if (!notes?.length && !canEdit) return null;
  return (
    <section aria-labelledby={`notes-${ticketId}`}>
      <div className="pwa-kicker" id={`notes-${ticketId}`}>{t('app.notes.title')}{notes?.length ? ` · ${notes.length}` : ''}</div>
      {notes?.map(n => (
        <div key={n.id} className="pwa-note">
          <div className="pwa-note-head">
            <span className="pwa-row-meta">{n.user ?? t('app.notes.unknownUser')} · {formatWhen(n.createdAt, i18n.language)}</span>
            {canEdit && (n.userId === me.id || me.role === 'admin') && (
              <button type="button" className="btn btn-icon btn-ghost" aria-label={t('app.notes.delete')} title={t('app.notes.delete')} onClick={() => remove(n)}>
                <Icon name="trash" />
              </button>
            )}
          </div>
          <div className="pwa-note-body">{n.body}</div>
        </div>
      ))}
      {canEdit && (
        <form className="pwa-note-form" onSubmit={e => { e.preventDefault(); void add(); }}>
          <textarea
            className="input" rows={2} value={draft} maxLength={4000} placeholder={t('app.notes.placeholder')} aria-label={t('app.notes.placeholder')}
            onChange={e => setDraft(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); void add(); } }}
          />
          <button type="submit" className="btn btn-secondary" disabled={!draft.trim() || busy}><Icon name="note-pencil" /> {t('app.notes.add')}</button>
        </form>
      )}
    </section>
  );
}

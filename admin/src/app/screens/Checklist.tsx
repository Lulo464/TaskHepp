import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Linkify } from '../../components/Linkify';
import { Icon } from '../../components/ui';
import { del, patch, post, useAction, useApi } from '../../lib/api';
import type { ChecklistItem, Ticket } from '../../lib/types';

/** Checklist inside a ticket: tick off, add (several at once by pasting lines), rename by tapping the text, delete. */
export function Checklist({ ticket, canEdit }: { ticket: Ticket; canEdit: boolean }) {
  const { t } = useTranslation();
  const items = useApi<ChecklistItem[]>(`/api/tickets/${ticket.id}/checklist`);
  const act = useAction();
  const [draft, setDraft] = useState('');
  const [editing, setEditing] = useState<{ id: number; text: string } | null>(null);

  if (!items || (!items.length && !canEdit)) return null;
  const done = items.filter(i => i.done).length;

  const add = async () => {
    if (!draft.trim()) return;
    const saved = await act(() => post(`/api/tickets/${ticket.id}/checklist`, { text: draft }));
    if (saved) setDraft('');
  };
  const rename = async () => {
    if (!editing) return;
    const item = items.find(i => i.id === editing.id);
    if (editing.text.trim() && editing.text.trim() !== item?.text) await act(() => patch(`/api/checklist/${editing.id}`, { text: editing.text }));
    setEditing(null);
  };

  return (
    <section className="pwa-checklist" aria-label={t('app.checklist.title')}>
      <div className="pwa-kicker pwa-checklist-head">
        <span>{t('app.checklist.title')}</span>
        {items.length > 0 && <span>{done}/{items.length}</span>}
      </div>
      {items.length > 0 && (
        <div className="pwa-checklist-bar" role="progressbar" aria-valuemin={0} aria-valuemax={items.length} aria-valuenow={done} aria-label={t('app.checklist.progress')}>
          <span style={{ width: `${(done / items.length) * 100}%` }} />
        </div>
      )}
      {items.map(i => (
        <div key={i.id} className={`pwa-check${i.done ? ' is-done' : ''}`}>
          <button type="button" role="checkbox" aria-checked={i.done} className="pwa-check-box" disabled={!canEdit}
            aria-label={i.text} onClick={() => act(() => patch(`/api/checklist/${i.id}`, { done: !i.done }))}>
            <Icon name={i.done ? 'check-square' : 'square'} fill={i.done} />
          </button>
          {editing?.id === i.id ? (
            <input className="input pwa-check-edit" autoFocus value={editing.text} maxLength={500} aria-label={t('app.checklist.rename')}
              onChange={e => setEditing({ id: i.id, text: e.target.value })} onBlur={() => void rename()}
              onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') setEditing(null); }} />
          ) : (
            <span className="grow pwa-check-text pwa-wrap" onClick={() => canEdit && setEditing({ id: i.id, text: i.text })}><Linkify text={i.text} /></span>
          )}
          {canEdit && (
            <button type="button" className="btn btn-icon btn-ghost pwa-check-del" aria-label={t('app.checklist.delete', { text: i.text })}
              onClick={() => act(() => del(`/api/checklist/${i.id}`))}>
              <Icon name="x" />
            </button>
          )}
        </div>
      ))}
      {canEdit && (
        <form className="pwa-check-add" onSubmit={e => { e.preventDefault(); void add(); }}>
          <Icon name="plus" />
          <textarea className="input pwa-quick" rows={1} value={draft} placeholder={t('app.checklist.add')} aria-label={t('app.checklist.add')}
            onChange={e => setDraft(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void add(); } }} />
        </form>
      )}
      {canEdit && items.length > 0 && done === items.length && ticket.status !== 'done' && (
        <button type="button" className="btn btn-secondary pwa-check-finish" onClick={() => act(() => patch(`/api/tickets/${ticket.id}`, { status: 'done' }))}>
          <Icon name="check-circle" /> {t('app.checklist.finish')}
        </button>
      )}
    </section>
  );
}

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { Icon } from '../../components/ui';
import { del, useAction, useApi, useApiError, useRefresh } from '../../lib/api';
import { shrinkImage } from '../../lib/image';
import type { Attachment, Me, Ticket } from '../../lib/types';

/** Photos of a ticket: a grid of thumbnails, add from camera or gallery, full-screen view with delete. */
export function Photos({ ticket, me, canEdit }: { ticket: Ticket; me: Me; canEdit: boolean }) {
  const { t } = useTranslation();
  const photos = useApi<Attachment[]>(`/api/tickets/${ticket.id}/attachments`);
  const refresh = useRefresh();
  const { setError } = useApiError();
  const act = useAction();
  const input = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(0);
  const [open, setOpen] = useState<number | null>(null);

  if (!photos || (!photos.length && !canEdit)) return null;

  const add = async (files: FileList | null) => {
    if (!files?.length) return;
    const list = [...files];
    setUploading(list.length);
    for (const file of list) {
      try {
        const { blob, type, name } = await shrinkImage(file);
        const res = await fetch(`/api/tickets/${ticket.id}/attachments?name=${encodeURIComponent(name)}`, { method: 'POST', headers: { 'Content-Type': type }, body: blob });
        if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? res.statusText);
      } catch (err) {
        setError(t('app.photos.failed', { name: file.name, reason: (err as Error).message === 'unsupported' ? t('app.photos.unsupported') : (err as Error).message }));
      }
      setUploading(n => n - 1);
    }
    if (input.current) input.current.value = '';
    refresh();
  };

  return (
    <section className="pwa-photos" aria-label={t('app.photos.title')}>
      <div className="pwa-kicker" style={{ marginTop: 0 }}>{t('app.photos.title')}{photos.length ? ` · ${photos.length}` : ''}</div>
      <div className="pwa-photo-grid">
        {photos.map((p, i) => (
          <button key={p.id} type="button" className="pwa-photo" onClick={() => setOpen(i)} aria-label={t('app.photos.open', { name: p.fileName })}>
            <img src={`/api/attachments/${p.id}`} alt="" loading="lazy" decoding="async" />
          </button>
        ))}
        {canEdit && (
          <button type="button" className="pwa-photo pwa-photo-add" onClick={() => input.current?.click()} disabled={uploading > 0}>
            {uploading > 0 ? <span className="pwa-label">{t('app.photos.uploading', { count: uploading })}</span> : <><Icon name="camera-plus" /><span className="pwa-label">{t('app.photos.add')}</span></>}
          </button>
        )}
      </div>
      <input ref={input} type="file" accept="image/*" multiple hidden onChange={e => void add(e.target.files)} />
      {open !== null && photos[open] && (
        <Viewer photos={photos} index={open} onIndex={setOpen} onClose={() => setOpen(null)}
          canDelete={p => canEdit && (p.userId === me.id || me.role === 'admin')}
          onDelete={p => window.confirm(t('app.photos.deleteConfirm')) && act(async () => {
            await del(`/api/attachments/${p.id}`);
            setOpen(photos.length > 1 ? Math.max(0, open - 1) : null);
          })} />
      )}
    </section>
  );
}

function Viewer({ photos, index, onIndex, onClose, canDelete, onDelete }: {
  photos: Attachment[]; index: number; onIndex: (i: number) => void; onClose: () => void;
  canDelete: (p: Attachment) => boolean; onDelete: (p: Attachment) => void;
}) {
  const { t, i18n } = useTranslation();
  const p = photos[index];
  const close = useRef<HTMLButtonElement>(null);
  const go = (by: number) => onIndex((index + by + photos.length) % photos.length);

  useEffect(() => {
    close.current?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowLeft') go(-1);
      if (e.key === 'ArrowRight') go(1);
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  });

  return createPortal(
    <div className="pwa-viewer" role="dialog" aria-modal="true" aria-label={p.fileName} onClick={e => e.target === e.currentTarget && onClose()}>
      <img src={`/api/attachments/${p.id}`} alt={p.fileName} />
      <div className="pwa-viewer-bar">
        <span className="grow pwa-ellipsis">
          {p.user ?? ''} · {new Date(p.createdAt).toLocaleString(i18n.language, { day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' })}
          {photos.length > 1 ? ` · ${index + 1}/${photos.length}` : ''}
        </span>
        {photos.length > 1 && <button type="button" className="btn btn-icon btn-ghost" aria-label={t('app.photos.prev')} onClick={() => go(-1)}><Icon name="caret-left" /></button>}
        {photos.length > 1 && <button type="button" className="btn btn-icon btn-ghost" aria-label={t('app.photos.next')} onClick={() => go(1)}><Icon name="caret-right" /></button>}
        <a className="btn btn-icon btn-ghost" href={`/api/attachments/${p.id}`} download={p.fileName} aria-label={t('app.photos.download')}><Icon name="download-simple" /></a>
        {canDelete(p) && <button type="button" className="btn btn-icon btn-ghost" aria-label={t('app.photos.delete')} onClick={() => onDelete(p)}><Icon name="trash" /></button>}
        <button ref={close} type="button" className="btn btn-icon btn-ghost" aria-label={t('common.close')} onClick={onClose}><Icon name="x" /></button>
      </div>
    </div>,
    document.body,
  );
}

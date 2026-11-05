import qrcode from 'qrcode-generator';
import { useEffect, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Icon, Loading } from '../../components/ui';
import { api, del, patch, post, useAction, useApi } from '../../lib/api';
import { formatAgo } from '../../lib/format';
import type { Tag, Ticket } from '../../lib/types';
import { useMyAreas } from '../areas';
import { href, tagUrl } from '../router';
import { showToast } from '../toast';

type Draft = Pick<Tag, 'name' | 'action' | 'ticketId' | 'title' | 'areaId' | 'prio' | 'haTagId'>;

interface NdefWriter {
  write(message: { records: { recordType: string; data: string }[] }, opts?: { signal?: AbortSignal }): Promise<void>;
}
/** Web NFC: Chrome on Android writes tags straight from the app. */
const canWriteNfc = () => 'NDEFReader' in window;

/** The tag's link, to write on an NFC tag, copy, or print as a QR code. */
export function TagWriter({ tag }: { tag: Tag }) {
  const { t } = useTranslation();
  const url = tagUrl(tag.code);
  const [writing, setWriting] = useState<AbortController | null>(null);
  const [qr, setQr] = useState(false);

  const write = async () => {
    const abort = new AbortController();
    setWriting(abort);
    try {
      const Reader = (window as unknown as { NDEFReader: new () => NdefWriter }).NDEFReader;
      await new Reader().write({ records: [{ recordType: 'url', data: url }] }, { signal: abort.signal });
      showToast(t('app.tags.written', { name: tag.name }));
    } catch (err) {
      if ((err as Error).name !== 'AbortError') showToast(t('app.tags.writeFailed', { error: (err as Error).message }));
    } finally {
      setWriting(null);
    }
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      showToast(t('app.calendar.copied'));
    } catch {
      window.prompt(t('app.calendar.copyManually'), url);
    }
  };

  const svg = qr ? (() => {
    const code = qrcode(0, 'M');
    code.addData(url);
    code.make();
    return code.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
  })() : '';

  return (
    <div className="pwa-tag-writer">
      <input className="input mono" value={url} readOnly onFocus={e => e.target.select()} aria-label={t('app.tags.link')} />
      {writing ? (
        <div className="pwa-tag-writing" role="status">
          <Icon name="contactless-payment" />
          <span className="grow">{t('app.tags.holdNow')}</span>
          <button type="button" className="btn btn-ghost" onClick={() => writing.abort()}>{t('common.cancel')}</button>
        </div>
      ) : (
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          {canWriteNfc() && <button type="button" className="btn btn-primary" onClick={write}><Icon name="contactless-payment" /> {t('app.tags.write')}</button>}
          <button type="button" className="btn btn-secondary" onClick={copy}><Icon name="copy" /> {t('app.calendar.copy')}</button>
          <button type="button" className="btn btn-secondary" aria-expanded={qr} onClick={() => setQr(q => !q)}><Icon name="qr-code" /> {t('app.tags.qr')}</button>
        </div>
      )}
      {!canWriteNfc() && <p className="pwa-row-meta" style={{ margin: 0 }}>{t('app.tags.noWebNfc')}</p>}
      {qr && (
        <div className="pwa-tag-qr">
          {/* The SVG comes from qrcode-generator and holds only our own link. */}
          <div className="pwa-tag-qr-img" dangerouslySetInnerHTML={{ __html: svg }} />
          <a className="btn btn-ghost" download={`tasklog-${tag.name}.svg`} href={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`}><Icon name="download-simple" /> {t('app.tags.qrDownload')}</a>
        </div>
      )}
    </div>
  );
}

/** Name, what the tag does and, optionally, which Home Assistant tag it answers to. */
function TagForm({ initial, fixedTicket, onSave, onCancel }: { initial: Draft; fixedTicket?: boolean; onSave: (d: Draft) => Promise<unknown>; onCancel: () => void }) {
  const { t } = useTranslation();
  const id = useId();
  const [d, setD] = useState(initial);
  const areas = useMyAreas();
  const tickets = useApi<Ticket[]>(!fixedTicket && d.action !== 'create' ? '/api/tickets?open=true' : null);
  const [learning, setLearning] = useState(false);
  const set = (change: Partial<Draft>) => setD(x => ({ ...x, ...change }));

  // "In Home Assistant scannen": waits for a tag Tasklog does not know yet.
  useEffect(() => {
    if (!learning) return;
    const startedAt = Date.now();
    const poll = window.setInterval(async () => {
      const last = await api<{ tagId: string | null; secondsAgo?: number }>('/api/tags/ha/last').catch(() => null);
      if (last?.tagId && Date.now() - (last.secondsAgo ?? 0) * 1000 >= startedAt - 1000) {
        set({ haTagId: last.tagId });
        setLearning(false);
      }
    }, 1500);
    const stop = window.setTimeout(() => setLearning(false), 120_000);
    return () => { window.clearInterval(poll); window.clearTimeout(stop); };
  }, [learning]);

  const valid = d.name.trim() && (d.action === 'create' ? d.areaId : d.ticketId);
  const actions: Draft['action'][] = fixedTicket ? ['done', 'timer'] : ['done', 'timer', 'create'];

  return (
    <form className="pwa-tag-form" onSubmit={e => { e.preventDefault(); if (valid) void onSave(d); }}>
      <div className="field">
        <label className="field-label" htmlFor={`${id}-name`}>{t('app.tags.name')}</label>
        <input id={`${id}-name`} className="input" value={d.name} autoFocus placeholder={t('app.tags.namePlaceholder')} onChange={e => set({ name: e.target.value })} />
      </div>
      <div className="seg pwa-seg" role="radiogroup" aria-label={t('app.tags.action')}>
        {actions.map(a => (
          <button key={a} type="button" role="radio" aria-checked={d.action === a} className={`seg-opt seg-btn seg-fill${d.action === a ? ' is-active' : ''}`} onClick={() => set({ action: a })}>
            {t(`app.tags.do.${a}`)}
          </button>
        ))}
      </div>
      <p className="pwa-label" style={{ margin: 0 }}>{t(`app.tags.explain.${d.action}`)}</p>
      {d.action === 'create' ? (
        <>
          <div className="field">
            <label className="field-label" htmlFor={`${id}-title`}>{t('app.tags.ticketTitle')}</label>
            <input id={`${id}-title`} className="input" value={d.title ?? ''} placeholder={d.name || t('app.tags.titlePlaceholder')} onChange={e => set({ title: e.target.value })} />
          </div>
          <div className="row" style={{ gap: 8 }}>
            <select className="input grow" aria-label={t('app.calendar.area')} value={d.areaId ?? ''} onChange={e => set({ areaId: Number(e.target.value) || null })}>
              <option value="">{t('app.tags.chooseArea')}</option>
              {areas?.all.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
            <select className="input" aria-label={t('tickets.col.prio')} value={d.prio} onChange={e => set({ prio: e.target.value as Draft['prio'] })}>
              <option value="normal">{t('prio.normal')}</option>
              <option value="high">{t('prio.high')}</option>
            </select>
          </div>
        </>
      ) : !fixedTicket && (
        <select className="input" aria-label={t('app.tags.ticket')} value={d.ticketId ?? ''} onChange={e => set({ ticketId: Number(e.target.value) || null })}>
          <option value="">{t('app.tags.chooseTicket')}</option>
          {tickets?.map(x => <option key={x.id} value={x.id}>{x.title} · {x.area}</option>)}
        </select>
      )}
      <details className="pwa-tag-ha" open={Boolean(d.haTagId) || learning}>
        <summary>{t('app.tags.ha')}</summary>
        <p className="pwa-label">{t('app.tags.haIntro')}</p>
        <div className="row" style={{ gap: 8 }}>
          <input className="input mono grow" aria-label={t('app.tags.haId')} value={d.haTagId ?? ''} placeholder="z. B. 3f1c…" onChange={e => set({ haTagId: e.target.value || null })} />
          <button type="button" className="btn btn-secondary" disabled={learning} onClick={() => setLearning(true)}><Icon name="broadcast" /> {t('app.tags.haLearn')}</button>
        </div>
        {learning && <p className="pwa-row-meta" role="status">{t('app.tags.haWaiting')}</p>}
      </details>
      <div className="row" style={{ gap: 8 }}>
        <button type="submit" className="btn btn-primary" disabled={!valid}><Icon name="check" /> {t('common.save')}</button>
        <button type="button" className="btn btn-ghost" onClick={onCancel}>{t('common.cancel')}</button>
      </div>
    </form>
  );
}

function TagItem({ tag, canEdit, showTicket, fresh = false }: { tag: Tag; canEdit: boolean; showTicket: boolean; fresh?: boolean }) {
  const { t } = useTranslation();
  const act = useAction();
  // A new tag opens ready to be written.
  const [mode, setMode] = useState<'closed' | 'write' | 'edit'>(fresh ? 'write' : 'closed');
  const what = tag.action === 'create'
    ? t('app.tags.summary.create', { title: tag.title || tag.name, area: tag.area ?? '?' })
    : t(`app.tags.summary.${tag.action}`, { title: tag.ticket ?? t('app.tags.ticketGone') });

  const remove = () => window.confirm(t('app.tags.deleteConfirm', { name: tag.name })) && act(() => del(`/api/tags/${tag.id}`));

  return (
    <div className="pwa-tag">
      <div className="pwa-tag-head">
        <Icon name={tag.action === 'timer' ? 'timer' : tag.action === 'create' ? 'plus-circle' : 'check-circle'} className="accent" />
        <div className="grow">
          <div className="pwa-rule-name">{tag.name}{tag.haTagId && <span className="tag tag-outline pwa-tag-badge"><Icon name="house-line" /> HA</span>}</div>
          <div className="pwa-row-meta">
            {showTicket && tag.ticketId && tag.action !== 'create' ? <a href={href({ name: 'ticket', id: tag.ticketId })}>{what}</a> : what}
          </div>
          <div className="pwa-row-meta">
            {tag.lastScanAt ? t('app.tags.scanned', { count: tag.scans, when: formatAgo(tag.lastScanAt), by: tag.lastScanBy ?? '' }) : t('app.tags.neverScanned')}
          </div>
        </div>
        <button type="button" className="btn btn-icon btn-ghost" aria-label={t('app.tags.write')} aria-expanded={mode === 'write'} onClick={() => setMode(m => (m === 'write' ? 'closed' : 'write'))}><Icon name="contactless-payment" /></button>
        {canEdit && <button type="button" className="btn btn-icon btn-ghost" aria-label={t('app.tags.edit')} onClick={() => setMode(m => (m === 'edit' ? 'closed' : 'edit'))}><Icon name="pencil-simple" /></button>}
        {canEdit && <button type="button" className="btn btn-icon btn-ghost" aria-label={t('app.tags.delete')} onClick={remove}><Icon name="trash" /></button>}
      </div>
      {mode === 'write' && (
        <>
          {fresh && <p className="pwa-label" style={{ margin: '8px 0 0' }}>{t('app.tags.nowWrite')}</p>}
          <TagWriter tag={tag} />
        </>
      )}
      {mode === 'edit' && (
        <TagForm
          initial={tag}
          fixedTicket={!showTicket && tag.action !== 'create'}
          onCancel={() => setMode('closed')}
          onSave={async d => { if (await act(() => patch(`/api/tags/${tag.id}`, d))) setMode('closed'); }}
        />
      )}
    </div>
  );
}

/** On the ticket page: tags that close this ticket or run its timer. */
export function TicketTags({ ticket, canEdit }: { ticket: Ticket; canEdit: boolean }) {
  const { t } = useTranslation();
  const tags = useApi<Tag[]>(`/api/tags?ticketId=${ticket.id}`);
  const act = useAction();
  const [adding, setAdding] = useState(false);
  const [fresh, setFresh] = useState<number | null>(null);
  if (!tags || (!tags.length && !canEdit)) return null;

  return (
    <div className="pwa-tags-block">
      {tags.length > 0 && <div className="pwa-kicker">{t('app.tags.title')}</div>}
      {tags.map(tag => <TagItem key={tag.id} tag={tag} canEdit={canEdit} showTicket={false} fresh={tag.id === fresh} />)}
      {adding ? (
        <TagForm
          initial={{ name: ticket.title, action: 'done', ticketId: ticket.id, title: null, areaId: null, prio: 'normal', haTagId: null }}
          fixedTicket
          onCancel={() => setAdding(false)}
          onSave={async d => {
            const tag = await act(() => post<Tag>('/api/tags', d));
            if (tag) { setAdding(false); setFresh(tag.id); }
          }}
        />
      ) : canEdit && (
        <div className="pwa-auto">
          <Icon name="contactless-payment" />
          <button type="button" className="btn btn-ghost pwa-auto-add" onClick={() => setAdding(true)}>{t('app.tags.add')}</button>
        </div>
      )}
    </div>
  );
}

/** Mehr → NFC-Tags: all tags of the household. */
export function Tags({ canEdit }: { canEdit: boolean }) {
  const { t } = useTranslation();
  const tags = useApi<Tag[]>('/api/tags');
  const act = useAction();
  const [adding, setAdding] = useState(false);
  const [fresh, setFresh] = useState<number | null>(null);
  const back = <a className="btn btn-ghost pwa-back" href={href({ name: 'more' })}><Icon name="caret-left" /> {t('app.more.title')}</a>;
  if (!tags) return <div className="pwa-screen">{back}<Loading /></div>;

  return (
    <div className="pwa-screen">
      {back}
      <h1 className="pwa-h1" style={{ margin: '10px 0 6px' }}>{t('app.tags.title')}</h1>
      <p className="pwa-date" style={{ margin: '0 0 16px' }}>{t('app.tags.intro')}</p>
      <div className="card pwa-card">
        {tags.map(tag => <TagItem key={tag.id} tag={tag} canEdit={canEdit} showTicket fresh={tag.id === fresh} />)}
        {tags.length === 0 && !adding && <div className="pwa-row-meta">{t('app.tags.none')}</div>}
        {adding && (
          <TagForm
            initial={{ name: '', action: 'create', ticketId: null, title: null, areaId: null, prio: 'normal', haTagId: null }}
            onCancel={() => setAdding(false)}
            onSave={async d => {
              const tag = await act(() => post<Tag>('/api/tags', d));
              if (tag) { setAdding(false); setFresh(tag.id); }
            }}
          />
        )}
      </div>
      {canEdit && !adding && <button type="button" className="btn btn-secondary btn-block" style={{ marginTop: 14 }} onClick={() => setAdding(true)}><Icon name="plus" /> {t('app.tags.new')}</button>}
      <ul className="pwa-feed-help" style={{ marginTop: 18 }}>
        <li>{t('app.tags.helpAndroid')}</li>
        <li>{t('app.tags.helpIphone')}</li>
        <li>{t('app.tags.helpHa')}</li>
        <li>{t('app.tags.helpBuy')}</li>
      </ul>
    </div>
  );
}


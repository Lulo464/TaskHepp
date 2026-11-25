import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Icon, Loading } from '../../components/ui';
import { del, post, put, useAction, useApi } from '../../lib/api';
import type { Ticket, TicketTemplate, TemplateItem } from '../../lib/types';
import { useMyAreas } from '../areas';
import { href, navigate } from '../router';
import { showToast } from '../toast';

const ICONS = ['stack', 'airplane-tilt', 'suitcase', 'house', 'briefcase', 'car', 'gift', 'shopping-cart', 'broom', 'tree', 'baby', 'paw-print'];
const today = () => new Date().toLocaleDateString('sv-SE');

/** "2030-07-20" + 3 → "2030-07-23" */
function addDays(iso: string, days: number) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d + days).toLocaleDateString('sv-SE');
}

/** "7 Tage vorher", "am Stichtag", "3 Tage danach", "ohne Datum" */
export function offsetText(t: (k: string, o?: Record<string, unknown>) => string, offset: number | null) {
  if (offset === null) return t('app.templates.noDate');
  if (offset === 0) return t('app.templates.onDay');
  return t(offset < 0 ? 'app.templates.before' : 'app.templates.after', { count: Math.abs(offset) });
}

/** Choose the day the dates count from, the area and which items — then all tickets at once. */
export function ApplyTemplate({ template, onClose }: { template: TicketTemplate; onClose: () => void }) {
  const { t, i18n } = useTranslation();
  const id = useId();
  const areas = useMyAreas();
  const act = useAction();
  const [date, setDate] = useState(today());
  const [areaId, setAreaId] = useState<number | null>(template.areaId);
  const [skip, setSkip] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);
  const chosenArea = areaId ?? areas?.visible[0]?.id ?? null;
  const count = template.items.length - skip.size;
  const needsDate = template.items.some(i => i.offsetDays !== null);
  const formatDate = (iso: string) => {
    const [y, m, d] = iso.split('-').map(Number);
    return new Date(y, m - 1, d).toLocaleDateString(i18n.language, { weekday: 'short', day: 'numeric', month: 'numeric' });
  };

  const apply = async () => {
    if (!chosenArea || !count) return;
    setBusy(true);
    const res = await act(() => post<{ created: number; tickets: Ticket[] }>(`/api/templates/${template.id}/apply`, {
      date, areaId: chosenArea, only: template.items.map((_, i) => i).filter(i => !skip.has(i)),
    }));
    setBusy(false);
    if (!res) return;
    showToast(t('app.templates.created', { count: res.created, name: template.name }));
    onClose();
    navigate(res.created === 1 ? { name: 'ticket', id: res.tickets[0].id } : { name: 'plan' });
  };

  return (
    <div className="card pwa-card pwa-template-apply">
      <div className="pwa-account">
        <Icon name={template.icon} className="accent" />
        <span className="grow pwa-rule-name">{template.name}</span>
        <button type="button" className="btn btn-icon btn-ghost" aria-label={t('common.close')} onClick={onClose}><Icon name="x" /></button>
      </div>
      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        {needsDate && (
          <div className="field grow">
            <label className="field-label" htmlFor={`${id}-date`}>{t('app.templates.baseDate')}</label>
            <input id={`${id}-date`} className="input" type="date" value={date} onChange={e => setDate(e.target.value || today())} />
          </div>
        )}
        <div className="field grow">
          <label className="field-label" htmlFor={`${id}-area`}>{t('app.calendar.area')}</label>
          <select id={`${id}-area`} className="input" value={chosenArea ?? ''} onChange={e => setAreaId(Number(e.target.value))}>
            {areas?.visible.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </div>
      </div>
      <ul className="pwa-template-preview" aria-label={t('app.templates.preview')}>
        {template.items.map((item, i) => (
          <li key={i} className={skip.has(i) ? 'is-skipped' : undefined}>
            <button type="button" role="checkbox" aria-checked={!skip.has(i)} className="btn btn-icon btn-ghost"
              onClick={() => setSkip(s => { const n = new Set(s); if (n.has(i)) n.delete(i); else n.add(i); return n; })}>
              <Icon name={skip.has(i) ? 'square' : 'check-square'} fill={!skip.has(i)} />
            </button>
            <span className="grow">
              {item.title}
              {item.prio === 'high' && <span className="tag tag-outline pwa-tag-badge">{t('prio.high')}</span>}
              {item.checklist.length > 0 && <span className="pwa-row-meta"> · ☑ {item.checklist.length}</span>}
            </span>
            <span className="pwa-row-meta pwa-num">
              {item.offsetDays === null ? t('app.templates.noDate') : `${formatDate(addDays(date, item.offsetDays))}${item.dueTime ? ` ${item.dueTime}` : ''}`}
            </span>
          </li>
        ))}
      </ul>
      <button type="button" className="btn btn-primary btn-block" disabled={busy || !count || !chosenArea} onClick={apply}>
        <Icon name="plus-circle" /> {t('app.templates.apply', { count })}
      </button>
    </div>
  );
}

const emptyItem = (): TemplateItem => ({ title: '', description: '', prio: 'normal', offsetDays: 0, dueTime: null, checklist: [] });

/** Name, icon, default area and the tickets it creates. */
function TemplateEditor({ initial, onDone }: { initial: Partial<TicketTemplate> & { items: TemplateItem[] }; onDone: () => void }) {
  const { t } = useTranslation();
  const id = useId();
  const areas = useMyAreas();
  const act = useAction();
  const [name, setName] = useState(initial.name ?? '');
  const [icon, setIcon] = useState(initial.icon ?? 'stack');
  const [areaId, setAreaId] = useState<number | null>(initial.areaId ?? null);
  const [items, setItems] = useState<TemplateItem[]>(initial.items.length ? initial.items : [emptyItem()]);
  const setItem = (i: number, change: Partial<TemplateItem>) => setItems(list => list.map((x, j) => (j === i ? { ...x, ...change } : x)));
  const move = (i: number, by: number) => setItems(list => {
    const next = [...list];
    const [x] = next.splice(i, 1);
    next.splice(i + by, 0, x);
    return next;
  });
  const valid = name.trim() && items.length && items.every(i => i.title.trim());

  const save = async () => {
    const body = { name: name.trim(), icon, areaId, items: items.map(i => ({ ...i, title: i.title.trim(), checklist: i.checklist.map(c => c.trim()).filter(Boolean) })) };
    const ok = await act(() => (initial.id ? put(`/api/templates/${initial.id}`, body) : post('/api/templates', body)));
    if (ok) onDone();
  };
  const remove = () => initial.id && window.confirm(t('app.templates.deleteConfirm', { name: initial.name })) && act(async () => {
    await del(`/api/templates/${initial.id}`);
    onDone();
  });

  return (
    <form className="card pwa-card pwa-template-edit" onSubmit={e => { e.preventDefault(); if (valid) void save(); }}>
      <div className="field">
        <label className="field-label" htmlFor={`${id}-name`}>{t('app.templates.name')}</label>
        <input id={`${id}-name`} className="input" value={name} autoFocus={!initial.id} placeholder={t('app.templates.namePlaceholder')} onChange={e => setName(e.target.value)} />
      </div>
      <div className="pwa-icon-pick" role="radiogroup" aria-label={t('app.templates.icon')}>
        {ICONS.map(i => (
          <button key={i} type="button" role="radio" aria-checked={icon === i} aria-label={i} className={`btn btn-icon btn-ghost${icon === i ? ' is-active' : ''}`} onClick={() => setIcon(i)}>
            <Icon name={i} fill={icon === i} />
          </button>
        ))}
      </div>
      <div className="field">
        <label className="field-label" htmlFor={`${id}-area`}>{t('app.templates.area')}</label>
        <select id={`${id}-area`} className="input" value={areaId ?? ''} onChange={e => setAreaId(e.target.value ? Number(e.target.value) : null)}>
          <option value="">{t('app.templates.areaLater')}</option>
          {areas?.all.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
      </div>

      <div className="pwa-kicker" style={{ marginTop: 6 }}>{t('app.templates.items', { count: items.length })}</div>
      {items.map((item, i) => (
        <div key={i} className="pwa-template-item">
          <div className="row" style={{ gap: 6 }}>
            <input className="input grow" aria-label={t('app.templates.itemTitle', { n: i + 1 })} placeholder={t('app.templates.itemTitlePlaceholder')} value={item.title}
              onChange={e => setItem(i, { title: e.target.value })} />
            <button type="button" className="btn btn-icon btn-ghost" aria-label={t('app.templates.up')} disabled={i === 0} onClick={() => move(i, -1)}><Icon name="caret-up" /></button>
            <button type="button" className="btn btn-icon btn-ghost" aria-label={t('app.templates.down')} disabled={i === items.length - 1} onClick={() => move(i, 1)}><Icon name="caret-down" /></button>
            <button type="button" className="btn btn-icon btn-ghost" aria-label={t('app.templates.removeItem')} disabled={items.length === 1} onClick={() => setItems(list => list.filter((_, j) => j !== i))}><Icon name="trash" /></button>
          </div>
          <div className="row pwa-template-when" style={{ gap: 6 }}>
            <select className="input" aria-label={t('app.templates.when')} value={item.offsetDays === null ? 'none' : item.offsetDays === 0 ? 'on' : item.offsetDays < 0 ? 'before' : 'after'}
              onChange={e => {
                const v = e.target.value;
                const n = Math.abs(item.offsetDays ?? 0) || 1;
                setItem(i, { offsetDays: v === 'none' ? null : v === 'on' ? 0 : v === 'before' ? -n : n, ...(v === 'none' ? { dueTime: null } : {}) });
              }}>
              <option value="none">{t('app.templates.noDate')}</option>
              <option value="on">{t('app.templates.onDay')}</option>
              <option value="before">{t('app.templates.daysBefore')}</option>
              <option value="after">{t('app.templates.daysAfter')}</option>
            </select>
            {item.offsetDays !== null && item.offsetDays !== 0 && (
              <input className="input" type="number" min={1} max={365} style={{ width: 70 }} aria-label={t('app.templates.days')} value={Math.abs(item.offsetDays)}
                onChange={e => { const n = Math.max(1, Math.min(365, Number(e.target.value) || 1)); setItem(i, { offsetDays: (item.offsetDays ?? 0) < 0 ? -n : n }); }} />
            )}
            {item.offsetDays !== null && (
              <input className="input" type="time" aria-label={t('app.new.time')} value={item.dueTime ?? ''} onChange={e => setItem(i, { dueTime: e.target.value || null })} />
            )}
            <button type="button" role="switch" aria-checked={item.prio === 'high'} className={`btn btn-ghost pwa-prio-toggle${item.prio === 'high' ? ' is-active' : ''}`}
              onClick={() => setItem(i, { prio: item.prio === 'high' ? 'normal' : 'high' })}>
              <Icon name="flag" fill={item.prio === 'high'} /> {t('prio.high')}
            </button>
          </div>
          <details className="pwa-template-more" open={Boolean(item.description || item.checklist.length)}>
            <summary>{t('app.templates.more')}</summary>
            <textarea className="input" rows={2} aria-label={t('app.new.description')} placeholder={t('app.new.description')} value={item.description}
              onChange={e => setItem(i, { description: e.target.value })} />
            <textarea className="input" rows={3} aria-label={t('app.templates.checklist')} placeholder={t('app.templates.checklistPlaceholder')} value={item.checklist.join('\n')}
              onChange={e => setItem(i, { checklist: e.target.value.split('\n') })} />
          </details>
        </div>
      ))}
      <button type="button" className="btn btn-secondary" onClick={() => setItems(list => [...list, emptyItem()])}><Icon name="plus" /> {t('app.templates.addItem')}</button>
      <div className="row" style={{ gap: 8, marginTop: 6 }}>
        <button type="submit" className="btn btn-primary" disabled={!valid}><Icon name="check" /> {t('common.save')}</button>
        <button type="button" className="btn btn-ghost" onClick={onDone}>{t('common.cancel')}</button>
        <span className="grow" />
        {initial.id && <button type="button" className="btn btn-ghost" onClick={remove}><Icon name="trash" /> {t('common.delete')}</button>}
      </div>
    </form>
  );
}

/** Mehr → Vorlagen. */
export function Templates({ canEdit }: { canEdit: boolean }) {
  const { t } = useTranslation();
  const templates = useApi<TicketTemplate[]>('/api/templates');
  const example = useApi<Omit<TicketTemplate, 'id' | 'areaId' | 'area'>>(canEdit ? '/api/templates/example' : null);
  const [editing, setEditing] = useState<(Partial<TicketTemplate> & { items: TemplateItem[] }) | null>(null);
  const [using, setUsing] = useState<number | null>(null);
  const back = <a className="btn btn-ghost pwa-back" href={href({ name: 'more' })}><Icon name="caret-left" /> {t('app.more.title')}</a>;
  if (!templates) return <div className="pwa-screen">{back}<Loading /></div>;

  return (
    <div className="pwa-screen">
      {back}
      <h1 className="pwa-h1" style={{ margin: '10px 0 6px' }}>{t('app.templates.title')}</h1>
      <p className="pwa-date" style={{ margin: '0 0 16px' }}>{t('app.templates.intro')}</p>
      {editing ? <TemplateEditor initial={editing} onDone={() => setEditing(null)} /> : (
        <>
          {templates.map(tpl => (using === tpl.id ? <ApplyTemplate key={tpl.id} template={tpl} onClose={() => setUsing(null)} /> : (
            <div key={tpl.id} className="card pwa-card pwa-template">
              <div className="pwa-account">
                <Icon name={tpl.icon} className="accent" />
                <div className="grow">
                  <div className="pwa-rule-name">{tpl.name}</div>
                  <div className="pwa-row-meta">{t('app.templates.summary', { count: tpl.items.length, area: tpl.area ?? t('app.templates.anyArea') })}</div>
                </div>
                {canEdit && <button type="button" className="btn btn-icon btn-ghost" aria-label={t('app.templates.edit')} onClick={() => setEditing(tpl)}><Icon name="pencil-simple" /></button>}
              </div>
              {canEdit && <button type="button" className="btn btn-secondary btn-block" onClick={() => setUsing(tpl.id)}><Icon name="play" /> {t('app.templates.use')}</button>}
            </div>
          )))}
          {templates.length === 0 && <div className="pwa-empty">{t('app.templates.none')}</div>}
          {canEdit && (
            <div className="stack" style={{ gap: 10, marginTop: 14 }}>
              <button type="button" className="btn btn-secondary btn-block" onClick={() => setEditing({ items: [] })}><Icon name="plus" /> {t('app.templates.new')}</button>
              {templates.length === 0 && example && (
                <button type="button" className="btn btn-ghost btn-block" onClick={() => setEditing(example)}><Icon name="airplane-tilt" /> {t('app.templates.example', { name: example.name })}</button>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

/** On "Neu": the templates as chips, one tap opens them ready to use. */
export function TemplatePicker() {
  const { t } = useTranslation();
  const templates = useApi<TicketTemplate[]>('/api/templates');
  const [using, setUsing] = useState<number | null>(null);
  if (!templates?.length) return null;
  const chosen = templates.find(x => x.id === using);
  return (
    <div className="pwa-template-picker">
      <div className="pwa-chips" role="group" aria-label={t('app.templates.fromTemplate')}>
        <span className="pwa-label" style={{ alignSelf: 'center' }}>{t('app.templates.fromTemplate')}</span>
        {templates.map(tpl => (
          <button key={tpl.id} type="button" className={`pwa-chip${using === tpl.id ? ' is-active' : ''}`} aria-pressed={using === tpl.id} onClick={() => setUsing(using === tpl.id ? null : tpl.id)}>
            <Icon name={tpl.icon} /> {tpl.name}
          </button>
        ))}
      </div>
      {chosen && <ApplyTemplate template={chosen} onClose={() => setUsing(null)} />}
    </div>
  );
}

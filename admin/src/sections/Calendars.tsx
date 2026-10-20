import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Field, Icon, LabeledSeg, Loading, Note, ToggleRow } from '../components/ui';
import { api, del, patch, post, useAction, useApi } from '../lib/api';
import { formatAgo, ticketTag } from '../lib/format';
import type { Area, CalendarEventPreview, CalendarSource } from '../lib/types';

type Editable = Partial<Omit<CalendarSource, 'id' | 'lastSyncAt' | 'lastError'>>;

const formatDay = (iso: string, lang: string) => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(lang, { weekday: 'short', day: '2-digit', month: '2-digit' });
};

/** Home Assistant calendars (e.g. waste collection) whose events become tickets. */
export function Calendars() {
  const { t, i18n } = useTranslation();
  const sources = useApi<CalendarSource[]>('/api/calendars');
  const areas = useApi<Area[]>('/api/areas');
  const act = useAction();
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [picker, setPicker] = useState<{ entity_id: string; name: string }[] | null>(null);
  const [pick, setPick] = useState('');
  const [syncInfo, setSyncInfo] = useState<string | null>(null);

  const selected = sources?.find(s => s.id === selectedId) ?? sources?.[0] ?? null;
  const events = useApi<CalendarEventPreview[]>(selected ? `/api/calendars/${selected.id}/events` : null);
  const [draft, setDraft] = useState({ name: '', titleTemplate: '' });
  useEffect(() => {
    if (selected) setDraft({ name: selected.name, titleTemplate: selected.titleTemplate });
    setSyncInfo(null);
  }, [selected?.id]); // only when switching calendars, not on every refetch

  if (!sources || !areas) return <Loading />;

  const save = (body: Editable) => selected && act(() => patch(`/api/calendars/${selected.id}`, body));

  const openPicker = () => act(async () => {
    const list = await api<{ entity_id: string; name: string }[]>('/api/ha/calendars');
    const free = list.filter(c => !sources.some(s => s.entityId === c.entity_id));
    setPicker(free);
    setPick(free.find(c => /abfall|m(ü|ue)ll|waste/i.test(c.entity_id + c.name))?.entity_id ?? free[0]?.entity_id ?? '');
  });

  const add = () => act(async () => {
    if (!areas.length) throw new Error(t('rules.needArea'));
    const cal = picker?.find(c => c.entity_id === pick);
    if (!cal) return;
    const home = areas.find(a => /zuhause|haus|home/i.test(a.name)) ?? areas[0];
    const created = await post<CalendarSource>('/api/calendars', {
      entityId: cal.entity_id, name: cal.name || cal.entity_id, areaId: home.id, titleTemplate: t('calendars.defaultTemplate'),
      leadDays: 1, lookaheadDays: 14, prio: 'normal', autoClose: true, enabled: true,
    });
    setPicker(null);
    setSelectedId(created.id);
  });

  const sync = () => selected && act(async () => {
    const r = await post<{ events: number; created: number; closed: number }>(`/api/calendars/${selected.id}/sync`);
    setSyncInfo(t('calendars.syncResult', { events: r.events, created: r.created, closed: r.closed }));
  });

  const remove = () => selected && window.confirm(t('calendars.deleteConfirm', { name: selected.name })) && act(async () => {
    await del(`/api/calendars/${selected.id}`);
    setSelectedId(null);
  });

  return (
    <div className="rules-layout">
      <div>
        <div className="card list-card" style={{ padding: '4px 16px' }}>
          {sources.map(s => (
            <button key={s.id} type="button" className={`rule-item${s.id === selected?.id ? ' is-active' : ''}`} aria-pressed={s.id === selected?.id} onClick={() => setSelectedId(s.id)}>
              <span className="grow">
                <span className="row-title">{s.name}</span>
                <span className="rule-when mono" style={{ display: 'block' }}>{s.entityId}</span>
              </span>
              <span className={`tag ${s.lastError ? 'tag-outline' : s.enabled ? 'tag-accent' : 'tag-neutral'}`}>
                {t(s.lastError ? 'calendars.error' : s.enabled ? 'rules.active' : 'rules.off')}
              </span>
            </button>
          ))}
          {sources.length === 0 && <div className="muted" style={{ padding: '14px 0' }}>{t('calendars.empty')}</div>}
          {!picker && (
            <button type="button" className="btn btn-secondary btn-block" style={{ margin: '14px 0' }} onClick={openPicker}>
              <Icon name="plus" /> {t('calendars.add')}
            </button>
          )}
        </div>

        {picker && (
          <div className="card pad" style={{ marginTop: 16, gap: 12 }}>
            {picker.length === 0 ? <div className="muted">{t('calendars.noneLeft')}</div> : (
              <Field label={t('calendars.pick')}>
                <select className="input" value={pick} onChange={e => setPick(e.target.value)}>
                  {picker.map(c => <option key={c.entity_id} value={c.entity_id}>{c.name} ({c.entity_id})</option>)}
                </select>
              </Field>
            )}
            <div className="row">
              {picker.length > 0 && <button type="button" className="btn btn-primary" onClick={add}>{t('calendars.link')}</button>}
              <button type="button" className="btn btn-ghost" onClick={() => setPicker(null)}>{t('common.cancel')}</button>
            </div>
          </div>
        )}
      </div>

      {selected && (
        <div className="stack">
          <div className="card editor">
            <div className="kicker accent">{t('calendars.edit')}</div>
            <Field label={t('rules.name')}>
              <input className="input" value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })} onBlur={() => draft.name.trim() && draft.name !== selected.name && save({ name: draft.name })} />
            </Field>
            <Field label={t('calendars.template')}>
              <input className="input" value={draft.titleTemplate} onChange={e => setDraft({ ...draft, titleTemplate: e.target.value })} onBlur={() => draft.titleTemplate.trim() && draft.titleTemplate !== selected.titleTemplate && save({ titleTemplate: draft.titleTemplate })} />
            </Field>
            <div className="field-hint" style={{ marginTop: -8 }}>{t('calendars.templateHint')}</div>
            <div className="grid-2">
              <LabeledSeg title={t('rules.area')} options={areas.map(a => ({ value: a.id, label: a.name }))} value={selected.areaId} onChange={areaId => save({ areaId })} />
              <LabeledSeg title={t('rules.prio')} options={[{ value: 'normal' as const, label: t('prio.normal') }, { value: 'high' as const, label: t('prio.high') }]} value={selected.prio} onChange={prio => save({ prio })} />
            </div>
            <LabeledSeg
              title={t('calendars.due')}
              options={[0, 1, 2].map(n => ({ value: n, label: t(`calendars.lead${n}`) }))}
              value={selected.leadDays}
              onChange={leadDays => save({ leadDays })}
            />
            <LabeledSeg
              title={t('calendars.lookahead')}
              options={[7, 14, 30].map(n => ({ value: n, label: t('calendars.days', { n }) }))}
              value={selected.lookaheadDays}
              onChange={lookaheadDays => save({ lookaheadDays })}
            />
            <div className="list-card" style={{ padding: 0 }}>
              <ToggleRow title={t('calendars.autoClose')} desc={t('calendars.autoCloseDesc')} on={selected.autoClose} onToggle={() => save({ autoClose: !selected.autoClose })} />
              <ToggleRow last title={t('calendars.enabled')} desc={t('calendars.enabledDesc')} on={selected.enabled} onToggle={() => save({ enabled: !selected.enabled })} />
            </div>
            <div className="row">
              <button type="button" className="btn btn-primary" onClick={sync}><Icon name="arrows-clockwise" /> {t('calendars.syncNow')}</button>
              <button type="button" className="btn btn-ghost" onClick={remove}><Icon name="trash" /> {t('common.delete')}</button>
            </div>
            <div className="field-hint" style={{ marginTop: 0 }}>
              {syncInfo ?? (selected.lastSyncAt ? t('calendars.lastSync', { when: formatAgo(selected.lastSyncAt) }) : t('calendars.neverSynced'))}
            </div>
            {selected.lastError && <Note>{selected.lastError}</Note>}
          </div>

          <div>
            <div className="section-title">{t('calendars.upcoming')}</div>
            <div className="card list-card">
              {!events ? <div className="list-row"><Loading /></div> : events.map(e => (
                <div key={`${e.date}|${e.summary}`} className="list-row">
                  <span className="accent" style={{ width: 90, flex: 'none' }}>{formatDay(e.date, i18n.language)}</span>
                  <span className="grow">{e.summary}<div className="user-mail">{e.ticketTitle} · {t('calendars.dueOn', { date: formatDay(e.due, i18n.language) })}</div></span>
                  {e.imported
                    ? <span className={`tag ${e.ticketStatus ? ticketTag[e.ticketStatus] : 'tag-neutral'}`}>{e.ticketStatus ? t(`status.${e.ticketStatus}`) : t('calendars.ticketDeleted')}</span>
                    : <span className="tag tag-neutral">{t('calendars.createdFrom', { date: formatDay(e.createFrom, i18n.language) })}</span>}
                </div>
              ))}
              {events?.length === 0 && <div className="list-row muted">{t('calendars.noEvents')}</div>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

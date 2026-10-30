import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Icon } from '../../components/ui';
import { patch, useAction, useApi } from '../../lib/api';
import type { Ticket } from '../../lib/types';

interface Entity {
  id: string;
  name: string;
  state: string;
}

const COMMON_STATES = ['on', 'off', 'idle', 'home', 'not_home', 'open', 'closed', 'locked', 'unlocked', 'docked', 'standby'];

/** "Erledigt, wenn …": the ticket closes itself when a Home Assistant entity changes to a state. */
export function AutoClose({ ticket, canEdit }: { ticket: Ticket; canEdit: boolean }) {
  const { t } = useTranslation();
  const id = useId();
  const act = useAction();
  const [draft, setDraft] = useState<{ entity: string; state: string } | null>(null);
  // Only while choosing: the list of entities can be long.
  const entities = useApi<Entity[]>(canEdit && (draft || ticket.autoClose) ? '/api/ha/entities' : null);
  const rule = ticket.autoClose;
  if (!rule && !canEdit) return null;

  const find = (entityId: string) => entities?.find(e => e.id === entityId);
  const save = async (value: { entity: string; state: string } | null) => {
    const done = await act(() => patch(`/api/tickets/${ticket.id}`, { autoClose: value }));
    if (done) setDraft(null);
  };

  if (draft) {
    const chosen = find(draft.entity);
    const states = [...new Set([chosen?.state, ...COMMON_STATES].filter((s): s is string => Boolean(s) && s !== 'unavailable' && s !== 'unknown'))];
    return (
      <form className="pwa-auto-edit" onSubmit={e => { e.preventDefault(); if (draft.entity && draft.state.trim()) void save({ entity: draft.entity.trim(), state: draft.state.trim() }); }}>
        <div className="field">
          <label className="field-label" htmlFor={`${id}-entity`}>{t('app.autoClose.entity')}</label>
          <input id={`${id}-entity`} className="input mono" list={`${id}-entities`} autoFocus value={draft.entity} placeholder="sensor.waschmaschine"
            onChange={e => setDraft({ ...draft, entity: e.target.value })} />
          <datalist id={`${id}-entities`}>
            {entities?.map(e => <option key={e.id} value={e.id}>{e.name} · {e.state}</option>)}
          </datalist>
          {chosen && <span className="field-hint">{t('app.autoClose.now', { name: chosen.name, state: chosen.state })}</span>}
          {entities?.length === 0 && <span className="field-hint">{t('app.autoClose.noHa')}</span>}
        </div>
        <div className="field">
          <label className="field-label" htmlFor={`${id}-state`}>{t('app.autoClose.state')}</label>
          <input id={`${id}-state`} className="input mono" list={`${id}-states`} value={draft.state} placeholder="idle"
            onChange={e => setDraft({ ...draft, state: e.target.value })} />
          <datalist id={`${id}-states`}>{states.map(s => <option key={s} value={s} />)}</datalist>
        </div>
        <p className="pwa-label" style={{ margin: 0 }}>{t('app.autoClose.how')}</p>
        <div className="row" style={{ gap: 8 }}>
          <button type="submit" className="btn btn-primary" disabled={!draft.entity.trim() || !draft.state.trim()}><Icon name="check" /> {t('common.save')}</button>
          <button type="button" className="btn btn-ghost" onClick={() => setDraft(null)}>{t('common.cancel')}</button>
        </div>
      </form>
    );
  }

  return (
    <div className="pwa-auto">
      <Icon name="lightning" />
      {rule ? (
        <>
          <span className="grow">{t('app.autoClose.rule', { name: find(rule.entity)?.name ?? rule.entity, state: rule.state })}</span>
          {canEdit && <button type="button" className="btn btn-icon btn-ghost" aria-label={t('app.autoClose.change')} onClick={() => setDraft({ ...rule })}><Icon name="pencil-simple" /></button>}
          {canEdit && <button type="button" className="btn btn-icon btn-ghost" aria-label={t('app.autoClose.remove')} onClick={() => void save(null)}><Icon name="x" /></button>}
        </>
      ) : (
        <button type="button" className="btn btn-ghost pwa-auto-add" onClick={() => setDraft({ entity: '', state: '' })}>{t('app.autoClose.add')}</button>
      )}
    </div>
  );
}

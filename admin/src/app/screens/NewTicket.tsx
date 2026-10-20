import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Field, Icon, Loading, Seg } from '../../components/ui';
import { post, useAction, useApi } from '../../lib/api';
import type { Area, Ticket } from '../../lib/types';
import { href, navigate } from '../router';
import type { Timers } from '../timer';

export function NewTicket({ timers }: { timers: Timers }) {
  const { t } = useTranslation();
  const areas = useApi<Area[]>('/api/areas');
  const act = useAction();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [areaId, setAreaId] = useState<number | null>(null);
  const [due, setDue] = useState(() => new Date().toLocaleDateString('sv-SE'));
  const [busy, setBusy] = useState(false);

  useEffect(() => { if (areas?.length && areaId === null) setAreaId(areas[0].id); }, [areas, areaId]);

  if (!areas) return <div className="pwa-screen"><Loading /></div>;

  const create = async (start: boolean) => {
    if (!title.trim() || areaId === null || busy) return;
    setBusy(true);
    const ticket = await act(() => post<Ticket>('/api/tickets', { title: title.trim(), description: description.trim(), areaId, due: due || null, source: 'app' }));
    setBusy(false);
    if (!ticket) return;
    if (start) await timers.start(ticket.id);
    navigate({ name: 'ticket', id: ticket.id }, true);
  };

  return (
    <div className="pwa-screen">
      <a className="btn btn-ghost pwa-back" href={href({ name: 'today' })}><Icon name="x" /> {t('common.cancel')}</a>
      <h1 className="pwa-h1" style={{ margin: '10px 0 18px' }}>{t('app.new.title')}</h1>
      <form className="stack" style={{ gap: 16 }} onSubmit={e => { e.preventDefault(); void create(false); }}>
        <Field label={t('app.new.what')}>
          <input className="input" autoFocus placeholder={t('app.new.placeholder')} value={title} onChange={e => setTitle(e.target.value)} enterKeyHint="done" />
        </Field>
        {areas.length === 0 ? <div className="pwa-empty">{t('rules.needArea')}</div> : (
          <div>
            <div className="field-label">{t('rules.area')}</div>
            <Seg options={areas.map(a => ({ value: a.id, label: a.name }))} value={areaId ?? areas[0].id} onChange={setAreaId} label={t('rules.area')} />
          </div>
        )}
        <Field label={t('tickets.col.due')}>
          <input className="input" type="date" value={due} onChange={e => setDue(e.target.value)} />
        </Field>
        <Field label={t('app.new.description')}>
          <textarea className="input" rows={3} placeholder={t('app.new.optional')} value={description} onChange={e => setDescription(e.target.value)} />
        </Field>
        <div>
          <button type="submit" className="btn btn-primary btn-block" disabled={!title.trim() || busy}>{t('app.new.create')}</button>
          <button type="button" className="btn btn-secondary btn-block" style={{ marginTop: 10 }} disabled={!title.trim() || busy} onClick={() => create(true)}>
            <Icon name="play" /> {t('app.new.createAndStart')}
          </button>
        </div>
      </form>
    </div>
  );
}

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Field, Icon, Loading, Seg } from '../../components/ui';
import { post, useAction } from '../../lib/api';
import { describeRecurrence } from '../../lib/recurrence';
import type { Recurrence, Ticket } from '../../lib/types';
import { useMyAreas } from '../areas';
import { isListLine, linesOf, looksLikeList, parseQuick, shortTitle, splitMessages, stripBullet, takeShared, type Shared } from '../quickAdd';
import { href, navigate } from '../router';
import { RepeatPicker } from './Repeat';
import type { Timers } from '../timer';

const MAX_TICKETS = 50;
const oneLine = (s: string) => s.replace(/\s+/g, ' ').trim();

interface Draft {
  title: string;
  description: string;
  due: string | null;
  dueTime: string | null;
  recurrence: Recurrence | null;
}

/**
 * New ticket from free text: "Oma Arzt Donnerstag 10 Uhr" fills in date and time by itself. Pasted or shared text
 * with several lines or WhatsApp messages can become several tickets at once, or one ticket with a checklist.
 */
export function NewTicket({ timers }: { timers: Timers }) {
  const { t, i18n } = useTranslation();
  const myAreas = useMyAreas();
  // Hidden areas are left out; if all are hidden, offer all of them rather than none.
  const areas = myAreas && (myAreas.visible.length ? myAreas.visible : myAreas.all);
  const act = useAction();
  const [shared] = useState<Shared | null>(() => takeShared());
  const [text, setText] = useState(() => shared?.text ?? '');
  const [several, setSeveral] = useState(() => looksLikeList(shared?.text ?? ''));
  const [asChecklist, setAsChecklist] = useState(false);
  const [detect, setDetect] = useState(true);
  const [skipped, setSkipped] = useState<Set<number>>(new Set());
  const [description, setDescription] = useState('');
  const [areaId, setAreaId] = useState<number | null>(null);
  // The date fields; once touched they win over what the text says.
  const [due, setDue] = useState(() => new Date().toLocaleDateString('sv-SE'));
  const [dueTime, setDueTime] = useState('');
  const [touched, setTouched] = useState(false);
  // Same for the repeat: what the text says until it is picked by hand.
  const [repeat, setRepeat] = useState<Recurrence | null>(null);
  const [repeatTouched, setRepeatTouched] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => { if (areas?.length && areaId === null) setAreaId(areas[0].id); }, [areas, areaId]);

  if (!areas) return <div className="pwa-screen"><Loading /></div>;

  const fromNote = (sender: string | null) => (sender ? t('app.new.fromWhatsApp', { sender }) : '');
  const join = (...parts: (string | null | undefined)[]) => parts.map(p => p?.trim()).filter(Boolean).join('\n\n');
  const fieldDue = due || null;
  const fieldTime = due && dueTime ? dueTime : null;

  // — one ticket —
  const messages = splitMessages(text);
  const senders = [...new Set(messages.map(m => m.sender).filter(Boolean))];
  const body = messages.map(m => m.text).join('\n');
  const found = parseQuick(oneLine(body));
  const detected = detect && !touched && Boolean(found.due || found.dueTime || found.repeat);
  const singleRepeat = !repeatTouched && detect && found.repeat ? found.repeat : repeat;
  const short = shortTitle(detected ? found.title : body);
  const single: Draft = {
    title: short.title,
    description: join(description, senders.length === 1 ? fromNote(senders[0]) : null, short.cut || body.includes('\n') ? body : null, shared?.url),
    due: detected ? found.due : fieldDue,
    dueTime: detected ? found.dueTime : fieldTime,
    recurrence: singleRepeat,
  };

  // — several tickets, one per line or message —
  const multiline = messages.length > 1 || body.includes('\n');
  const items: (Draft & { skipped: boolean })[] = linesOf(text).slice(0, MAX_TICKETS).map((line, i) => {
    const p = detect ? parseQuick(line.text) : null;
    const own = Boolean(p && (p.due || p.dueTime || p.repeat));
    return {
      title: shortTitle(own ? p!.title : line.text).title,
      description: join(description, fromNote(line.sender)),
      due: own ? p!.due : fieldDue,
      dueTime: own ? p!.dueTime : fieldTime,
      recurrence: p?.repeat ?? repeat,
      skipped: skipped.has(i),
    };
  });
  // — one ticket with a checklist: a first line that is no list item becomes the title —
  const rawLines = body.split('\n').filter(l => l.trim());
  const hasHead = rawLines.length > 0 && !isListLine(rawLines[0]);
  const head = hasHead ? rawLines[0].replace(/:\s*$/, '').trim() : t('app.new.listTitle');
  const checkItems = (hasHead ? rawLines.slice(1) : rawLines).map(stripBullet).filter(Boolean);
  const headFound = detect && !touched ? parseQuick(head) : null;
  const headDetected = Boolean(headFound && (headFound.due || headFound.dueTime || headFound.repeat));
  const listTicket: Draft = {
    title: shortTitle(headDetected ? headFound!.title : head).title,
    description: join(description, senders.length === 1 ? fromNote(senders[0]) : null, shared?.url),
    due: headDetected ? headFound!.due : fieldDue,
    dueTime: headDetected ? headFound!.dueTime : fieldTime,
    recurrence: !repeatTouched && headFound?.repeat ? headFound.repeat : repeat,
  };

  const asList = several && multiline;
  const checklist = asChecklist && multiline && !asList;
  const chosen = asList ? items.filter(x => !x.skipped) : checklist ? [listTicket] : single.title ? [single] : [];

  const when = (d: Pick<Draft, 'due' | 'dueTime' | 'recurrence'>) => {
    const repeats = d.recurrence ? `↻ ${describeRecurrence(d.recurrence)} · ` : '';
    if (!d.due) return repeats + t('app.new.noDate');
    const [y, m, day] = d.due.split('-').map(Number);
    const date = new Date(y, m - 1, day).toLocaleDateString(i18n.language, { weekday: 'short', day: 'numeric', month: 'numeric' });
    return repeats + (d.dueTime ? `${date} · ${d.dueTime}` : date);
  };

  const create = async (start: boolean) => {
    if (!chosen.length || areaId === null || busy) return;
    setBusy(true);
    const made: Ticket[] = [];
    for (const d of chosen) {
      const ticket = await act(() => post<Ticket>('/api/tickets', { ...d, areaId, source: 'app' }));
      if (!ticket) break;
      if (checklist && checkItems.length) await act(() => post(`/api/tickets/${ticket.id}/checklist`, { text: checkItems.join('\n') }));
      made.push(ticket);
    }
    setBusy(false);
    if (!made.length) return;
    if (made.length === 1) {
      if (start) await timers.start(made[0].id);
      navigate({ name: 'ticket', id: made[0].id }, true);
    } else {
      navigate({ name: 'tickets' }, true);
    }
  };

  const changeDate = (next: { due?: string; dueTime?: string }) => {
    // Keep what the text said for the field that was not changed.
    if (!touched && (checklist ? headDetected : detected && !asList)) {
      setDue((checklist ? listTicket : single).due ?? '');
      setDueTime((checklist ? listTicket : single).dueTime ?? '');
    }
    if (next.due !== undefined) setDue(next.due);
    if (next.dueTime !== undefined) setDueTime(next.dueTime);
    setTouched(true);
  };
  // With several tickets the fields hold the date for lines without one of their own.
  const own = checklist ? headDetected : !asList && !touched && detected;
  const ownDraft = checklist ? listTicket : single;
  const shownDue = own ? ownDraft.due ?? '' : due;
  const shownTime = own ? ownDraft.dueTime ?? '' : dueTime;

  return (
    <div className="pwa-screen">
      <a className="btn btn-ghost pwa-back" href={href({ name: 'today' })}><Icon name="x" /> {t('common.cancel')}</a>
      <h1 className="pwa-h1" style={{ margin: '10px 0 18px' }}>{t('app.new.title')}</h1>
      {shared && (
        <div className="pwa-shared"><Icon name="share-network" /> {senders.length ? t('app.new.sharedFrom', { sender: senders.join(', ') }) : t('app.new.shared')}</div>
      )}
      <form className="stack" style={{ gap: 16 }} onSubmit={e => { e.preventDefault(); void create(false); }}>
        <Field label={t('app.new.what')}>
          <textarea
            className="input pwa-quick" autoFocus={!shared} rows={1} placeholder={t('app.new.placeholder')} value={text} enterKeyHint="done"
            onChange={e => { setText(e.target.value); setSkipped(new Set()); if (!e.target.value.trim()) setDetect(true); }}
            onPaste={e => { const pasted = e.clipboardData.getData('text'); if (looksLikeList(pasted)) setSeveral(true); }}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !text.includes('\n')) { e.preventDefault(); void create(false); } }}
          />
        </Field>

        {multiline && (
          <Seg
            label={t('app.new.howMany')}
            options={[
              { value: 'one', label: t('app.new.oneTicket') },
              { value: 'checklist', label: t('app.new.withChecklist') },
              { value: 'lines', label: t('app.new.perLine', { count: items.length }) },
            ]}
            value={several ? 'lines' : asChecklist ? 'checklist' : 'one'} onChange={v => { setSeveral(v === 'lines'); setAsChecklist(v === 'checklist'); }}
          />
        )}

        {checklist && (
          <div className="pwa-quick-list" aria-label={t('app.new.preview')}>
            <div className="pwa-quick-item">
              <div className="grow">
                <div className="pwa-row-title">{listTicket.title}</div>
                <div className="pwa-row-meta">{when(listTicket)} · {t('app.checklist.count', { count: checkItems.length })}</div>
              </div>
            </div>
            {checkItems.map((c, i) => <div key={i} className="pwa-quick-check"><Icon name="square" /> {c}</div>)}
          </div>
        )}

        {!asList && !checklist && text.trim() && (found.due || found.dueTime || found.repeat) && (
          detected ? (
            <div className="pwa-detected">
              <Icon name="sparkle" />
              <span className="grow">{t('app.new.detected', { when: when(single) })}{single.title !== oneLine(body) ? <> · <span className="soft">{t('app.new.titleBecomes', { title: single.title })}</span></> : null}</span>
              <button type="button" className="btn btn-icon btn-ghost" aria-label={t('app.new.ignoreDetected')} title={t('app.new.ignoreDetected')} onClick={() => setDetect(false)}><Icon name="x" /></button>
            </div>
          ) : !touched && (
            <button type="button" className="btn btn-ghost pwa-detect-again" onClick={() => setDetect(true)}><Icon name="sparkle" /> {t('app.new.detectAgain', { when: when({ ...found, recurrence: found.repeat }) })}</button>
          )
        )}

        {asList && (
          <div className="pwa-quick-list" aria-label={t('app.new.preview')}>
            {items.map((x, i) => (
              <div key={i} className={`pwa-quick-item${x.skipped ? ' is-skipped' : ''}`}>
                <div className="grow">
                  <div className="pwa-row-title">{x.title}</div>
                  <div className="pwa-row-meta">{when(x)}{x.description ? ` · ${x.description.split('\n')[0]}` : ''}</div>
                </div>
                <button type="button" className="btn btn-icon btn-ghost" aria-pressed={!x.skipped}
                  aria-label={t(x.skipped ? 'app.new.include' : 'app.new.skip', { title: x.title })} title={t(x.skipped ? 'app.new.include' : 'app.new.skip', { title: x.title })}
                  onClick={() => setSkipped(s => { const n = new Set(s); if (n.has(i)) n.delete(i); else n.add(i); return n; })}>
                  <Icon name={x.skipped ? 'arrow-counter-clockwise' : 'x'} />
                </button>
              </div>
            ))}
            {linesOf(text).length > MAX_TICKETS && <div className="pwa-label">{t('app.new.max', { n: MAX_TICKETS })}</div>}
          </div>
        )}

        {areas.length === 0 ? <div className="pwa-empty">{t('rules.needArea')}</div> : (
          <div>
            <div className="field-label">{t('rules.area')}</div>
            <Seg options={areas.map(a => ({ value: a.id, label: a.name }))} value={areaId ?? areas[0].id} onChange={setAreaId} label={t('rules.area')} />
          </div>
        )}
        <div className="pwa-due-grid">
          <Field label={asList ? t('app.new.dueOthers') : t('tickets.col.due')}>
            <input className="input" type="date" value={shownDue} onChange={e => changeDate({ due: e.target.value })} />
          </Field>
          <Field label={t('app.new.time')}>
            <input className="input" type="time" value={shownTime} disabled={!shownDue} onChange={e => changeDate({ dueTime: e.target.value })} />
          </Field>
        </div>
        <div>
          <div className="field-label">{asList ? t('repeat.labelOthers') : t('repeat.label')}</div>
          <RepeatPicker value={asList ? repeat : checklist ? listTicket.recurrence : singleRepeat} due={asList ? fieldDue : single.due} onChange={r => { setRepeat(r); setRepeatTouched(true); }} />
        </div>
        <Field label={t('app.new.description')}>
          <textarea className="input" rows={3} placeholder={t('app.new.optional')} value={description} onChange={e => setDescription(e.target.value)} />
        </Field>
        <div>
          <button type="submit" className="btn btn-primary btn-block" disabled={!chosen.length || busy}>
            {chosen.length > 1 ? t('app.new.createMany', { count: chosen.length }) : t('app.new.create')}
          </button>
          {chosen.length <= 1 && (
            <button type="button" className="btn btn-secondary btn-block" style={{ marginTop: 10 }} disabled={!chosen.length || busy} onClick={() => create(true)}>
              <Icon name="play" /> {t('app.new.createAndStart')}
            </button>
          )}
        </div>
      </form>
    </div>
  );
}

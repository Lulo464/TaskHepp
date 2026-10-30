import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { Icon } from '../../components/ui';
import { patch, useAction } from '../../lib/api';
import type { Ticket } from '../../lib/types';
import { showToast } from '../toast';

const iso = (d: Date) => d.toLocaleDateString('sv-SE');
const inDays = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d;
};

/** Morgen, the coming weekend (Saturday) and next week (Monday) — counted from today, so overdue tickets move forward. */
function choices() {
  const day = new Date().getDay(); // 0 = Sunday
  const list = [
    { key: 'tomorrow' as const, date: iso(inDays(1)) },
    { key: 'weekend' as const, date: iso(inDays(day === 6 ? 7 : 6 - day)) },
    { key: 'nextWeek' as const, date: iso(inDays(((8 - day) % 7) || 7)) },
  ];
  // On Fridays the weekend is tomorrow, on Sundays next week is: one entry is enough.
  return list.filter((c, i) => list.findIndex(x => x.date === c.date) === i);
}

/** "Später": moves a ticket to tomorrow, the weekend, next week or a chosen day, keeping its time; with undo. */
export function Snooze({ ticket, label }: { ticket: Ticket; label?: boolean }) {
  const { t, i18n } = useTranslation();
  const act = useAction();
  const [at, setAt] = useState<{ top: number; right: number; up: boolean } | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const picker = useRef<HTMLInputElement>(null);

  const show = (date: string) => new Date(`${date}T00:00`).toLocaleDateString(i18n.language, { weekday: 'short', day: 'numeric', month: 'numeric' });
  const close = () => setAt(null);

  useEffect(() => {
    if (!at) return;
    menu.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
    const outside = (e: PointerEvent) => { if (!menu.current?.contains(e.target as Node) && !button.current?.contains(e.target as Node)) close(); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { close(); button.current?.focus(); } };
    window.addEventListener('pointerdown', outside, true);
    window.addEventListener('keydown', key);
    window.addEventListener('resize', close);
    document.querySelector('.pwa-content')?.addEventListener('scroll', close, { once: true });
    return () => {
      window.removeEventListener('pointerdown', outside, true);
      window.removeEventListener('keydown', key);
      window.removeEventListener('resize', close);
    };
  }, [at]);

  const open = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (at) return close();
    const r = button.current!.getBoundingClientRect();
    const up = r.bottom + 230 > window.innerHeight;
    setAt({ top: up ? r.top - 4 : r.bottom + 4, right: Math.max(8, window.innerWidth - r.right), up });
  };

  const move = async (due: string) => {
    close();
    if (due === ticket.due) return;
    const before = { due: ticket.due, dueTime: ticket.dueTime };
    const done = await act(() => patch(`/api/tickets/${ticket.id}`, { due }));
    if (done === undefined) return;
    showToast(t('snooze.moved', { title: ticket.title, when: show(due) }), {
      label: t('snooze.undo'),
      run: () => void act(() => patch(`/api/tickets/${ticket.id}`, before)),
    });
  };

  return (
    <span className="pwa-snooze" onClick={e => e.stopPropagation()}>
      <button ref={button} type="button" className={label ? 'btn btn-ghost pwa-snooze-btn' : 'btn btn-icon btn-ghost'} aria-haspopup="menu" aria-expanded={Boolean(at)}
        aria-label={t('snooze.label', { title: ticket.title })} title={t('snooze.title')} onClick={open}>
        <Icon name="clock-countdown" />{label && <> {t('snooze.title')}</>}
      </button>
      <input ref={picker} type="date" tabIndex={-1} aria-hidden="true" className="pwa-snooze-picker" min={iso(new Date())} onChange={e => e.target.value && void move(e.target.value)} />
      {at && createPortal(
        <div ref={menu} role="menu" className={`pwa-menu${at.up ? ' is-up' : ''}`} style={{ top: at.top, right: at.right }} aria-label={t('snooze.title')}>
          {choices().map(c => (
            <button key={c.key} type="button" role="menuitem" disabled={c.date === ticket.due} onClick={() => void move(c.date)}>
              <span>{t(`snooze.${c.key}`)}</span><span className="pwa-label">{show(c.date)}</span>
            </button>
          ))}
          <button type="button" role="menuitem" onClick={() => { close(); try { picker.current?.showPicker(); } catch { picker.current?.focus(); } }}>
            <span>{t('snooze.pick')}</span><Icon name="calendar-dots" />
          </button>
        </div>,
        document.body,
      )}
    </span>
  );
}

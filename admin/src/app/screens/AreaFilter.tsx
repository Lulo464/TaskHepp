import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Icon } from '../../components/ui';
import { put, useAction } from '../../lib/api';
import { useMyAreas } from '../areas';

const LONG_PRESS_MS = 450;

/**
 * Which areas the app shows, on top of Heute, Tickets, Planung and Zeit. It is the same setting as hiding areas
 * under Mehr → Bereiche, so it applies everywhere at once. A tap shows only that area (tapping it again shows all);
 * a long press, or Ctrl/Cmd-click, adds or removes an area to combine several.
 */
export function AreaFilter() {
  const { t } = useTranslation();
  const my = useMyAreas();
  const act = useAction();
  // The choice shows at once; it gives way to the server's answer when that arrives.
  const [pending, setPending] = useState<number[] | null>(null);
  const saved = my?.prefs.hidden.join(',');
  useEffect(() => setPending(null), [saved]);
  const press = useRef<{ id: number; timer: number; long: boolean } | null>(null);

  if (!my || my.all.length < 2) return null;

  const hidden = new Set(pending ?? my.prefs.hidden);
  const allIds = my.all.map(a => a.id);
  const visible = allIds.filter(id => !hidden.has(id));
  const allShown = visible.length === allIds.length;

  const save = (next: number[]) => {
    setPending(next);
    void act(() => put('/api/me/areas', { ...my.prefs, hidden: next }));
  };
  const only = (id: number) => save(allIds.filter(a => a !== id));
  const select = (id: number) => {
    if (!allShown && visible.length === 1 && visible[0] === id) return save([]); // the only one again: show all
    only(id);
  };
  const toggle = (id: number) => {
    if (allShown) return only(id);
    if (hidden.has(id)) return save([...hidden].filter(h => h !== id));
    if (visible.length === 1) return save([]); // removing the last one shows all again
    save([...hidden, id]);
  };

  const down = (id: number) => {
    const timer = window.setTimeout(() => {
      if (press.current?.id !== id) return;
      press.current.long = true;
      navigator.vibrate?.(15);
      toggle(id);
    }, LONG_PRESS_MS);
    press.current = { id, timer, long: false };
  };
  const cancel = () => {
    if (press.current) window.clearTimeout(press.current.timer);
  };
  const click = (id: number, e: React.MouseEvent) => {
    cancel();
    const wasLong = press.current?.id === id && press.current.long;
    press.current = null;
    if (wasLong) return;
    if (e.ctrlKey || e.metaKey || e.shiftKey) toggle(id);
    else select(id);
  };

  return (
    <div className="pwa-chips pwa-area-filter" role="group" aria-label={t('app.areaFilter.label')}>
      <button type="button" className={`pwa-chip${allShown ? ' is-active' : ''}`} aria-pressed={allShown} onClick={() => !allShown && save([])}>
        {t('app.areaFilter.all')}
      </button>
      {my.all.map(a => {
        const on = !allShown && !hidden.has(a.id);
        return (
          <button
            key={a.id}
            type="button"
            className={`pwa-chip${on ? ' is-active' : ''}`}
            aria-pressed={on}
            title={t('app.areaFilter.hint')}
            onPointerDown={() => down(a.id)}
            onPointerUp={cancel}
            onPointerLeave={cancel}
            onPointerCancel={cancel}
            onContextMenu={e => e.preventDefault()}
            onClick={e => click(a.id, e)}
          >
            <Icon name={a.icon} /> {a.name}
          </button>
        );
      })}
    </div>
  );
}

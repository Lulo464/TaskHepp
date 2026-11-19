import { useCallback, useEffect, useRef, useState } from 'react';

export interface Drag {
  id: number;
  title: string;
  x: number;
  y: number;
  /** data-drop value of the target under the pointer. */
  over: string | null;
}

const EDGE = 60; // px from the scroll area's edge where dragging scrolls
const LONG_PRESS = 300;

const targetAt = (x: number, y: number) => document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-drop]')?.dataset.drop ?? null;

/**
 * Drag tickets with mouse or finger onto elements with data-drop. HTML5 drag and drop does not work on phones, so this
 * follows the pointer itself: the mouse starts after a small move, a finger after a short press (a swipe still scrolls).
 */
export function usePointerDrag(scroller: string | string[], onDrop: (id: number, target: string) => void) {
  const [drag, setDrag] = useState<Drag | null>(null);
  const current = useRef<Drag | null>(null);
  const justDropped = useRef(false);
  const dropRef = useRef(onDrop);
  dropRef.current = onDrop;

  const update = (next: Drag | null) => {
    current.current = next;
    setDrag(next);
  };

  const begin = useCallback((e: React.PointerEvent, id: number, title: string) => {
    if (e.button !== 0) return;
    const touch = e.pointerType !== 'mouse';
    const start = { x: e.clientX, y: e.clientY };
    let started = false;

    const go = (x: number, y: number) => {
      started = true;
      if (touch) navigator.vibrate?.(15);
      update({ id, title, x, y, over: targetAt(x, y) });
    };
    const timer = touch ? window.setTimeout(() => go(start.x, start.y), LONG_PRESS) : undefined;

    const onMove = (ev: PointerEvent) => {
      if (started) return update({ id, title, x: ev.clientX, y: ev.clientY, over: targetAt(ev.clientX, ev.clientY) });
      if (Math.hypot(ev.clientX - start.x, ev.clientY - start.y) < (touch ? 8 : 5)) return;
      if (touch) stop(false); // moved before the long press: the finger scrolls
      else go(ev.clientX, ev.clientY);
    };
    // Once dragging, the finger must not scroll the page.
    const onTouchMove = (ev: TouchEvent) => { if (started) ev.preventDefault(); };
    const onUp = () => stop(true);
    const onCancel = () => stop(false);

    function stop(drop: boolean) {
      window.clearTimeout(timer);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
      window.removeEventListener('touchmove', onTouchMove);
      const last = current.current;
      if (started) {
        // The click that follows a drag must not open the ticket.
        justDropped.current = true;
        window.setTimeout(() => { justDropped.current = false; }, 0);
        if (drop && last?.over) dropRef.current(id, last.over);
      }
      update(null);
    }

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
    window.addEventListener('touchmove', onTouchMove, { passive: false });
  }, []);

  // Scroll while the pointer rests near an edge: up and down, and sideways for areas that scroll sideways
  // (the board's columns on a phone).
  const dragging = drag !== null;
  const scrollers = Array.isArray(scroller) ? scroller.join('|') : scroller;
  useEffect(() => {
    if (!dragging) return;
    let frame = 0;
    const tick = () => {
      const d = current.current;
      for (const sel of scrollers.split('|')) {
        const el = document.querySelector<HTMLElement>(sel);
        if (!d || !el) continue;
        const r = el.getBoundingClientRect();
        const by = el.scrollHeight > el.clientHeight
          ? (d.y < r.top + EDGE ? -(r.top + EDGE - d.y) / 4 : d.y > r.bottom - EDGE ? (d.y - (r.bottom - EDGE)) / 4 : 0) : 0;
        const bx = el.scrollWidth > el.clientWidth
          ? (d.x < r.left + EDGE ? -(r.left + EDGE - d.x) / 4 : d.x > r.right - EDGE ? (d.x - (r.right - EDGE)) / 4 : 0) : 0;
        if (by || bx) {
          el.scrollTop += by;
          el.scrollLeft += bx;
          update({ ...d, over: targetAt(d.x, d.y) });
        }
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [dragging, scrollers]);

  return { drag, begin, justDropped };
}

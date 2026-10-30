import { useEffect, useState } from 'react';

/** A short note at the bottom of the app, optionally with one action such as "Rückgängig". */
export interface Toast {
  id: number;
  text: string;
  action?: { label: string; run: () => void };
}

const SHOW_MS = 6000;
const listeners = new Set<(t: Toast | null) => void>();
let current: Toast | null = null;
let timer: number | undefined;

const emit = () => listeners.forEach(l => l(current));

export function showToast(text: string, action?: Toast['action']) {
  current = { id: Date.now(), text, action };
  window.clearTimeout(timer);
  timer = window.setTimeout(dismissToast, SHOW_MS);
  emit();
}

export function dismissToast() {
  window.clearTimeout(timer);
  current = null;
  emit();
}

export function useToast() {
  const [toast, setToast] = useState(current);
  useEffect(() => {
    listeners.add(setToast);
    return () => { listeners.delete(setToast); };
  }, []);
  return toast;
}

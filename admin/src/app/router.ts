import { useEffect, useState } from 'react';

/** App screens, addressed by the URL hash (#/tickets, #/ticket/5 …) so the back button and reloads work. */
export type Route =
  | { name: 'today' }
  | { name: 'tickets' }
  | { name: 'plan' }
  | { name: 'ticket'; id: number }
  | { name: 'new' }
  | { name: 'time' }
  | { name: 'more' }
  | { name: 'areas' }
  | { name: 'presence' }
  | { name: 'notifications' }
  | { name: 'mydata' }
  | { name: 'impressum' }
  | { name: 'datenschutz' };

export function parseRoute(hash: string): Route {
  const [, name, arg] = hash.replace(/^#/, '').split('/');
  switch (name) {
    case 'tickets': return { name: 'tickets' };
    case 'plan': return { name: 'plan' };
    case 'ticket': return Number(arg) > 0 ? { name: 'ticket', id: Number(arg) } : { name: 'tickets' };
    case 'new': return { name: 'new' };
    case 'time': return { name: 'time' };
    case 'more': return { name: 'more' };
    case 'areas': return { name: 'areas' };
    case 'presence': return { name: 'presence' };
    case 'notifications': return { name: 'notifications' };
    case 'mydata': return { name: 'mydata' };
    case 'impressum': return { name: 'impressum' };
    case 'datenschutz': return { name: 'datenschutz' };
    default: return { name: 'today' };
  }
}

export const href = (r: Route) => (r.name === 'today' ? '#/' : r.name === 'ticket' ? `#/ticket/${r.id}` : `#/${r.name}`);

export function navigate(r: Route, replace = false) {
  if (replace) window.location.replace(href(r));
  else window.location.hash = href(r);
}

export function useRoute(): Route {
  const [route, setRoute] = useState(() => parseRoute(window.location.hash));
  useEffect(() => {
    const onHash = () => {
      setRoute(parseRoute(window.location.hash));
      document.querySelector('.pwa-content')?.scrollTo(0, 0);
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  return route;
}

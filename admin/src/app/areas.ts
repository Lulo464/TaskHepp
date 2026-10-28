import { useApi } from '../lib/api';
import type { Area } from '../lib/types';

/** The signed-in user's own view of the areas: order (area ids, first = top) and hidden areas. */
export interface AreaPrefs {
  order: number[];
  hidden: number[];
}

/** Areas in the user's order; areas the user never sorted keep their place from the admin after the sorted ones. */
export function sortAreas(areas: Area[], order: number[]): Area[] {
  const rank = (a: Area) => {
    const i = order.indexOf(a.id);
    return i === -1 ? order.length : i;
  };
  return areas.map((a, i) => ({ a, i })).sort((x, y) => rank(x.a) - rank(y.a) || x.i - y.i).map(x => x.a);
}

/** All areas sorted, the visible ones, and a check for tickets of hidden areas. Null while loading. */
export function useMyAreas() {
  const areas = useApi<Area[]>('/api/areas');
  const prefs = useApi<AreaPrefs>('/api/me/areas');
  if (!areas || !prefs) return null;
  const hidden = new Set(prefs.hidden);
  const all = sortAreas(areas, prefs.order);
  return { all, visible: all.filter(a => !hidden.has(a.id)), prefs, isHidden: (areaId: number) => hidden.has(areaId) };
}

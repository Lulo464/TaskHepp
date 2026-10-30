import { useTranslation } from 'react-i18next';
import { Icon } from '../../components/ui';
import { put, useAction } from '../../lib/api';
import { useMyAreas } from '../areas';

/**
 * Which areas the app shows, on top of Heute, Tickets, Planung and Zeit. It is the same setting as hiding areas
 * under Mehr → Bereiche, so it applies everywhere at once. With all shown, a tap shows only that area; after that
 * taps add or remove areas, and the last one cannot be removed.
 */
export function AreaFilter() {
  const { t } = useTranslation();
  const my = useMyAreas();
  const act = useAction();
  if (!my || my.all.length < 2) return null;

  const allShown = my.visible.length === my.all.length;
  const save = (hidden: number[]) => act(() => put('/api/me/areas', { ...my.prefs, hidden }));
  const tap = (id: number) => {
    if (allShown) return save(my.all.filter(a => a.id !== id).map(a => a.id));
    if (my.isHidden(id)) return save(my.prefs.hidden.filter(h => h !== id));
    if (my.visible.length === 1) return save([]); // removing the last one shows all again
    return save([...my.prefs.hidden, id]);
  };

  return (
    <div className="pwa-chips pwa-area-filter" role="group" aria-label={t('app.areaFilter.label')}>
      <button type="button" className={`pwa-chip${allShown ? ' is-active' : ''}`} aria-pressed={allShown} onClick={() => !allShown && void save([])}>
        {t('app.areaFilter.all')}
      </button>
      {my.all.map(a => {
        const on = !allShown && !my.isHidden(a.id);
        return (
          <button key={a.id} type="button" className={`pwa-chip${on ? ' is-active' : ''}`} aria-pressed={on} onClick={() => void tap(a.id)}>
            <Icon name={a.icon} /> {a.name}
          </button>
        );
      })}
    </div>
  );
}

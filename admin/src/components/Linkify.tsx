import { Fragment } from 'react';
import { splitLinks } from '../lib/links';

/**
 * Text with its links clickable. They open in a new tab, without telling the page where they came from; a click
 * on a link does not also trigger the surrounding element (e.g. "tap to edit").
 */
export function Linkify({ text }: { text: string }) {
  return (
    <>
      {splitLinks(text).map((p, i) => ('href' in p ? (
        <a key={i} className="auto-link" href={p.href} target="_blank" rel="noopener noreferrer nofollow" onClick={e => e.stopPropagation()}>
          {p.text}
        </a>
      ) : <Fragment key={i}>{p.text}</Fragment>))}
    </>
  );
}

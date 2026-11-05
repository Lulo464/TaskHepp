import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Icon, Loading } from '../../components/ui';
import { useApi } from '../../lib/api';
import { href } from '../router';

export interface LegalTexts {
  imprint: string;
  privacy: string;
}

/** **bold** inside a line. */
function inline(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, i) => (part.startsWith('**') && part.endsWith('**') ? <strong key={i}>{part.slice(2, -2)}</strong> : part));
}

/** The few bits of Markdown the texts use: # and ## headings, "- " lists, **bold**, blank lines between paragraphs. */
export function LegalText({ text }: { text: string }) {
  const blocks = text.replace(/\r\n?/g, '\n').split(/\n{2,}/);
  return (
    <div className="pwa-legal-text">
      {blocks.map((block, i) => {
        const lines = block.split('\n').filter(l => l.trim());
        if (!lines.length) return null;
        if (lines.length === 1 && lines[0].startsWith('# ')) return <h1 key={i} className="pwa-h1">{inline(lines[0].slice(2))}</h1>;
        if (lines.length === 1 && lines[0].startsWith('## ')) return <h2 key={i}>{inline(lines[0].slice(3))}</h2>;
        const out: ReactNode[] = [];
        let list: string[] = [];
        const flush = () => { if (list.length) out.push(<ul key={`l${out.length}`}>{list.map((l, j) => <li key={j}>{inline(l)}</li>)}</ul>); list = []; };
        for (const l of lines) {
          if (l.startsWith('- ')) { list.push(l.slice(2)); continue; }
          flush();
          if (l.startsWith('## ')) out.push(<h2 key={`h${out.length}`}>{inline(l.slice(3))}</h2>);
          else if (l.startsWith('# ')) out.push(<h1 key={`h${out.length}`} className="pwa-h1">{inline(l.slice(2))}</h1>);
          else out.push(<p key={`p${out.length}`}>{inline(l)}</p>);
        }
        flush();
        return <div key={i}>{out}</div>;
      })}
    </div>
  );
}

/** Impressum or Datenschutzerklärung; also reachable without signing in. */
export function Legal({ doc, standalone }: { doc: 'impressum' | 'datenschutz'; standalone?: boolean }) {
  const { t } = useTranslation();
  const legal = useApi<LegalTexts>('/api/legal');
  const text = legal ? (doc === 'impressum' ? legal.imprint : legal.privacy) : null;
  return (
    <div className={standalone ? 'pwa-login pwa-legal-page' : 'pwa-screen'}>
      <a className="btn btn-ghost pwa-back" href={standalone ? '/' : href({ name: 'more' })}><Icon name="caret-left" /> {t(standalone ? 'app.legal.toLogin' : 'app.more.title')}</a>
      {text === null ? <Loading /> : text.trim() ? <LegalText text={text} /> : <p className="pwa-empty">{t('app.legal.missing')}</p>}
    </div>
  );
}

/** Links to imprint and privacy notice, only for texts the admin filled in. */
export function LegalLinks() {
  const { t } = useTranslation();
  const legal = useApi<LegalTexts>('/api/legal');
  if (!legal || (!legal.imprint.trim() && !legal.privacy.trim())) return null;
  return (
    <nav className="pwa-legal-links" aria-label={t('app.legal.links')}>
      {legal.imprint.trim() && <a href={href({ name: 'impressum' })}>{t('app.legal.imprint')}</a>}
      {legal.privacy.trim() && <a href={href({ name: 'datenschutz' })}>{t('app.legal.privacy')}</a>}
    </nav>
  );
}

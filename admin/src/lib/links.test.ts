import { describe, expect, it } from 'vitest';
import { splitLinks } from './links';

const links = (text: string) => splitLinks(text).filter(p => 'href' in p).map(p => ('href' in p ? [p.text, p.href] : []));

describe('splitLinks', () => {
  it('finds links and keeps the text around them', () => {
    expect(splitLinks('Anleitung: https://example.com/a?b=1 lesen')).toEqual([
      { text: 'Anleitung: ' }, { text: 'https://example.com/a?b=1', href: 'https://example.com/a?b=1' }, { text: ' lesen' },
    ]);
    expect(splitLinks('ohne Link')).toEqual([{ text: 'ohne Link' }]);
  });

  it('leaves sentence punctuation and brackets outside', () => {
    expect(links('Siehe https://x.de/seite.')).toEqual([['https://x.de/seite', 'https://x.de/seite']]);
    expect(links('(mehr unter https://x.de/info), danke!')).toEqual([['https://x.de/info', 'https://x.de/info']]);
    expect(links('https://de.wikipedia.org/wiki/Kiefer_(Gattung)')).toEqual([['https://de.wikipedia.org/wiki/Kiefer_(Gattung)', 'https://de.wikipedia.org/wiki/Kiefer_(Gattung)']]);
  });

  it('adds https to www. links and mailto to addresses', () => {
    expect(links('www.baumarkt.de und oma@example.org')).toEqual([['www.baumarkt.de', 'https://www.baumarkt.de'], ['oma@example.org', 'mailto:oma@example.org']]);
  });

  it('makes nothing but web and mail links clickable', () => {
    expect(links('javascript:alert(1) data:text/html,x ftp://x.de')).toEqual([]);
    expect(links('mehrere\nhttps://a.de\nhttps://b.de')).toHaveLength(2);
  });
});

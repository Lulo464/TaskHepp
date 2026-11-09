/** A piece of text, or a link found in it. */
export type TextPart = { text: string } | { text: string; href: string };

// http(s) links, "www." without a scheme, and e-mail addresses. Nothing else becomes clickable (no javascript: …).
const LINK = /\b(https?:\/\/[^\s<>"]+|www\.[^\s<>"]+\.[^\s<>"]+|[\w.+-]+@[\w-]+(?:\.[\w-]+)+)/gi;

/** Punctuation that ends a sentence rather than the link: "siehe https://x.de/a." → "https://x.de/a". */
function trimEnd(url: string): string {
  let u = url;
  for (;;) {
    const last = u.slice(-1);
    if (/[.,;:!?'*]/.test(last)) u = u.slice(0, -1);
    // A closing bracket belongs to the link only if it opened one (Wikipedia: …/Foo_(Bar)).
    else if (last === ')' && (u.match(/\(/g)?.length ?? 0) < (u.match(/\)/g)?.length ?? 0)) u = u.slice(0, -1);
    else if (last === ']' && !u.includes('[')) u = u.slice(0, -1);
    else return u;
  }
}

/** Splits text into plain parts and links, e.g. for descriptions, notes and checklist items. */
export function splitLinks(text: string): TextPart[] {
  const parts: TextPart[] = [];
  let at = 0;
  for (const m of text.matchAll(LINK)) {
    const raw = trimEnd(m[0]);
    const start = m.index ?? 0;
    if (start > at) parts.push({ text: text.slice(at, start) });
    const href = raw.includes('@') && !/^https?:|^www\./i.test(raw) ? `mailto:${raw}` : /^www\./i.test(raw) ? `https://${raw}` : raw;
    parts.push({ text: raw, href });
    at = start + raw.length;
  }
  if (at < text.length) parts.push({ text: text.slice(at) });
  return parts;
}

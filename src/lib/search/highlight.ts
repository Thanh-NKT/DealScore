/**
 * Accent-insensitive match highlighting for suggestion rows (spec 2026-10-07-search-quality-ui §2).
 * Pure and DOM-free: the caller renders the `match` parts in bold.
 */

export interface HighlightPart {
  text: string;
  match: boolean;
}

const MARKS = /[̀-ͯ]/g;
const WORD = /[\p{L}\p{N}]/u;

/** Lowercase, no Vietnamese accents (đ → d). Used for matching only, never shown. */
export function foldText(s: string): string {
  return s.normalize("NFD").replace(MARKS, "").replace(/[đĐ]/g, "d").toLowerCase();
}

/**
 * The folded text plus, for each folded character, the [start, end) range of the original characters it
 * came from. A combining mark (text stored as NFD) folds to nothing and is attached to the previous range.
 */
function foldWithMap(text: string): { folded: string; start: number[]; end: number[] } {
  let folded = "";
  const start: number[] = [];
  const end: number[] = [];
  let i = 0;
  for (const ch of Array.from(text)) {
    const piece = foldText(ch);
    if (piece.length === 0 && end.length > 0) end[end.length - 1] = i + ch.length;
    for (const c of piece) {
      folded += c;
      start.push(i);
      end.push(i + ch.length);
    }
    i += ch.length;
  }
  return { folded, start, end };
}

function tokensOf(query: string): string[] {
  const all = foldText(query)
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
  // One-character tokens ("3" in "ssd 3 triệu") would light up noise, unless they are all there is.
  const long = all.filter((t) => t.length >= 2);
  return long.length > 0 ? long : all.length === 1 ? all : [];
}

/** Splits `text` into parts, marking every word-prefix match of a query token (accents and case ignored). */
export function highlightParts(text: string, query: string): HighlightPart[] {
  if (!text) return [];
  const tokens = tokensOf(query);
  if (tokens.length === 0) return [{ text, match: false }];

  const { folded, start, end } = foldWithMap(text);
  const ranges: [number, number][] = [];
  for (const token of tokens) {
    for (let at = folded.indexOf(token); at >= 0; at = folded.indexOf(token, at + 1)) {
      // Word-prefix only: the search itself matches word prefixes, so "tai" must not light up "Mountain".
      if (at === 0 || !WORD.test(folded[at - 1])) ranges.push([start[at], end[at + token.length - 1]]);
    }
  }
  if (ranges.length === 0) return [{ text, match: false }];

  ranges.sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [];
  for (const r of ranges) {
    const last = merged[merged.length - 1];
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
    else merged.push([r[0], r[1]]);
  }

  const parts: HighlightPart[] = [];
  let pos = 0;
  for (const [s, e] of merged) {
    if (s > pos) parts.push({ text: text.slice(pos, s), match: false });
    parts.push({ text: text.slice(s, e), match: true });
    pos = e;
  }
  if (pos < text.length) parts.push({ text: text.slice(pos), match: false });
  return parts;
}

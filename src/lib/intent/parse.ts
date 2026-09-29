/**
 * Rule-based query intent parser (Phase 3 group A, spec §1 — no LLM). Pure, DB-free, never
 * throws. Turns "SSD 2TB dưới 3 triệu" into { categorySlug, capacityGb, maxPrice, chips, text }.
 *
 * Works on a token array: each original token (diacritics/casing kept, for `text`) has a folded
 * twin used for matching. Each rule marks the tokens it consumed; `text` is what is left.
 */
import { formatVnd } from "@/lib/format";
import { extractPriceRange } from "@/lib/intent/price";
import {
  CATEGORY_SYNONYMS,
  COLOR_LABELS,
  FILLER_WORDS,
  FLAG_PHRASES,
  NEED_PHRASES,
  SORT_LABELS,
  SORT_PHRASES,
  STOP_PHRASES,
} from "@/lib/intent/lexicon";
import {
  EMPTY_INTENT_TEXT_LIMIT,
  type IntentChip,
  type IntentChipKind,
  type IntentVocab,
  type QueryIntent,
} from "@/lib/intent/types";
import { MARKETPLACES, type MarketplaceId } from "@/lib/marketplaces";
import { brandForms } from "@/lib/matching/aliases";
import { EN_COLORS, extractAttributes, normalizeText, VI_COLORS } from "@/lib/matching/attributes";

export type { IntentChip, IntentChipKind, IntentSort, IntentVocab, QueryIntent } from "@/lib/intent/types";
export { EMPTY_INTENT_TEXT_LIMIT } from "@/lib/intent/types";

/** Same folding the price parser expects: NFD, strip combining marks, đ→d, lowercase. */
function foldForIntent(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[đĐ]/g, "d")
    .toLowerCase();
}

type Owner = "price" | "attr" | "marketplace" | "flag" | "sort" | "category" | "brand" | "need" | "filler";

interface Token {
  orig: string;
  /** Folded, punctuation kept ("27\"", "3.000.000d"). */
  folded: string;
  /** Folded with non-[a-z0-9] runs turned into single spaces and trimmed ("tp-link" → "tp link"). */
  key: string;
  /** [start, end) of `folded` inside the joined folded string. */
  start: number;
  end: number;
  owner?: Owner;
}

/** Splits on whitespace, then separates runs of price symbols glued to words ("ssd<3tr"). */
function tokenize(q: string): Token[] {
  const tokens: Token[] = [];
  let pos = 0;
  for (const word of q.split(/\s+/)) {
    for (const part of word.split(/([<>~]+)/)) {
      if (part === "") continue;
      const folded = foldForIntent(part);
      tokens.push({
        orig: part,
        folded,
        key: normalizeText(part),
        start: pos,
        end: pos + folded.length,
      });
      pos += folded.length + 1;
    }
  }
  return tokens;
}

/**
 * Number of tokens from `i` whose keys, joined by spaces, equal `phrase` — 0 when they don't.
 * Skips nothing: a consumed token (unless `allow` accepts its owner) breaks the match.
 */
function matchAt(tokens: Token[], i: number, phrase: string, allow?: (o: Owner) => boolean): number {
  let acc = "";
  for (let j = i; j < tokens.length; j++) {
    const t = tokens[j];
    if (t.owner && !(allow && allow(t.owner))) return 0;
    if (t.key === "") return 0;
    acc = acc === "" ? t.key : `${acc} ${t.key}`;
    if (acc === phrase) return j - i + 1;
    if (!phrase.startsWith(`${acc} `)) return 0;
  }
  return 0;
}

function consume(tokens: Token[], i: number, n: number, owner: Owner): void {
  for (let k = i; k < i + n; k++) tokens[k].owner = owner;
}

function wordCount(phrase: string): number {
  return phrase.split(" ").length;
}

/** Longest phrases first (by words, then characters). */
function byLength<T>(entries: Array<[string, T]>): Array<[string, T]> {
  return [...entries].sort((a, b) => wordCount(b[0]) - wordCount(a[0]) || b[0].length - a[0].length);
}

/** Left-to-right scan, longest phrase first at each position; calls `hit` for every match. */
function scanPhrases<T>(
  tokens: Token[],
  entries: Array<[string, T]>,
  owner: Owner,
  hit: (value: T, index: number) => void,
): void {
  const sorted = byLength(entries);
  for (let i = 0; i < tokens.length; i++) {
    for (const [phrase, value] of sorted) {
      const n = matchAt(tokens, i, phrase);
      if (n > 0) {
        consume(tokens, i, n, owner);
        hit(value, i);
        i += n - 1;
        break;
      }
    }
  }
}

/**
 * Word-form price cues (price.ts) that can be left over when what follows them is not a price.
 * "max" / "min" are left out: they are also model names ("iphone pro max 256gb").
 */
const DANGLING_CUES: readonly string[] = ["duoi", "toi da", "khong qua", "nho hon", "tren", "it nhat", "lon hon", "tam", "khoang", "chung"];

/** Marks as filler a free price cue followed by a capacity/size token or ending the query. */
function stripDanglingCues(tokens: Token[]): void {
  for (let i = 0; i < tokens.length; i++) {
    for (const cue of DANGLING_CUES) {
      const n = matchAt(tokens, i, cue);
      if (n === 0) continue;
      const next = tokens[i + n];
      if (next === undefined || next.owner === "attr") consume(tokens, i, n, "filler");
      break;
    }
  }
}

export function capacityLabel(gb: number): string {
  return gb % 1024 === 0 ? `${gb / 1024}TB` : `${gb}GB`;
}

function priceLabel(min: number | undefined, max: number | undefined): string {
  if (min != null && max != null) return `${formatVnd(min)} – ${formatVnd(max)}`;
  if (max != null) return `≤ ${formatVnd(max)}`;
  return `≥ ${formatVnd(min)}`;
}

const NUMBER_RE = /^\d+(?:[.,]\d+)?$/;
const CAPACITY_TOKEN_RE = /^(\d+(?:[.,]\d+)?)(tb|gb)$/;
const SIZE_TOKEN_RE = /^(\d+(?:[.,]\d+)?)(?:"|”|''|inch|inches|in)$/;
const SIZE_UNITS = new Set(['"', "”", "''", "inch", "inches", "in"]);

/** Folded token without trailing sentence punctuation (keeps the inch quote). */
function bare(t: Token): string {
  return t.folded.replace(/[,.;:!?]+$/, "");
}

function emptyIntent(text = ""): QueryIntent {
  return { text, boostTerms: [], chips: [] };
}

export function parseQueryIntent(q: string, vocab: IntentVocab): QueryIntent {
  if (typeof q !== "string") return emptyIntent();
  const input = q.slice(0, EMPTY_INTENT_TEXT_LIMIT).trim();
  if (input === "") return emptyIntent();
  try {
    return parse(input, vocab);
  } catch {
    // Defensive: a parser bug must never break search — fall back to the plain query.
    return emptyIntent(input.split(/\s+/).join(" "));
  }
}

function parse(input: string, vocab: IntentVocab): QueryIntent {
  const tokens = tokenize(input);
  const intent: QueryIntent = { text: "", boostTerms: [], chips: [] };
  const chips: Array<IntentChip & { index: number }> = [];
  const addChip = (kind: IntentChipKind, label: string, index: number) => chips.push({ kind, label, index });
  const free = () => tokens.filter((t) => !t.owner);

  // 1. Price — map the folded character span back onto tokens.
  const folded = tokens.map((t) => t.folded).join(" ");
  const price = extractPriceRange(folded);
  if (price) {
    const hit = tokens.filter((t) => t.start < price.end && t.end > price.start);
    if (hit.length > 0) {
      hit.forEach((t) => (t.owner = "price"));
      if (price.minPrice != null) intent.minPrice = price.minPrice;
      if (price.maxPrice != null) intent.maxPrice = price.maxPrice;
      addChip("price", priceLabel(price.minPrice, price.maxPrice), tokens.indexOf(hit[0]));
    }
  }

  // 2. Capacity / size / color — values from extractAttributes on what is left, then consume
  // the tokens that carry them. A value whose tokens can't be located is dropped.
  const attrs = extractAttributes(
    free()
      .map((t) => t.folded)
      .join(" "),
    { bareVietnameseColors: false },
  );

  if (attrs.capacityGb != null) {
    let first = -1;
    for (let i = 0; i < tokens.length; i++) {
      const t = tokens[i];
      if (t.owner) continue;
      const next = tokens[i + 1];
      if (CAPACITY_TOKEN_RE.test(bare(t))) {
        consume(tokens, i, 1, "attr");
      } else if (NUMBER_RE.test(bare(t)) && next && !next.owner && (next.key === "tb" || next.key === "gb")) {
        consume(tokens, i, 2, "attr");
      } else continue;
      if (first < 0) first = i;
    }
    if (first >= 0) {
      intent.capacityGb = attrs.capacityGb;
      addChip("capacity", capacityLabel(attrs.capacityGb), first);
    }
  }

  if (attrs.sizeInch != null) {
    const size = attrs.sizeInch;
    const isSize = (raw: string) => Number(raw.replace(",", ".")) === size;
    let first = -1;
    for (let i = 0; i < tokens.length; i++) {
      const t = tokens[i];
      if (t.owner) continue;
      const next = tokens[i + 1];
      const m = SIZE_TOKEN_RE.exec(bare(t));
      if (m && isSize(m[1])) {
        consume(tokens, i, 1, "attr");
      } else if (NUMBER_RE.test(bare(t)) && isSize(bare(t)) && next && !next.owner && SIZE_UNITS.has(bare(next))) {
        consume(tokens, i, 2, "attr");
      } else continue;
      if (first < 0) first = i;
    }
    if (first >= 0) {
      intent.sizeInch = size;
      addChip("size", `${size} inch`, first);
    }
  }

  if (attrs.color != null) {
    const color = attrs.color;
    const viColors = byLength(VI_COLORS);
    let first = -1;
    for (let i = 0; i < tokens.length; i++) {
      const t = tokens[i];
      if (t.owner) continue;
      if (t.key === "mau") {
        const next = tokens[i + 1];
        if (next && !next.owner && EN_COLORS[next.key] === color) {
          consume(tokens, i, 2, "attr");
          if (first < 0) first = i;
          continue;
        }
        for (const [phrase, c] of viColors) {
          const n = c === color ? matchAt(tokens, i + 1, phrase) : 0;
          if (n > 0) {
            consume(tokens, i, n + 1, "attr");
            if (first < 0) first = i;
            break;
          }
        }
      } else if (EN_COLORS[t.key] === color) {
        consume(tokens, i, 1, "attr");
        if (first < 0) first = i;
      }
    }
    if (first >= 0) {
      intent.color = color;
      addChip("color", `Màu ${COLOR_LABELS[color] ?? color}`, first);
    }
  }

  // 3. Marketplaces — "tren X" or X alone.
  const marketEntries: Array<[string, MarketplaceId]> = [];
  for (const m of MARKETPLACES) {
    for (const form of new Set([m.id, normalizeText(m.name)])) {
      marketEntries.push([`tren ${form}`, m.id], [form, m.id]);
    }
  }
  const marketplaces: MarketplaceId[] = [];
  scanPhrases(tokens, marketEntries, "marketplace", (id, i) => {
    if (marketplaces.includes(id)) return;
    marketplaces.push(id);
    addChip("marketplace", MARKETPLACES.find((m) => m.id === id)?.name ?? id, i);
  });
  if (marketplaces.length > 0) intent.marketplaces = marketplaces;

  // 4. Flags.
  scanPhrases(tokens, FLAG_PHRASES, "flag", (flag, i) => {
    if (intent[flag]) return;
    intent[flag] = true;
    if (flag === "freeShipping") addChip("free_shipping", "Freeship", i);
    else addChip("voucher", "Có voucher", i);
  });

  // 5. Sort — first phrase wins; later ones are still consumed.
  scanPhrases(tokens, SORT_PHRASES, "sort", (sort, i) => {
    if (intent.sort) return;
    intent.sort = sort;
    addChip("sort", SORT_LABELS[sort], i);
  });

  // 6. Category — longest phrase wins; a tie between different slugs sets no category.
  const categories = Array.isArray(vocab?.categories) ? vocab.categories : [];
  const catEntries: Array<[string, string]> = [];
  for (const c of categories) {
    if (typeof c?.slug !== "string" || typeof c.name !== "string") continue;
    const forms = new Set([...(CATEGORY_SYNONYMS[c.slug] ?? []), normalizeText(c.name), normalizeText(c.slug)]);
    for (const f of forms) if (f !== "") catEntries.push([f, c.slug]);
  }
  let bestLen = 0;
  let bestSlugs = new Set<string>();
  for (let i = 0; i < tokens.length; i++) {
    for (const [phrase, slug] of catEntries) {
      const n = matchAt(tokens, i, phrase);
      if (n === 0) continue;
      if (n > bestLen) {
        bestLen = n;
        bestSlugs = new Set([slug]);
      } else if (n === bestLen) bestSlugs.add(slug);
    }
  }
  if (bestSlugs.size === 1) {
    const slug = [...bestSlugs][0];
    let first = -1;
    scanPhrases(
      tokens,
      catEntries.filter(([, s]) => s === slug),
      "category",
      (_s, i) => {
        if (first < 0) first = i;
      },
    );
    intent.categorySlug = slug;
    addChip("category", categories.find((c) => c.slug === slug)?.name ?? slug, first);
  }

  // 7. Brands — every brandForms() form, whole-token; the vocab spelling is returned.
  const brandEntries: Array<[string, string]> = [];
  for (const brand of Array.isArray(vocab?.brands) ? vocab.brands : []) {
    if (typeof brand !== "string") continue;
    for (const form of brandForms(brand)) if (form !== "") brandEntries.push([form, brand]);
  }
  const brands: string[] = [];
  scanPhrases(tokens, brandEntries, "brand", (brand, i) => {
    if (brands.includes(brand)) return;
    brands.push(brand);
    addChip("brand", brand, i);
  });
  if (brands.length > 0) intent.brands = brands;

  // 8. Needs → boostTerms, in order of appearance.
  const boosts: Array<{ term: string; index: number }> = [];
  scanPhrases(tokens, NEED_PHRASES, "need", (term, index) => boosts.push({ term, index }));
  // "co" right after "phim" ("ban phim co") = mechanical, even if the category took it.
  for (let i = 1; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.key === "co" && tokens[i - 1].key === "phim" && (!t.owner || t.owner === "category")) {
      t.owner = "need";
      boosts.push({ term: "mechanical", index: i });
    }
  }
  boosts.sort((a, b) => a.index - b.index);
  for (const { term } of boosts) if (!intent.boostTerms.includes(term)) intent.boostTerms.push(term);

  // 9. Stop phrases + filler words (longest first, so "chinh hang" goes whole) — only when
  // something else was extracted or the query is long enough.
  const extracted = chips.length > 0 || intent.boostTerms.length > 0;
  if (extracted || tokens.length >= 4) {
    scanPhrases(
      tokens,
      [...STOP_PHRASES, ...FILLER_WORDS].map((w): [string, true] => [w, true]),
      "filler",
      () => {},
    );
  }

  // 10. Dangling price cues ("ssd trên 1tb": "1tb" is a capacity, not a price) — a cue left right
  // before a consumed capacity/size, or as the last word, would be AND-ed into the text search.
  if (extracted) stripDanglingCues(tokens);

  intent.chips = chips.sort((a, b) => a.index - b.index).map(({ kind, label }) => ({ kind, label }));
  intent.text = tokens
    .filter((t) => !t.owner && !(extracted && t.key === ""))
    .map((t) => t.orig)
    .join(" ");
  return intent;
}

/**
 * Search synonyms and abbreviations (spec 2026-10-07-search-quality-logic §2). Pure, DB-free.
 *
 * `expandQuery()` turns the keyword text into OR-groups for `search_products(p_term_groups)`: each
 * matched phrase becomes one group of alternatives (the original first), every other word a group of
 * its own. The RPC ANDs the groups, ORs the alternatives, joins the words of an alternative with `<->`
 * and still ORs in the plain query, ranking exact matches above synonym-only ones.
 *
 * Every phrase here is in normalizeText() form: diacritics stripped, đ→d, lowercase, single spaces.
 * The lexicon is data — add a rule to SYNONYM_RULES, not code.
 */
import { normalizeText } from "@/lib/matching/attributes";

/** Alternatives for one query phrase; `[0]` is the phrase as typed (folded). */
export type TermGroup = string[];

/** Same caps as the RPC (0030): beyond them it would silently drop words or alternatives. */
export const MAX_TERM_GROUPS = 10;
export const MAX_ALTERNATIVES = 6;

export interface SynonymRule {
  /** Phrases that trigger the rule when typed (whole words). */
  match: readonly string[];
  /** What the phrase is expanded to. A typed phrase is never repeated after itself. */
  alternatives: readonly string[];
  /**
   * Context guard for shorthands that are also everyday Vietnamese words once folded: the rule fires
   * only when this holds. `tokens` is the whole folded query, the phrase spans [start, end).
   */
  when?: (tokens: readonly string[], start: number, end: number) => boolean;
}

/** Interchangeable terms: typing any of them searches for all of them. */
function same(terms: string[], alsoMatch: string[] = []): SynonymRule {
  return { match: [...terms, ...alsoMatch], alternatives: terms };
}

/** One-way: typing an abbreviation / broader word adds the terms, never the other way round. */
function oneWay(match: string[], alternatives: string[], when?: SynonymRule["when"]): SynonymRule {
  return { match, alternatives, when };
}

/**
 * "lap" is also "lắp" (lắp đặt, lắp ráp, lắp camera): it means laptop only next to a laptop brand or line.
 * "gaming" is not enough ("lắp pc gaming").
 */
const LAPTOP_CONTEXT = new Set([
  "dell", "asus", "hp", "lenovo", "acer", "msi", "gigabyte", "macbook", "thinkpad", "ideapad", "legion",
  "vivobook", "zenbook", "rog", "tuf", "xps", "inspiron", "vostro", "latitude", "pavilion", "victus", "omen",
  "envy", "nitro", "aspire", "predator", "yoga", "surface",
]);
const nearLaptopBrand = (tokens: readonly string[], start: number, end: number) =>
  tokens.some((t, i) => (i < start || i >= end) && LAPTOP_CONTEXT.has(t));

/** "mi" is also "mi" / "mì" / "mí" (kẹp mi, mì tôm): Xiaomi only before a Xiaomi line or a model number. */
const XIAOMI_NEXT_RE = /^(?:band|tv|box|pad|watch|buds|note|smart|robot|router|air|power|monitor|mix|max|\d+[a-z]*)$/;
/** "ss" is also "so sánh": Samsung only before a Samsung line or model (s24, a55, z, t7, 990). */
const SAMSUNG_NEXT_RE =
  /^(?:galaxy|note\d*|tab|buds\d*[a-z]*|fold\d*|flip\d*|watch\d*|tv|odyssey|evo|z|[sazm]\d{1,3}[a-z]*|t\d{1,2}[a-z]*|\d{3,4}[a-z]*)$/;
const nextMatches = (re: RegExp) => (tokens: readonly string[], _start: number, end: number) =>
  end < tokens.length && re.test(tokens[end]);

const PHONE = ["dien thoai", "phone", "smartphone"];
const LAPTOP = ["laptop", "may tinh xach tay", "notebook"];

/**
 * Seeded from the catalog's categories (scripts/seed-dev.ts: SSD, bàn phím, chuột, màn hình, tai nghe,
 * RAM, sạc dự phòng, webcam) and brands (Samsung, WD, Logitech, …), plus the spec's list.
 * `headphone:*` already prefix-matches "headphones", so plurals only need to trigger the rule.
 */
export const SYNONYM_RULES: readonly SynonymRule[] = [
  // Category words.
  same(["tai nghe", "headphone", "earphone", "earbuds", "tws"], ["headphones", "earphones"]),
  same(PHONE),
  oneWay(["dt"], PHONE),
  same(LAPTOP, ["laptops", "notebooks", "lap top"]),
  oneWay(["lap"], LAPTOP, nearLaptopBrand),
  // "Ổ cứng" covers both kinds; "ssd" must not widen to hard disks.
  oneWay(["o cung"], ["ssd", "hdd"]),
  same(["sac du phong", "pin du phong", "powerbank", "power bank"]),
  same(["dong ho thong minh", "smartwatch"], ["smart watch"]),
  same(["loa", "speaker"], ["speakers"]),
  same(["chuot", "mouse"]),
  same(["ban phim", "keyboard"]),
  same(["man hinh", "monitor"]),
  same(["tivi", "tv"]),
  same(["webcam", "web cam"]),
  // Brand shorthands.
  oneWay(["ss"], ["samsung"], nextMatches(SAMSUNG_NEXT_RE)),
  oneWay(["xm"], ["xiaomi"]),
  oneWay(["mi"], ["xiaomi"], nextMatches(XIAOMI_NEXT_RE)),
  same(["wd", "western digital"]),
  oneWay(["logi"], ["logitech"]),
  // Model shorthands ("ip 15", "ip15pm" are handled by expandIphone below).
  oneWay(["pm"], ["pro max"]),
];

interface LexiconEntry {
  alternatives: readonly string[];
  when?: SynonymRule["when"];
}

interface Lexicon {
  byPhrase: Map<string, LexiconEntry[]>;
  maxWords: number;
}

function buildLexicon(rules: readonly SynonymRule[]): Lexicon {
  const byPhrase = new Map<string, LexiconEntry[]>();
  let maxWords = 1;
  for (const rule of rules) {
    for (const phrase of rule.match) {
      byPhrase.set(phrase, [...(byPhrase.get(phrase) ?? []), { alternatives: rule.alternatives, when: rule.when }]);
      maxWords = Math.max(maxWords, phrase.split(" ").length);
    }
  }
  return { byPhrase, maxWords };
}

/** Alternatives of the rules for `phrase` whose context guard holds here; empty when none fires. */
function lookup(tokens: readonly string[], start: number, end: number): string[] {
  const entries = LEXICON.byPhrase.get(tokens.slice(start, end).join(" ")) ?? [];
  return [...new Set(entries.filter((e) => !e.when || e.when(tokens, start, end)).flatMap((e) => e.alternatives))];
}

const LEXICON = buildLexicon(SYNONYM_RULES);

/*
 * iPhone model numbers are 3–19. From 20 up a number after "ip" is an IP protection rating (ip54, ip65,
 * ip67, ip68 on speakers, earbuds, watches), not an iPhone yet; ipx4 / ip6x carry no number to match.
 * Widen both patterns when an iPhone 20 ships.
 */
const IPHONE_GLUED_RE = /^(ipp?|iphone)(1\d|[3-9])(pm|promax|pro|plus|p)?$/;
const IPHONE_SUFFIX: Readonly<Record<string, string>> = {
  pm: "pro max",
  promax: "pro max",
  pro: "pro",
  p: "pro",
  plus: "plus",
};
const MODEL_NUMBER_RE = /^(?:1\d|[3-9])$/;
const GLUED_CAPACITY_RE = /^(\d+)(tb|gb)$/;
const NUMBER_RE = /^\d+$/;

function iphoneName(prefix: string, num: string, suffix: string | undefined): string {
  const tail = suffix ? IPHONE_SUFFIX[suffix] : prefix === "ipp" ? "pro" : undefined;
  return tail ? `iphone ${num} ${tail}` : `iphone ${num}`;
}

/**
 * "ip 15" / "ip15" → "iphone 15", "ipp 15" → "iphone 15 pro", "ip15pm" / "ip 15 pm" → "iphone 15 pro max",
 * "iphone15" → "iphone 15". Returns the number of tokens consumed and the expansion, or null.
 */
function expandIphone(tokens: string[], i: number): { used: number; expansion: string } | null {
  const t = tokens[i];
  const next = tokens[i + 1];
  const isMaxSuffix = (s: string | undefined) => s === "pm" || s === "promax";

  const glued = IPHONE_GLUED_RE.exec(t);
  if (glued) {
    const [, prefix, num, suffix] = glued;
    if (prefix === "iphone" && !suffix) return { used: 1, expansion: `iphone ${num}` };
    if (!suffix && isMaxSuffix(next)) return { used: 2, expansion: iphoneName(prefix, num, next) };
    return { used: 1, expansion: iphoneName(prefix, num, suffix) };
  }
  if ((t === "ip" || t === "ipp") && next !== undefined && MODEL_NUMBER_RE.test(next)) {
    const after = tokens[i + 2];
    if (isMaxSuffix(after)) return { used: 3, expansion: iphoneName(t, next, after) };
    return { used: 2, expansion: iphoneName(t, next, undefined) };
  }
  return null;
}

/** Original first, no duplicates, at most MAX_ALTERNATIVES. */
function group(original: string, alternatives: readonly string[]): TermGroup {
  return [...new Set([original, ...alternatives])].slice(0, MAX_ALTERNATIVES);
}

/**
 * Keyword text → synonym OR-groups, or `undefined` when nothing expands (the RPC then runs its plain
 * query, unchanged) or when the query has more than MAX_TERM_GROUPS groups (truncating would drop
 * words and widen the search).
 */
export function expandQuery(text: string): TermGroup[] | undefined {
  if (typeof text !== "string") return undefined;
  const tokens = normalizeText(text.slice(0, 200)).split(" ").filter(Boolean);
  if (tokens.length === 0) return undefined;

  const groups: TermGroup[] = [];
  let expanded = false;
  for (let i = 0; i < tokens.length; ) {
    const t = tokens[i];
    const next = tokens[i + 1];

    const iphone = expandIphone(tokens, i);
    if (iphone) {
      groups.push(group(tokens.slice(i, i + iphone.used).join(" "), [iphone.expansion]));
      expanded = true;
      i += iphone.used;
      continue;
    }

    const glued = GLUED_CAPACITY_RE.exec(t);
    if (glued) {
      groups.push(group(t, [`${glued[1]} ${glued[2]}`]));
      expanded = true;
      i += 1;
      continue;
    }
    if (NUMBER_RE.test(t) && (next === "tb" || next === "gb")) {
      groups.push(group(`${t} ${next}`, [`${t}${next}`]));
      expanded = true;
      i += 2;
      continue;
    }

    // Longest lexicon phrase starting here.
    let matched = 0;
    for (let n = Math.min(LEXICON.maxWords, tokens.length - i); n >= 1; n--) {
      const alternatives = lookup(tokens, i, i + n);
      if (alternatives.length > 0) {
        groups.push(group(tokens.slice(i, i + n).join(" "), alternatives));
        expanded = true;
        matched = n;
        break;
      }
    }
    if (matched > 0) {
      i += matched;
      continue;
    }

    groups.push([t]);
    i += 1;
  }

  if (!expanded || groups.length > MAX_TERM_GROUPS) return undefined;
  return groups;
}

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
}

/** Interchangeable terms: typing any of them searches for all of them. */
function same(terms: string[], alsoMatch: string[] = []): SynonymRule {
  return { match: [...terms, ...alsoMatch], alternatives: terms };
}

/** One-way: typing an abbreviation / broader word adds the terms, never the other way round. */
function oneWay(match: string[], alternatives: string[]): SynonymRule {
  return { match, alternatives };
}

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
  same(LAPTOP, ["laptops", "notebooks"]),
  oneWay(["lap"], LAPTOP),
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
  oneWay(["ss"], ["samsung"]),
  oneWay(["xm", "mi"], ["xiaomi"]),
  same(["wd", "western digital"]),
  oneWay(["logi"], ["logitech"]),
  // Model shorthands ("ip 15", "ip15pm" are handled by expandIphone below).
  oneWay(["pm"], ["pro max"]),
];

interface Lexicon {
  byPhrase: Map<string, string[]>;
  maxWords: number;
}

function buildLexicon(rules: readonly SynonymRule[]): Lexicon {
  const byPhrase = new Map<string, string[]>();
  let maxWords = 1;
  for (const rule of rules) {
    for (const phrase of rule.match) {
      byPhrase.set(phrase, [...new Set([...(byPhrase.get(phrase) ?? []), ...rule.alternatives])]);
      maxWords = Math.max(maxWords, phrase.split(" ").length);
    }
  }
  return { byPhrase, maxWords };
}

const LEXICON = buildLexicon(SYNONYM_RULES);

const IPHONE_GLUED_RE = /^(ipp?|iphone)(\d{1,2})(pm|promax|pro|plus|p)?$/;
const IPHONE_SUFFIX: Readonly<Record<string, string>> = {
  pm: "pro max",
  promax: "pro max",
  pro: "pro",
  p: "pro",
  plus: "plus",
};
const MODEL_NUMBER_RE = /^\d{1,2}$/;
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
      const phrase = tokens.slice(i, i + n).join(" ");
      const alternatives = LEXICON.byPhrase.get(phrase);
      if (alternatives) {
        groups.push(group(phrase, alternatives));
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

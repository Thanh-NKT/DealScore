/**
 * Vietnamese price-phrase parser (Phase 3 group A, rule-based intent search — no LLM).
 * Pure, DB-free. Input is already diacritic-folded + lowercased (đ→d) but keeps
 * `. , < > ~ -` and digits so `extractPriceRange` can return a character span into the
 * original folded string for the caller to strip.
 */

export const MIN_PRICE_VND = 1_000;
export const MAX_PRICE_VND = 1_000_000_000;

/** Amount pattern: digits (with optional grouping/decimal separators), optional unit,
 * optional trailing single digit that is tenths-of-a-million after `tr` (e.g. "3tr5"). */
const AMOUNT_UNIT = "tr\\d|tr|trieu|m|k|nghin|ngan|vnd|dong|d";
const AMOUNT_RE = new RegExp(`^(\\d{1,3}(?:[.,]\\d{3})+|\\d+(?:[.,]\\d+)?)\\s*(${AMOUNT_UNIT})?$`);

/** Parses a single amount token (e.g. "3tr5", "500k", "3.000.000d") into VND, or null. */
export function parsePriceAmount(token: string): number | null {
  const t = token.trim();
  if (t === "") return null;
  const m = AMOUNT_RE.exec(t);
  if (!m) return null;

  const [, rawNumber, unit] = m;
  const hasGrouping = /^\d{1,3}(?:[.,]\d{3})+$/.test(rawNumber);

  let value: number;
  if (hasGrouping) {
    // Thousands-separated group like "3.000.000" or "3,000,000" — strip separators, integer.
    value = Number(rawNumber.replace(/[.,]/g, ""));
  } else {
    // Plain number, possibly with a single decimal separator ("1.5", "1,5").
    value = Number(rawNumber.replace(",", "."));
  }
  if (!Number.isFinite(value)) return null;

  let result: number;
  if (unit && /^tr\d$/.test(unit)) {
    // "3tr5" → 3.5 million: the trailing digit is tenths of a million.
    const tenths = Number(unit.slice(2));
    result = value * 1_000_000 + tenths * 100_000;
  } else if (unit === "tr" || unit === "trieu" || unit === "m") {
    result = value * 1_000_000;
  } else if (unit === "k" || unit === "nghin" || unit === "ngan") {
    result = value * 1_000;
  } else {
    // Unit is "d"/"vnd"/"dong" or absent — value is already VND. Bare numbers below 1,000
    // are almost never a price ("990 pro", "27 inch") so they are rejected here too.
    result = value;
    if (result < MIN_PRICE_VND) return null;
  }

  if (result < MIN_PRICE_VND || result > MAX_PRICE_VND) return null;
  return Math.round(result);
}

export interface PriceRange {
  minPrice?: number;
  maxPrice?: number;
  start: number;
  end: number;
}

const MAX_CUES = ["duoi", "<", "toi da", "khong qua", "max", "nho hon"];
const MIN_CUES = ["tren", ">", "it nhat", "min", "lon hon"];
const AROUND_CUES = ["tam", "khoang", "chung", "~"];

function escapeCue(cue: string): string {
  return cue.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const MAX_CUE_ALT = MAX_CUES.map(escapeCue).join("|");
const MIN_CUE_ALT = MIN_CUES.map(escapeCue).join("|");
const AROUND_CUE_ALT = AROUND_CUES.map(escapeCue).join("|");

/** Amount, capturing separately the numeric part so we can re-parse with the borrowed unit. */
const AMOUNT_GROUP = `(\\d[\\d.,]*)\\s*(${AMOUNT_UNIT})?`;

// (?<![a-z0-9]) stands in for a left \b that also works before symbol cues ("<", "~"),
// which have no word character of their own for \b to anchor on.
const LEFT_BOUND = "(?<![a-z0-9])";

const PATTERNS: Array<{ kind: "min" | "max" | "between" | "around"; re: RegExp }> = [
  // "tu X tro len" — min, must be checked before the generic "between" pattern.
  { kind: "min", re: new RegExp(`${LEFT_BOUND}tu\\s+${AMOUNT_GROUP}\\s+tro\\s+len\\b`) },
  // "tu X den|toi|- Y" / "X den|toi|- Y" — between.
  {
    kind: "between",
    re: new RegExp(`${LEFT_BOUND}(?:tu\\s+)?${AMOUNT_GROUP}\\s*(?:den|toi|-)\\s*${AMOUNT_GROUP}\\b`),
  },
  { kind: "max", re: new RegExp(`${LEFT_BOUND}(?:${MAX_CUE_ALT})\\s*${AMOUNT_GROUP}\\b`) },
  { kind: "min", re: new RegExp(`${LEFT_BOUND}(?:${MIN_CUE_ALT})\\s*${AMOUNT_GROUP}\\b`) },
  { kind: "around", re: new RegExp(`${LEFT_BOUND}(?:${AROUND_CUE_ALT})\\s*${AMOUNT_GROUP}\\b`) },
];

function roundToThousand(n: number): number {
  return Math.round(n / 1000) * 1000;
}

/** Re-parses a raw number + optional unit captured by AMOUNT_GROUP into VND. */
function parseGroup(rawNumber: string, unit: string | undefined): number | null {
  return parsePriceAmount(rawNumber + (unit ?? ""));
}

/**
 * Scans a folded string for the first Vietnamese price phrase (max/min/between/around) and
 * returns its amount(s) plus the character span of the whole phrase, so the caller can strip
 * it out of the query. Bare numbers/amounts with no price cue are never matched (avoids "990
 * pro", "27 inch", "ssd 2tb").
 */
export function extractPriceRange(folded: string): PriceRange | null {
  let best: { start: number; end: number; range: Omit<PriceRange, "start" | "end"> } | null = null;

  for (const { kind, re } of PATTERNS) {
    const m = re.exec(folded);
    if (!m || m.index === undefined) continue;
    const start = m.index;
    const end = start + m[0].length;
    if (best && start >= best.start) continue;

    if (kind === "between") {
      const [, num1, unit1, num2, unit2] = m as unknown as [string, string, string | undefined, string, string | undefined];
      // Unit of the second amount applies to the first when the first has none.
      const effectiveUnit1 = unit1 ?? unit2;
      const minPrice = parseGroup(num1, effectiveUnit1);
      const maxPrice = parseGroup(num2, unit2);
      if (minPrice == null || maxPrice == null) continue;
      best = { start, end, range: { minPrice, maxPrice } };
    } else if (kind === "around") {
      const [, num, unit] = m as unknown as [string, string, string | undefined];
      const amount = parseGroup(num, unit);
      if (amount == null) continue;
      best = {
        start,
        end,
        range: { minPrice: roundToThousand(amount * 0.85), maxPrice: roundToThousand(amount * 1.15) },
      };
    } else {
      const [, num, unit] = m as unknown as [string, string, string | undefined];
      const amount = parseGroup(num, unit);
      if (amount == null) continue;
      best = kind === "max" ? { start, end, range: { maxPrice: amount } } : { start, end, range: { minPrice: amount } };
    }
  }

  if (!best) return null;
  return { ...best.range, start: best.start, end: best.end };
}

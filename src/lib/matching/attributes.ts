/**
 * Variant attributes (capacity / color / size) read from free text — listing titles, Shopee
 * model names, catalog variant keys. Pure, used by the matcher (1.9).
 */

export interface OfferAttributes {
  capacityGb: number | null;
  color: string | null;
  sizeInch: number | null;
}

export type AttributeKey = keyof OfferAttributes;

/** Same diacritic stripping as slugify(); keeps punctuation so "2,5TB" and '27"' still parse. */
function foldDiacritics(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[đĐ]/g, "d")
    .toLowerCase();
}

/** Strip diacritics, lowercase, turn anything that isn't [a-z0-9] into single spaces. */
export function normalizeText(s: string): string {
  return foldDiacritics(s)
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** A single distinct value, or null when there are none or several (ambiguous). */
function single<T>(values: T[], eq: (a: T, b: T) => boolean): T | null {
  if (values.length === 0) return null;
  const first = values[0];
  return values.every((v) => eq(v, first)) ? first : null;
}

const CAPACITY_TOLERANCE = 0.03;

/** 2TB (2048) and 2000GB are the same product: marketing and binary units differ by ~2.4%. */
export function capacityEqual(a: number, b: number): boolean {
  return Math.abs(a - b) / Math.max(a, b) <= CAPACITY_TOLERANCE;
}

function parseNumber(raw: string): number {
  return Number(raw.replace(",", "."));
}

function extractCapacity(folded: string): number | null {
  const values: number[] = [];
  for (const m of folded.matchAll(/(\d+(?:[.,]\d+)?)\s*(tb|gb)(?![a-z])/g)) {
    const n = parseNumber(m[1]);
    if (!Number.isFinite(n) || n <= 0) continue;
    values.push(Math.round(m[2] === "tb" ? n * 1024 : n));
  }
  return single(values, capacityEqual);
}

function extractSize(folded: string): number | null {
  const values: number[] = [];
  for (const m of folded.matchAll(/(\d+(?:[.,]\d+)?)\s*(?:"|”|''|inch(?:es)?(?![a-z])|in(?![a-z]))/g)) {
    const n = parseNumber(m[1]);
    if (Number.isFinite(n) && n > 0 && n < 200) values.push(n);
  }
  return single(values, (a, b) => a === b);
}

/** Longest phrases first so "xanh la" wins over "xanh". */
const VI_COLORS: Array<[string, string]> = [
  ["xanh duong", "blue"],
  ["xanh la", "green"],
  ["xanh", "blue"],
  ["den", "black"],
  ["trang", "white"],
  ["xam", "gray"],
  ["bac", "silver"],
  ["do", "red"],
  ["hong", "pink"],
  ["tim", "purple"],
  ["vang", "gold"],
  ["cam", "orange"],
];

const EN_COLORS: Record<string, string> = {
  black: "black",
  white: "white",
  gray: "gray",
  grey: "gray",
  silver: "silver",
  blue: "blue",
  red: "red",
  green: "green",
  pink: "pink",
  purple: "purple",
  gold: "gold",
  yellow: "yellow",
  orange: "orange",
};

function viColorAt(words: string[], i: number): [string, number] | null {
  for (const [phrase, color] of VI_COLORS) {
    const parts = phrase.split(" ");
    if (parts.every((p, k) => words[i + k] === p)) return [color, parts.length];
  }
  return null;
}

/**
 * Vietnamese color words are also ordinary words once diacritics are gone ("đèn" → "den",
 * "cảm biến" → "cam", "do" = "because"). `bareVietnamese: false` only accepts them right after
 * "màu"; use it on long listing titles. Short model names ("Đen, 2TB") can accept them bare.
 */
function extractColor(normalized: string, bareVietnamese: boolean): string | null {
  const words = normalized.split(" ").filter(Boolean);
  const values: string[] = [];
  for (let i = 0; i < words.length; i++) {
    const en = EN_COLORS[words[i]];
    if (en) {
      values.push(en);
      continue;
    }
    const afterMau = i > 0 && words[i - 1] === "mau";
    if (!bareVietnamese && !afterMau) continue;
    const vi = viColorAt(words, i);
    if (vi) {
      values.push(vi[0]);
      i += vi[1] - 1;
    }
  }
  return single(values, (a, b) => a === b);
}

export function extractAttributes(
  text: string,
  opts: { bareVietnameseColors?: boolean } = {},
): OfferAttributes {
  const folded = foldDiacritics(text);
  return {
    capacityGb: extractCapacity(folded),
    color: extractColor(normalizeText(text), opts.bareVietnameseColors ?? true),
    sizeInch: extractSize(folded),
  };
}

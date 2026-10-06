/**
 * Draft clustering key (spec 2026-10-01-tu-tim-theo-nhu-cau-gom-ban-nhap §1). Pure.
 * Two listings with the same key and a similar price are the same unverified product: ingest_listing
 * attaches the second to the first's draft instead of creating another. Conservative on purpose —
 * a missed cluster is a duplicate card, a wrong cluster mixes two products' prices.
 */
import { detectBrand } from "@/lib/matching/match";
import { brandForms } from "@/lib/matching/aliases";
import { capacityEqual, extractAttributes, normalizeText } from "@/lib/matching/attributes";
import { MODEL_SUFFIXES } from "@/lib/matching/model-suffixes";

export { KNOWN_BRANDS } from "@/lib/matching/known-brands";

/** normalizeText() forms; the longest one found picks the accessory type in the key. */
export const ACCESSORY_WORDS: readonly string[] = [
  "op lung", "op", "bao da", "cap", "cu sac", "sac", "sac du phong", "kinh cuong luc", "cuong luc",
  "mieng dan", "dan man hinh", "film", "case", "cover", "day deo", "tui dung", "de sac", "gia do",
  // Replacement parts: "Đệm tai thay thế Sony WH-1000XM5" is not the headphones.
  "dem tai", "mut tai", "pin thay the", "thay the", "linh kien", "keycap", "nut phim",
];

/** normalizeText() phrases marking a used / refurbished / display item ("cu" and "2nd" are checked in context). */
const CONDITION_PHRASES: readonly string[] = [
  "like new", "likenew", "refurbished", "refurb", "da qua su dung", "qua su dung", "second hand",
  "hang trung bay", "trung bay",
];

/** Network generation tokens: "A15 4G" and "A15 5G" are different products. */
const NETWORK_TOKENS: ReadonlySet<string> = new Set(["3g", "4g", "5g", "lte"]);

export { MODEL_SUFFIXES };

/** Short words that are never a model prefix ("cho s24" is not model "chos24"). */
const STOPWORDS: ReadonlySet<string> = new Set([
  "cho", "may", "con", "bo", "set", "va", "voi", "the", "sp", "moi", "new", "ban", "loai", "mau", "sz", "hop",
  "anh", "sac", "cap", "pin", "tai", "loa", "op", "dan", "bim", "ta", "quan",
]);

const UNITS = "gb|tb|mb|mah|w|hz|ml|g|kg|l|mm|cm|m|inch|in|k|p|v|a|ghz|mhz|dpi|btu|pcs|pack|ah|wh|mp|oz|lm|lux|rpm|ppi";
const UNIT_TOKEN = new RegExp(`^\\d+(?:${UNITS})$`);
const SPEC_TOKEN = /^(?:spf|pa|ddr|lpddr|usb|wifi|bt|bluetooth|ip|ipx|gen|pd|qc|hdmi|dp|cat|type)\d+$/;
const UNIT_WORDS: ReadonlySet<string> = new Set(UNITS.split("|"));
const COUNT_WORDS: ReadonlySet<string> = new Set([
  "mieng", "to", "vien", "cai", "chiec", "goi", "hop", "chai", "tui", "cuon", "bich", "mien", "ong", "lo", "cap",
]);
const SIZE_LETTERS: ReadonlySet<string> = new Set(["nb", "xs", "s", "m", "l", "xl", "xxl", "xxxl"]);
const BIG_SIZES: ReadonlySet<string> = new Set(["xl", "xxl", "xxxl"]);

function isYear(tok: string): boolean {
  return /^\d{4}$/.test(tok) && Number(tok) >= 2015 && Number(tok) <= 2035;
}

function isModelToken(tok: string, next: string | undefined): boolean {
  if (NETWORK_TOKENS.has(tok)) return false;
  if (UNIT_TOKEN.test(tok) || SPEC_TOKEN.test(tok) || isYear(tok)) return false;
  if (/[a-z]/.test(tok) && /\d/.test(tok)) return true;
  return /^\d{3,}$/.test(tok) && !(next && (UNIT_WORDS.has(next) || COUNT_WORDS.has(next)));
}

const SIZE_MARKERS: readonly string[] = ["size", "sz", "sai"];
/** Words that mark an accessory as bundled/included ("kem sac", "tang op", "bao gom sac"). */
const BUNDLE_MARKERS: ReadonlySet<string> = new Set(["kem", "tang", "gom"]);

/**
 * Longest accessory phrase in the title, ignoring bundled ones ("kem sac", "tang op", "bao gom sac") and
 * "sac net" (sharp). A phrase excluded as bundled also excludes the shorter phrases inside the same
 * occurrence ("kem kinh cuong luc" must not leave "cuong luc" behind).
 */
function accessoryType(tokens: string[]): string | null {
  const occurrences: { phrase: string; start: number; end: number }[] = [];
  for (const phrase of ACCESSORY_WORDS) {
    const words = phrase.split(" ");
    for (let i = 0; i + words.length <= tokens.length; i++) {
      if (words.every((w, k) => tokens[i + k] === w)) occurrences.push({ phrase, start: i, end: i + words.length });
    }
  }
  const bundled = new Set<number>();
  for (const o of occurrences) {
    if (BUNDLE_MARKERS.has(tokens[o.start - 1] ?? "")) for (let k = o.start; k < o.end; k++) bundled.add(k);
  }
  let best: string | null = null;
  for (const o of occurrences) {
    if (o.phrase === "sac" && tokens[o.start + 1] === "net") continue;
    let skip = false;
    for (let k = o.start; k < o.end; k++) if (bundled.has(k)) skip = true;
    if (skip) continue;
    if (!best || o.phrase.length > best.length) best = o.phrase;
  }
  return best;
}

/** Size after "size"/"sz"/"sai": a letter size or a 1-2 digit number (shoes, clothes); else a bare XL/XXL/XXXL. */
function sizeValue(tokens: string[]): string | null {
  for (let i = 0; i < tokens.length; i++) {
    if (!SIZE_MARKERS.includes(tokens[i])) continue;
    const next = tokens[i + 1] ?? "";
    if (SIZE_LETTERS.has(next) || /^\d{1,2}$/.test(next)) return next;
  }
  return tokens.find((t) => BIG_SIZES.has(t)) ?? null;
}

function hasPhrase(tokens: string[], phrase: string): boolean {
  const words = phrase.split(" ");
  for (let i = 0; i + words.length <= tokens.length; i++) {
    if (words.every((w, k) => tokens[i + k] === w)) return true;
  }
  return false;
}

/**
 * Used, refurbished or display items ("cũ", "like new", "99%") and combos / multi-packs ("combo", "bộ 2",
 * "2 cái", "x2"). "cu sac" is a charger and "2nd gen" a generation (kept as a model token), not a condition.
 */
function isUsedOrCombo(original: string, tokens: string[]): boolean {
  if (/(?:^|[^\d])(?:99|98)\s?%/.test(original)) return true;
  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];
    const next = tokens[i + 1] ?? "";
    if (tok === "cu" && next !== "sac") return true;
    if (tok === "2nd" && next !== "gen" && next !== "generation") return true;
    if (tok === "combo" || /^x\d+$/.test(tok)) return true;
    if ((tok === "bo" || tok === "set") && /^\d+$/.test(next)) return true;
    if (/^\d+$/.test(tok) && next === "cai") return true;
  }
  return CONDITION_PHRASES.some((p) => hasPhrase(tokens, p));
}

/** Every capacity in the title, in GB, distinct (2TB ≈ 2048GB) and sorted: "8GB/128GB" → [8, 128]. */
function capacities(title: string): number[] {
  const values: number[] = [];
  for (const m of title.toLowerCase().matchAll(/(\d+(?:[.,]\d+)?)\s?(gb|tb)(?![a-z])/g)) {
    const n = Number(m[1].replace(",", "."));
    if (!Number.isFinite(n) || n <= 0) continue;
    const gb = Math.round(m[2] === "tb" ? n * 1024 : n);
    if (!values.some((v) => capacityEqual(v, gb))) values.push(gb);
  }
  return values.sort((a, b) => a - b);
}

export function draftKey(input: { title: string; brands: readonly string[] }): string | null {
  // "S24+" is a different model from "S24": spell the plus out before normalizeText drops it.
  const title = input.title.replace(/([a-z0-9])\+/gi, "$1 plus");
  const brand = detectBrand(title, [...input.brands]);
  if (!brand) return null;

  const normalized = normalizeText(title);
  if (isUsedOrCombo(title, normalized.split(" "))) return null;
  // "1.5 HP" is horsepower (air conditioners), not the HP brand.
  if (normalizeText(brand) === "hp" && /(?:^| )\d+ hp(?: |$)/.test(normalized)) return null;
  let rest = ` ${normalized} `;
  for (const form of brandForms(brand)) rest = rest.split(` ${form} `).join(" ");
  const tokens = rest.trim().split(" ").filter(Boolean);

  const models = new Set<string>();
  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];
    if (SIZE_MARKERS.includes(tokens[i - 1] ?? "")) continue; // "size 40" is a size, not a model
    if (!isModelToken(tok, tokens[i + 1])) continue;
    let model = tok;
    const prev = tokens[i - 1];
    if (prev && /^[a-z]{1,3}$/.test(prev) && !STOPWORDS.has(prev)) model = prev + model;
    for (let j = i + 1; j < tokens.length && MODEL_SUFFIXES.has(tokens[j]); j++) model += tokens[j];
    models.add(model);
  }
  if (models.size === 0) return null;

  const attrs = extractAttributes(title, { bareVietnameseColors: false });
  const parts = [`${normalizeText(brand)}`, [...models].sort().join("+")];
  const caps = capacities(title);
  if (caps.length > 0) parts.push(`cap=${caps.join("+")}`);
  const nets = [...new Set(tokens.filter((t) => NETWORK_TOKENS.has(t)))].sort();
  if (nets.length > 0) parts.push(`net=${nets.join("+")}`);
  if (attrs.color != null) parts.push(`color=${attrs.color}`);
  if (attrs.sizeInch != null) parts.push(`size=${attrs.sizeInch}`);

  const sz = sizeValue(tokens);
  if (sz) parts.push(`sz=${sz}`);

  const acc = accessoryType(normalized.split(" "));
  return `${acc ? `acc(${acc.replace(/ /g, "-")}):` : ""}${parts.join("|")}`;
}

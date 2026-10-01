/**
 * Draft clustering key (spec 2026-10-01-tu-tim-theo-nhu-cau-gom-ban-nhap §1). Pure.
 * Two listings with the same key and a similar price are the same unverified product: ingest_listing
 * attaches the second to the first's draft instead of creating another. Conservative on purpose —
 * a missed cluster is a duplicate card, a wrong cluster mixes two products' prices.
 */
import { detectBrand } from "@/lib/matching/match";
import { brandForms } from "@/lib/matching/aliases";
import { extractAttributes, normalizeText } from "@/lib/matching/attributes";

export { KNOWN_BRANDS } from "@/lib/matching/known-brands";

/** normalizeText() forms; the longest one found picks the accessory type in the key. */
export const ACCESSORY_WORDS: readonly string[] = [
  "op lung", "op", "bao da", "bao", "cap", "cu sac", "sac", "sac du phong", "kinh cuong luc", "cuong luc",
  "mieng dan", "dan man hinh", "film", "case", "cover", "day deo", "tui dung", "de sac", "gia do",
];

/** Words that change the model when they follow it ("S24 Ultra" ≠ "S24"). */
export const MODEL_SUFFIXES: ReadonlySet<string> = new Set([
  "pro", "max", "ultra", "plus", "mini", "lite", "air", "se", "fe", "neo", "prime",
]);

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
  if (UNIT_TOKEN.test(tok) || SPEC_TOKEN.test(tok) || isYear(tok)) return false;
  if (/[a-z]/.test(tok) && /\d/.test(tok)) return true;
  return /^\d{3,}$/.test(tok) && !(next && (UNIT_WORDS.has(next) || COUNT_WORDS.has(next)));
}

/** Longest accessory phrase in the title, ignoring bundled ("kem sac", "tang op") and "sac net" (sharp). */
function accessoryType(tokens: string[]): string | null {
  let best: string | null = null;
  for (const phrase of ACCESSORY_WORDS) {
    const words = phrase.split(" ");
    for (let i = 0; i + words.length <= tokens.length; i++) {
      if (!words.every((w, k) => tokens[i + k] === w)) continue;
      if (tokens[i - 1] === "kem" || tokens[i - 1] === "tang") continue;
      if (phrase === "sac" && tokens[i + 1] === "net") continue;
      if (!best || phrase.length > best.length) best = phrase;
    }
  }
  return best;
}

function sizeLetter(tokens: string[]): string | null {
  for (let i = 0; i < tokens.length; i++) {
    if (["size", "sz", "sai"].includes(tokens[i]) && SIZE_LETTERS.has(tokens[i + 1] ?? "")) return tokens[i + 1];
  }
  return tokens.find((t) => BIG_SIZES.has(t)) ?? null;
}

export function draftKey(input: { title: string; brands: readonly string[] }): string | null {
  // "S24+" is a different model from "S24": spell the plus out before normalizeText drops it.
  const title = input.title.replace(/([a-z0-9])\+/gi, "$1 plus");
  const brand = detectBrand(title, [...input.brands]);
  if (!brand) return null;

  const normalized = normalizeText(title);
  // "1.5 HP" is horsepower (air conditioners), not the HP brand.
  if (normalizeText(brand) === "hp" && /(?:^| )\d+ hp(?: |$)/.test(normalized)) return null;
  let rest = ` ${normalized} `;
  for (const form of brandForms(brand)) rest = rest.split(` ${form} `).join(" ");
  const tokens = rest.trim().split(" ").filter(Boolean);

  const models = new Set<string>();
  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];
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
  if (attrs.capacityGb != null) parts.push(`cap=${attrs.capacityGb}`);
  if (attrs.color != null) parts.push(`color=${attrs.color}`);
  if (attrs.sizeInch != null) parts.push(`size=${attrs.sizeInch}`);

  const sz = sizeLetter(tokens);
  if (sz) parts.push(`sz=${sz}`);

  const acc = accessoryType(normalized.split(" "));
  return `${acc ? `acc(${acc.replace(/ /g, "-")}):` : ""}${parts.join("|")}`;
}

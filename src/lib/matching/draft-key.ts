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

/** normalizeText() forms; a title containing one is an accessory and only clusters with accessories. */
export const ACCESSORY_WORDS: readonly string[] = [
  "op lung", "bao da", "cap", "cu sac", "sac", "kinh cuong luc", "mieng dan", "case", "cover",
  "day deo", "tui dung", "de sac", "gia do",
];

/** Words that change the model when they follow it ("S24 Ultra" ≠ "S24"). */
export const MODEL_SUFFIXES: ReadonlySet<string> = new Set([
  "pro", "max", "ultra", "plus", "mini", "lite", "air", "se", "fe", "neo", "prime",
]);

/** Short words that are never a model prefix ("cho s24" is not model "chos24"). */
const STOPWORDS: ReadonlySet<string> = new Set([
  "cho", "may", "con", "bo", "set", "va", "voi", "the", "sp", "moi", "new", "ban", "loai", "mau", "sz", "hop",
]);

const UNIT_TOKEN = /^\d+(?:gb|tb|mb|mah|w|hz|ml|g|kg|l|mm|cm|m|inch|in|k|p|v|a)$/;
const UNIT_WORDS: ReadonlySet<string> = new Set(["gb", "tb", "mb", "mah", "w", "hz", "ml", "g", "kg", "inch", "in"]);

function hasPhrase(text: string, phrase: string): boolean {
  return ` ${text} `.includes(` ${phrase} `);
}

function isYear(tok: string): boolean {
  return /^\d{4}$/.test(tok) && Number(tok) >= 2015 && Number(tok) <= 2035;
}

function isModelToken(tok: string, next: string | undefined): boolean {
  if (UNIT_TOKEN.test(tok) || isYear(tok)) return false;
  if (/[a-z]/.test(tok) && /\d/.test(tok)) return true;
  return /^\d{3,}$/.test(tok) && !(next && UNIT_WORDS.has(next));
}

export function draftKey(input: { title: string; brands: readonly string[] }): string | null {
  const brand = detectBrand(input.title, [...input.brands]);
  if (!brand) return null;

  const normalized = normalizeText(input.title);
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

  const attrs = extractAttributes(input.title, { bareVietnameseColors: false });
  const parts = [`${normalizeText(brand)}`, [...models].sort().join("+")];
  if (attrs.capacityGb != null) parts.push(`cap=${attrs.capacityGb}`);
  if (attrs.color != null) parts.push(`color=${attrs.color}`);
  if (attrs.sizeInch != null) parts.push(`size=${attrs.sizeInch}`);

  const accessory = ACCESSORY_WORDS.some((w) => hasPhrase(normalized, w));
  return `${accessory ? "acc:" : ""}${parts.join("|")}`;
}

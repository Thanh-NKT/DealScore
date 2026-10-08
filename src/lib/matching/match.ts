/**
 * Product matching v1 (1.9 → Phase 2): score how likely a marketplace offer is a given catalog variant.
 * v1 adds GTIN matching and brand aliases; everything else is the v0 scorer.
 * Pure — the caller loads candidates (verified products only) and writes the result.
 *
 * confidence ≥ AUTO_MATCH_THRESHOLD → the offer is attached automatically;
 * SUGGEST_THRESHOLD ≤ confidence < AUTO → it goes to the review queue with this suggestion.
 */
import {
  capacityEqual,
  extractAttributes,
  normalizeText,
  type AttributeKey,
  type OfferAttributes,
} from "@/lib/matching/attributes";
import { brandForms } from "@/lib/matching/aliases";
import { MODEL_SUFFIXES } from "@/lib/matching/model-suffixes";

export const AUTO_MATCH_THRESHOLD = 0.95;
export const SUGGEST_THRESHOLD = 0.5;
/** Same barcode: as sure as matching gets, short of a human. */
const GTIN_CONFIDENCE = 0.99;
/** Two different variants both clearing the auto threshold → nobody can decide automatically. */
const AMBIGUOUS_CONFIDENCE = 0.9;

const WEIGHT_BRAND = 0.3;
const WEIGHT_MODEL = 0.5;
const WEIGHT_ATTRIBUTES = 0.2;

export interface MatchCandidate {
  variantId: string;
  productId: string;
  brand: string | null;
  model: string | null;
  canonicalName: string;
  variantKey: string;
  variantSpecs: Record<string, unknown>;
  /** Number of variants of the candidate's product (including this one). */
  siblingCount: number;
  /** Product barcode (GTIN / EAN / UPC), when the catalog has one. */
  gtin?: string | null;
}

export interface OfferToMatch {
  /** Listing title. */
  title: string;
  /** Shopee model (tier variation) name, e.g. "Đen, 2TB". */
  modelName: string;
  /** Barcode read from the listing, when the marketplace exposes one. */
  gtin?: string | null;
  /**
   * The source gave a price RANGE for this model (min ≠ max): one listing-level price standing for
   * several variants. It never auto-attaches to one variant of a multi-variant product — its price
   * may belong to a sibling (the 128GB price filed under 256GB).
   */
  priceRange?: boolean;
}

export interface MatchResult {
  variantId: string;
  confidence: number;
  reason: string;
}

export const ATTRIBUTE_LABEL: Record<AttributeKey, string> = {
  capacityGb: "dung lượng",
  color: "màu",
  sizeInch: "kích thước",
};

/**
 * Words after a model that make it another model: "980 PRO" is not "980", "iPhone 15 Pro" is not
 * "iPhone 15", "990 EVO" is not "990". The draft-key suffixes plus a few product-line words.
 */
const MODEL_EXTENSIONS: ReadonlySet<string> = new Set([...MODEL_SUFFIXES, "evo", "classic"]);

/**
 * How much of the catalog model appears in the title, on token boundaries.
 * - full: the model tokens, compacted, equal a run of whole title tokens ("990PRO" = "990 pro") and the
 *   next title token does not extend it into another model;
 * - extended: the model only appears followed by an extension word → no model credit at all;
 * - otherwise partial: model tokens found as whole title tokens, each not followed by an extension.
 * Substrings never count: "G304" is not in "G3040".
 */
export function modelCoverage(titleTokens: string[], model: string): { found: number; total: number; extended: boolean } {
  const modelTokens = model.split(" ");
  const total = modelTokens.length;
  const compact = modelTokens.join("");
  const own = new Set(modelTokens);
  const extends_ = (next: string | undefined) => next != null && MODEL_EXTENSIONS.has(next) && !own.has(next);

  let extended = false;
  for (let i = 0; i < titleTokens.length; i++) {
    let acc = "";
    for (let j = i; j < titleTokens.length && acc.length < compact.length; j++) {
      acc += titleTokens[j];
      if (!compact.startsWith(acc)) break;
      if (acc === compact) {
        if (!extends_(titleTokens[j + 1])) return { found: total, total, extended: false };
        extended = true;
        break;
      }
    }
  }
  if (extended) return { found: 0, total, extended: true };

  const found = modelTokens.filter((t) =>
    titleTokens.some((tok, k) => tok === t && !extends_(titleTokens[k + 1])),
  ).length;
  return { found, total, extended: false };
}

export function containsPhrase(normalizedText: string, normalizedPhrase: string): boolean {
  if (!normalizedPhrase) return false;
  return ` ${normalizedText} `.includes(` ${normalizedPhrase} `);
}

/** The longest brand (or brand alias) that appears in the title as whole words. */
export function detectBrand(title: string, brands: string[]): string | null {
  const t = normalizeText(title);
  let best: string | null = null;
  let bestLen = 0;
  let bestIsOwnName = false;
  for (const b of brands) {
    brandForms(b).forEach((form, i) => {
      const own = i === 0;
      // Longer wins; on a tie the brand's own name beats another brand's alias ("Western Digital").
      const better = form.length > bestLen || (form.length === bestLen && own && !bestIsOwnName);
      if (better && containsPhrase(t, form)) {
        best = b;
        bestLen = form.length;
        bestIsOwnName = own;
      }
    });
  }
  return best;
}

/** Digits only; GTINs are 8, 12, 13 or 14 digits. Anything else is not a barcode. */
function cleanGtin(raw: string | null | undefined): string | null {
  const d = (raw ?? "").replace(/\D/g, "");
  if (![8, 12, 13, 14].includes(d.length)) return null;
  return d.padStart(14, "0");
}

export function attributesEqual(key: AttributeKey, a: OfferAttributes[AttributeKey], b: OfferAttributes[AttributeKey]) {
  if (a == null || b == null) return false;
  return key === "capacityGb" ? capacityEqual(a as number, b as number) : a === b;
}

export function formatAttribute(key: AttributeKey, value: OfferAttributes[AttributeKey]): string {
  if (key === "capacityGb") {
    const gb = value as number;
    return gb >= 1000 ? `${Math.round((gb / 1024) * 10) / 10}TB` : `${gb}GB`;
  }
  if (key === "sizeInch") return `${value} inch`;
  return String(value);
}

function round4(x: number): number {
  return Math.round(x * 10_000) / 10_000;
}

export function offerAttributes(offer: OfferToMatch): OfferAttributes {
  const fromModel = extractAttributes(offer.modelName);
  // Titles are long: Vietnamese color words only count after "màu" there.
  const fromTitle = extractAttributes(offer.title, { bareVietnameseColors: false });
  return {
    capacityGb: fromModel.capacityGb ?? fromTitle.capacityGb,
    color: fromModel.color ?? fromTitle.color,
    sizeInch: fromModel.sizeInch ?? fromTitle.sizeInch,
  };
}

export function variantAttributes(c: MatchCandidate): OfferAttributes {
  const specText = Object.values(c.variantSpecs)
    .filter((v): v is string | number => typeof v === "string" || typeof v === "number")
    .join(" ");
  return extractAttributes(`${c.variantKey} ${specText}`);
}

/** Title tokens for modelCoverage(). "S24+" is "S24 Plus", not "S24": spell the plus out before normalizeText drops it (as draftKey does). */
export function modelTitleTokens(title: string): string[] {
  return normalizeText(title.replace(/([a-z0-9])\+/gi, "$1 plus")).split(" ").filter(Boolean);
}

export function scoreCandidate(offer: OfferToMatch, c: MatchCandidate): MatchResult {
  const title = normalizeText(offer.title);
  const zero = (reason: string): MatchResult => ({ variantId: c.variantId, confidence: 0, reason });

  if (!c.brand) return zero("Không nhận ra thương hiệu");
  const mine = offerAttributes(offer);
  const theirs = variantAttributes(c);
  const keys = (Object.keys(theirs) as AttributeKey[]).filter((k) => theirs[k] != null);

  // A conflicting attribute beats everything, even a shared barcode (sellers reuse listings).
  for (const k of keys) {
    if (mine[k] != null && !attributesEqual(k, mine[k], theirs[k])) {
      return zero(`Khác ${ATTRIBUTE_LABEL[k]}`);
    }
  }

  const gOffer = cleanGtin(offer.gtin);
  if (gOffer && gOffer === cleanGtin(c.gtin)) {
    return { variantId: c.variantId, confidence: GTIN_CONFIDENCE, reason: "Khớp mã vạch sản phẩm (GTIN)" };
  }

  if (!brandForms(c.brand).some((form) => containsPhrase(title, form))) return zero("Khác thương hiệu");

  const matched: string[] = [`thương hiệu ${c.brand}`];
  let score = WEIGHT_BRAND;

  const model = normalizeText(c.model ?? "");
  if (model) {
    const titleTokens = modelTitleTokens(offer.title);
    const { found, total, extended } = modelCoverage(titleTokens, model);
    score += WEIGHT_MODEL * (found / total);
    if (found === total) matched.push(`model ${c.model}`);
    if (extended) matched.push(`tên model dài hơn ${c.model}`);
  }

  if (keys.length === 0) {
    // No attribute to check: only safe when the product has nothing to confuse it with.
    if (c.siblingCount === 1) score += WEIGHT_ATTRIBUTES;
  } else if (keys.every((k) => attributesEqual(k, mine[k], theirs[k]))) {
    score += WEIGHT_ATTRIBUTES;
    for (const k of keys) matched.push(`${ATTRIBUTE_LABEL[k]} ${formatAttribute(k, theirs[k])}`);
  }

  let confidence = round4(Math.min(1, score));
  let reason = `Khớp ${matched.join(", ")}`;
  if (offer.priceRange && c.siblingCount > 1 && confidence >= AUTO_MATCH_THRESHOLD) {
    // One price for several variants: a human decides which variant (if any) it belongs to.
    confidence = AMBIGUOUS_CONFIDENCE;
    reason = `${reason} (tin bán có nhiều mức giá)`;
  }
  return { variantId: c.variantId, confidence, reason };
}

export function bestMatch(offer: OfferToMatch, candidates: MatchCandidate[]): MatchResult | null {
  const scored = candidates
    .map((c) => scoreCandidate(offer, c))
    .sort((a, b) => b.confidence - a.confidence);
  const top = scored[0];
  if (!top || top.confidence < SUGGEST_THRESHOLD) return null;

  const rival = scored.find((r) => r.variantId !== top.variantId && r.confidence >= AUTO_MATCH_THRESHOLD);
  if (top.confidence >= AUTO_MATCH_THRESHOLD && rival) {
    return { ...top, confidence: AMBIGUOUS_CONFIDENCE, reason: `${top.reason} (nhiều ứng viên)` };
  }
  return top;
}

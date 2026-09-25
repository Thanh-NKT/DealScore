/**
 * Product matching v0 (1.9): score how likely a marketplace offer is a given catalog variant.
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

export const AUTO_MATCH_THRESHOLD = 0.95;
export const SUGGEST_THRESHOLD = 0.5;
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
}

export interface OfferToMatch {
  /** Listing title. */
  title: string;
  /** Shopee model (tier variation) name, e.g. "Đen, 2TB". */
  modelName: string;
}

export interface MatchResult {
  variantId: string;
  confidence: number;
  reason: string;
}

const ATTRIBUTE_LABEL: Record<AttributeKey, string> = {
  capacityGb: "dung lượng",
  color: "màu",
  sizeInch: "kích thước",
};

function containsPhrase(normalizedText: string, normalizedPhrase: string): boolean {
  if (!normalizedPhrase) return false;
  return ` ${normalizedText} `.includes(` ${normalizedPhrase} `);
}

/** The longest brand that appears in the title as whole words. */
export function detectBrand(title: string, brands: string[]): string | null {
  const t = normalizeText(title);
  let best: string | null = null;
  let bestLen = 0;
  for (const b of brands) {
    const nb = normalizeText(b);
    if (nb.length > bestLen && containsPhrase(t, nb)) {
      best = b;
      bestLen = nb.length;
    }
  }
  return best;
}

function attributesEqual(key: AttributeKey, a: OfferAttributes[AttributeKey], b: OfferAttributes[AttributeKey]) {
  if (a == null || b == null) return false;
  return key === "capacityGb" ? capacityEqual(a as number, b as number) : a === b;
}

function formatAttribute(key: AttributeKey, value: OfferAttributes[AttributeKey]): string {
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

function offerAttributes(offer: OfferToMatch): OfferAttributes {
  const fromModel = extractAttributes(offer.modelName);
  // Titles are long: Vietnamese color words only count after "màu" there.
  const fromTitle = extractAttributes(offer.title, { bareVietnameseColors: false });
  return {
    capacityGb: fromModel.capacityGb ?? fromTitle.capacityGb,
    color: fromModel.color ?? fromTitle.color,
    sizeInch: fromModel.sizeInch ?? fromTitle.sizeInch,
  };
}

function variantAttributes(c: MatchCandidate): OfferAttributes {
  const specText = Object.values(c.variantSpecs)
    .filter((v): v is string | number => typeof v === "string" || typeof v === "number")
    .join(" ");
  return extractAttributes(`${c.variantKey} ${specText}`);
}

export function scoreCandidate(offer: OfferToMatch, c: MatchCandidate): MatchResult {
  const title = normalizeText(offer.title);
  const zero = (reason: string): MatchResult => ({ variantId: c.variantId, confidence: 0, reason });

  if (!c.brand) return zero("Không nhận ra thương hiệu");
  if (!containsPhrase(title, normalizeText(c.brand))) return zero("Khác thương hiệu");

  const mine = offerAttributes(offer);
  const theirs = variantAttributes(c);
  const keys = (Object.keys(theirs) as AttributeKey[]).filter((k) => theirs[k] != null);

  for (const k of keys) {
    if (mine[k] != null && !attributesEqual(k, mine[k], theirs[k])) {
      return zero(`Khác ${ATTRIBUTE_LABEL[k]}`);
    }
  }

  const matched: string[] = [`thương hiệu ${c.brand}`];
  let score = WEIGHT_BRAND;

  const model = normalizeText(c.model ?? "");
  if (model) {
    const compactTitle = title.replace(/ /g, "");
    const tokens = model.split(" ");
    const found = compactTitle.includes(model.replace(/ /g, ""))
      ? tokens.length
      : tokens.filter((t) => containsPhrase(title, t)).length;
    score += WEIGHT_MODEL * (found / tokens.length);
    if (found === tokens.length) matched.push(`model ${c.model}`);
  }

  if (keys.length === 0) {
    // No attribute to check: only safe when the product has nothing to confuse it with.
    if (c.siblingCount === 1) score += WEIGHT_ATTRIBUTES;
  } else if (keys.every((k) => attributesEqual(k, mine[k], theirs[k]))) {
    score += WEIGHT_ATTRIBUTES;
    for (const k of keys) matched.push(`${ATTRIBUTE_LABEL[k]} ${formatAttribute(k, theirs[k])}`);
  }

  return { variantId: c.variantId, confidence: round4(Math.min(1, score)), reason: `Khớp ${matched.join(", ")}` };
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

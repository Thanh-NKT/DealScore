/**
 * The admin "Bảng thuộc tính A/B" (roadmap P3 item 15): offer (A) vs suggested catalog variant (B), one row
 * per attribute with ✓ / ✕ / ?. Pure, computed on read, never stored. It reuses scoreCandidate's own
 * helpers, so a row can never contradict the match confidence (tests/lib/matching/compare.test.ts).
 * No GTIN row: a listing's barcode is not stored, so it would always be "?".
 */
import type { AttributeKey } from "@/lib/matching/attributes";
import { normalizeText } from "@/lib/matching/attributes";
import { brandForms } from "@/lib/matching/aliases";
import {
  attributesEqual,
  containsPhrase,
  detectBrand,
  formatAttribute,
  modelCoverage,
  modelTitleTokens,
  offerAttributes,
  variantAttributes,
  type MatchCandidate,
  type OfferToMatch,
} from "@/lib/matching/match";

export type AttributeRowKey = "brand" | "model" | "capacityGb" | "color" | "sizeInch";
export type AttributeState = "match" | "mismatch" | "unknown";
export type AttributeRow = { key: AttributeRowKey; label: string; offer: string | null; catalog: string | null; state: AttributeState };

const LABEL: Record<AttributeRowKey, string> = {
  brand: "Thương hiệu",
  model: "Model",
  capacityGb: "Dung lượng",
  color: "Màu",
  sizeInch: "Kích thước",
};
const ATTRIBUTE_ROWS: AttributeKey[] = ["capacityGb", "color", "sizeInch"];

function brandRow(offer: OfferToMatch, c: MatchCandidate, brands: string[]): AttributeRow {
  const detected = detectBrand(offer.title, brands);
  const row = (state: AttributeState, shown: string | null): AttributeRow =>
    ({ key: "brand", label: LABEL.brand, offer: shown, catalog: c.brand, state });
  if (!c.brand) return row("unknown", detected);
  const title = normalizeText(offer.title);
  // Same test as scoreCandidate: the catalog brand (or an alias) as whole words of the title.
  if (brandForms(c.brand).some((form) => containsPhrase(title, form))) return row("match", detected ?? c.brand);
  return detected ? row("mismatch", detected) : row("unknown", null);
}

function modelRow(offer: OfferToMatch, c: MatchCandidate): AttributeRow {
  const row = (state: AttributeState, shown: string | null): AttributeRow =>
    ({ key: "model", label: LABEL.model, offer: shown, catalog: c.model, state });
  const model = normalizeText(c.model ?? "");
  if (!model) return row("unknown", null);
  const { found, total, extended } = modelCoverage(modelTitleTokens(offer.title), model);
  if (extended) return row("mismatch", "Tên model dài hơn");
  if (found === total) return row("match", c.model);
  if (found === 0) return row("unknown", null);
  return row("mismatch", `Khớp ${found}/${total} phần`);
}

export function compareAttributes(offer: OfferToMatch, c: MatchCandidate, brands: string[]): AttributeRow[] {
  const mine = offerAttributes(offer);
  const theirs = variantAttributes(c);
  const attrRows = ATTRIBUTE_ROWS.map((k): AttributeRow => {
    const a = mine[k];
    const b = theirs[k];
    const state: AttributeState = a == null || b == null ? "unknown" : attributesEqual(k, a, b) ? "match" : "mismatch";
    return {
      key: k,
      label: LABEL[k],
      offer: a == null ? null : formatAttribute(k, a),
      catalog: b == null ? null : formatAttribute(k, b),
      state,
    };
  });
  return [brandRow(offer, c, brands), modelRow(offer, c), ...attrRows];
}

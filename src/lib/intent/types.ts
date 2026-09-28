/**
 * Query-intent contract (Phase 3 group A, spec §1). `parseQueryIntent` produces a QueryIntent;
 * `applyIntent` (merge.ts) folds it into search URL params. Chip labels are Vietnamese.
 */
import type { MarketplaceId } from "@/lib/marketplaces";

export interface IntentVocab {
  /** From the categories table. */
  categories: { slug: string; name: string }[];
  /** Distinct brands of verified products. */
  brands: string[];
}

export type IntentChipKind =
  | "category"
  | "brand"
  | "price"
  | "capacity"
  | "size"
  | "color"
  | "sort"
  | "free_shipping"
  | "voucher"
  | "marketplace";

/** `label` is user-facing Vietnamese, e.g. "≤ 3.000.000đ". */
export interface IntentChip {
  kind: IntentChipKind;
  label: string;
}

export type IntentSort = "price_asc" | "deal_score" | "effective_asc";

export interface QueryIntent {
  /** Words left after intent extraction (original diacritics/casing); may be empty. */
  text: string;
  categorySlug?: string;
  brands?: string[];
  minPrice?: number;
  maxPrice?: number;
  capacityGb?: number;
  sizeInch?: number;
  color?: string;
  sort?: IntentSort;
  freeShipping?: true;
  hasVoucher?: true;
  marketplaces?: MarketplaceId[];
  /** Usage needs — relevance boost only, never a filter. */
  boostTerms: string[];
  /** In order of appearance in the query. */
  chips: IntentChip[];
}

/** Max input length; longer queries are truncated before parsing. */
export const EMPTY_INTENT_TEXT_LIMIT = 200;

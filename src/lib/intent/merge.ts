/**
 * Merges a parsed `QueryIntent` into URL `SearchParams` (spec §1 "Hợp nhất với tham số URL").
 * Pure, DB-free. The URL always wins: a chip whose field is already set by the URL is dropped
 * from `applied` and its value is never written.
 */
import type { IntentChip, IntentChipKind, QueryIntent } from "@/lib/intent/types";
import type { SearchParams } from "@/lib/search";

function dedupe(values: string[]): string[] {
  return [...new Set(values)];
}

/** Whether `params` leaves the field(s) for this chip kind unset — the only case a chip applies. */
function isFree(params: SearchParams, kind: IntentChipKind, intent: QueryIntent): boolean {
  switch (kind) {
    case "category":
      return intent.categorySlug != null && params.categorySlug == null && params.categoryId == null;
    case "brand":
      return !!intent.brands?.length && (!params.brands || params.brands.length === 0);
    case "price":
      // Counts as set if either URL min or max is set (brief).
      return (intent.minPrice != null || intent.maxPrice != null) && params.minPrice == null && params.maxPrice == null;
    case "capacity":
      return intent.capacityGb != null && params.capacityGb == null;
    case "size":
      // No URL param exists for size — always applied when present.
      return intent.sizeInch != null;
    case "color":
      // No URL param exists for color — always applied when present.
      return intent.color != null;
    case "sort":
      return intent.sort != null && !params.sortExplicit;
    case "free_shipping":
      return intent.freeShipping === true && params.freeShipping !== true;
    case "voucher":
      return intent.hasVoucher === true && params.hasVoucher !== true;
    case "marketplace":
      return !!intent.marketplaces?.length && (!params.marketplaces || params.marketplaces.length === 0);
    default:
      return false;
  }
}

/** Writes an applicable chip's value into `next`. Idempotent — safe to call once per matching chip. */
function applyChip(next: SearchParams, kind: IntentChipKind, intent: QueryIntent): void {
  switch (kind) {
    case "category":
      next.categorySlug = intent.categorySlug;
      break;
    case "brand":
      next.brands = intent.brands;
      break;
    case "price":
      if (intent.minPrice != null) next.minPrice = intent.minPrice;
      if (intent.maxPrice != null) next.maxPrice = intent.maxPrice;
      break;
    case "capacity":
      next.capacityGb = intent.capacityGb;
      break;
    case "size":
      next.sizeInch = intent.sizeInch;
      if (intent.sizeInch != null) {
        next.boostTerms = dedupe([...(next.boostTerms ?? []), `${intent.sizeInch} inch`]);
      }
      break;
    case "color":
      next.color = intent.color;
      if (intent.color != null) {
        next.boostTerms = dedupe([...(next.boostTerms ?? []), intent.color]);
      }
      break;
    case "sort":
      next.sort = intent.sort;
      break;
    case "free_shipping":
      next.freeShipping = true;
      break;
    case "voucher":
      next.hasVoucher = true;
      break;
    case "marketplace":
      next.marketplaces = intent.marketplaces;
      break;
  }
}

export function applyIntent(
  params: SearchParams,
  intent: QueryIntent,
): { params: SearchParams; applied: IntentChip[] } {
  const next: SearchParams = { ...params };
  const applied: IntentChip[] = [];

  // Applicability is decided against the ORIGINAL params, once per kind — so several chips of
  // the same kind (e.g. two brand chips) are all applied together instead of the first one
  // "occupying" the field and blocking the rest.
  const applicable = new Set<IntentChipKind>();
  for (const chip of intent.chips) {
    if (isFree(params, chip.kind, intent)) applicable.add(chip.kind);
  }

  for (const chip of intent.chips) {
    if (!applicable.has(chip.kind)) continue;
    applyChip(next, chip.kind, intent);
    applied.push(chip);
  }

  // boostTerms from intent are always merged (dedup), independent of which chips applied —
  // they're a relevance boost, never a filter.
  if (intent.boostTerms.length > 0) {
    next.boostTerms = dedupe([...(next.boostTerms ?? []), ...intent.boostTerms]);
  }

  if (applied.length > 0) {
    next.q = intent.text || undefined;
  }

  return { params: next, applied };
}

/** Clears the field(s) of one chip kind and turns intent parsing off. Used by the chips UI. */
export function removeChip(params: SearchParams, kind: IntentChipKind): SearchParams {
  const next: SearchParams = { ...params, intent: false };
  switch (kind) {
    case "category":
      next.categorySlug = undefined;
      next.categoryId = undefined;
      break;
    case "brand":
      next.brands = undefined;
      break;
    case "price":
      next.minPrice = undefined;
      next.maxPrice = undefined;
      break;
    case "capacity":
      next.capacityGb = undefined;
      break;
    case "size": {
      const term = next.sizeInch != null ? `${next.sizeInch} inch` : undefined;
      next.sizeInch = undefined;
      if (term) next.boostTerms = next.boostTerms?.filter((t) => t !== term);
      break;
    }
    case "color": {
      const term = next.color;
      next.color = undefined;
      if (term) next.boostTerms = next.boostTerms?.filter((t) => t !== term);
      break;
    }
    case "sort":
      next.sort = undefined;
      next.sortExplicit = undefined;
      break;
    case "free_shipping":
      next.freeShipping = undefined;
      break;
    case "voucher":
      next.hasVoucher = undefined;
      break;
    case "marketplace":
      next.marketplaces = undefined;
      break;
  }
  return next;
}

/**
 * Response contract of `GET /api/autocomplete?q=` (spec 2026-10-07-search-quality-logic §1). Types only,
 * safe to import from Client Components.
 */

/** One product suggestion — same fields the search box has always rendered. */
export interface AutocompleteItem {
  productId: string;
  slug: string;
  categorySlug: string;
  name: string;
  brand: string | null;
  image: string | null;
  bestPrice: number | null;
}

/** A brand from the intent vocab whose name matches the text; `href` is its brand page. */
export interface AutocompleteBrand {
  name: string;
  /** `/brand/{slug}` */
  href: string;
}

/** A category from the intent vocab whose name (or a synonym) matches the text. */
export interface AutocompleteCategory {
  name: string;
  slug: string;
  /** `/{slug}` */
  href: string;
}

/** What the query intent understood and applied to `products`, e.g. "≤ 3.000.000đ", "2TB". Vietnamese. */
export interface AutocompleteIntentChip {
  label: string;
}

export interface AutocompleteResponse {
  /** The query the suggestions are for (trimmed, single spaces, at most 100 characters). */
  q: string;
  /** Up to 8 products, best first. */
  products: AutocompleteItem[];
  /** Up to 3. */
  brands: AutocompleteBrand[];
  /** Up to 3. */
  categories: AutocompleteCategory[];
  /** Empty when no intent was applied (or the intent search found nothing and plain text was used). */
  intent: AutocompleteIntentChip[];
}

export function emptyAutocomplete(q = ""): AutocompleteResponse {
  return { q, products: [], brands: [], categories: [], intent: [] };
}

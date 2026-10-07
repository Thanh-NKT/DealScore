import "server-only";
/**
 * Search-box suggestions (spec 2026-10-07-search-quality-logic §1). Runs the same pipeline as the /search
 * page — query intent (parseQueryIntent + applyIntent), synonym groups, one search_products call — so a
 * suggestion list is a preview of what Enter will show. Brands and categories come from the intent vocab.
 */
import { applyIntent } from "@/lib/intent/merge";
import { parseQueryIntent } from "@/lib/intent/parse";
import { getIntentVocab } from "@/lib/intent/vocab";
import { suggestProducts, type SearchParams } from "@/lib/search";
import type { AutocompleteResponse } from "@/lib/search/autocomplete-types";
import { matchVocab } from "@/lib/search/suggest-vocab";

export const AUTOCOMPLETE_LIMIT = 8;
export const AUTOCOMPLETE_MIN_CHARS = 2;
export const AUTOCOMPLETE_MAX_CHARS = 100;

/** Trimmed, single-spaced, at most AUTOCOMPLETE_MAX_CHARS. */
export function normalizeAutocompleteQuery(raw: string | null | undefined): string {
  return (raw ?? "").trim().replace(/\s+/g, " ").slice(0, AUTOCOMPLETE_MAX_CHARS).trim();
}

/** The default sort /search uses for these params (see app/search/page.tsx). */
function defaultSort(params: SearchParams): SearchParams["sort"] {
  return params.sort ?? (params.q ? "relevance" : "updated");
}

/** Throws when the search RPC fails; the route turns that into the empty response. */
export async function autocomplete(raw: string): Promise<AutocompleteResponse> {
  const q = normalizeAutocompleteQuery(raw);
  // Suggestions are unfiltered by the URL (no marketplace / rating / … filters): only the text counts.
  const plain: SearchParams = { q, sort: "relevance" };

  const vocab = await getIntentVocab();
  const intent = parseQueryIntent(q, vocab);
  const { params: merged, applied } = applyIntent({ q }, intent);
  const intentParams: SearchParams = { ...merged, sort: defaultSort(merged) };

  // Even with no chip applied, intent may add relevance boosts ("gaming") — as on /search.
  let products = await suggestProducts(intentParams, AUTOCOMPLETE_LIMIT);
  let chips = applied;
  // Same fallback as /search: the intent made the search too strict → plain-text suggestions, and the
  // chips no longer describe what is shown.
  if (products.length === 0 && applied.length > 0) {
    products = await suggestProducts(plain, AUTOCOMPLETE_LIMIT);
    chips = [];
  }

  const { brands, categories } = matchVocab(q, vocab);
  return { q, products, brands, categories, intent: chips.map((c) => ({ label: c.label })) };
}

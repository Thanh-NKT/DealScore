/**
 * Client fetch of `/api/autocomplete` for the search box. Pure apart from the injected `fetch`, so the
 * failure paths are unit-tested: a server error or an offline / failed request resolves to the empty
 * answer for `q` (the list leaves its loading state and says "no suggestions"; Enter still searches),
 * only an abort (a newer query superseded this one) resolves to null, meaning "keep what is shown".
 */
import type { AutocompleteResponse } from "@/lib/search/autocomplete-types";

/** Server caps the query at 100 characters too; longer is never sent. */
export const MAX_SENT = 100;

const empty = (q: string): AutocompleteResponse => ({ q, products: [], brands: [], categories: [], intent: [] });

/** Keeps only the fields the list renders, so a malformed answer cannot crash the box. */
export function parseAnswer(q: string, raw: unknown, limit: number): AutocompleteResponse | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Partial<AutocompleteResponse>;
  if (!Array.isArray(r.products)) return null;
  const list = <T>(v: T[] | undefined) => (Array.isArray(v) ? v : []);
  return {
    q,
    products: r.products.slice(0, limit),
    brands: list(r.brands).slice(0, 3),
    categories: list(r.categories).slice(0, 3),
    intent: list(r.intent).filter((c) => typeof c?.label === "string" && c.label.trim() !== ""),
  };
}

export async function fetchSuggestions(
  q: string,
  { limit, signal, fetchImpl = fetch }: { limit: number; signal: AbortSignal; fetchImpl?: typeof fetch },
): Promise<AutocompleteResponse | null> {
  try {
    const res = await fetchImpl(`/api/autocomplete?q=${encodeURIComponent(q.slice(0, MAX_SENT))}`, { signal });
    const answer = res.ok ? parseAnswer(q, await res.json(), limit) : null;
    if (signal.aborted) return null;
    return answer ?? empty(q);
  } catch {
    return signal.aborted ? null : empty(q);
  }
}

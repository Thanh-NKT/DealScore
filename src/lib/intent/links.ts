/**
 * Which params the /search page builds its links from, once query intent may have run (spec §3).
 * Pure, DB-free.
 *
 * - Pagination re-sends the raw URL (original q, intent on): the parser is deterministic, so page N
 *   re-parses to the same chips, boost terms and filters as page 1. Size/colour/need boosts have no
 *   URL form and would otherwise be lost.
 * - Sort and filter links change what is searched, so they carry the applied params with
 *   intent=0 — the leftover words must not be re-parsed against the new URL fields.
 * - In fallback the page shows plain-text results: every link keeps that search (raw + intent=0).
 */
import type { IntentChip } from "@/lib/intent/types";
import type { SearchParams } from "@/lib/search";

export interface SearchLinkParams {
  /** Base for page links (add `page`). */
  pagination: SearchParams;
  /** Base for sort and filter links. */
  nav: SearchParams;
}

export function searchLinkParams(input: {
  raw: SearchParams;
  intentParams: SearchParams;
  applied: IntentChip[];
  fallback: boolean;
}): SearchLinkParams {
  const { raw, intentParams, applied, fallback } = input;
  if (fallback) {
    const plain: SearchParams = { ...raw, intent: false };
    return { pagination: plain, nav: plain };
  }
  if (applied.length === 0) return { pagination: intentParams, nav: intentParams };
  return { pagination: raw, nav: { ...intentParams, intent: false } };
}

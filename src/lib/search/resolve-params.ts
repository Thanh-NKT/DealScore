import type { SearchParams } from "@/lib/search";
import { getIntentVocab } from "@/lib/intent/vocab";
import { parseQueryIntent } from "@/lib/intent/parse";
import { applyIntent } from "@/lib/intent/merge";
import type { IntentChip } from "@/lib/intent/types";

export interface DemandIntent {
  text: string;
  brands?: string[];
  categoryName?: string;
}

/**
 * URL params + query intent, exactly as /search applies it (spec 2026-10-07 §3): "ssd 2tb dưới 3 triệu" →
 * category + capacity + price. The URL always wins (applyIntent). Never preferences. Shared by /search, the
 * saved-search action and the demand-follow action/cron (roadmap P4 E/F) so all three search the same way.
 */
export async function resolveSearchParams(
  raw: SearchParams,
): Promise<{ params: SearchParams; applied: IntentChip[]; demandIntent?: DemandIntent }> {
  if (raw.intent === false || !raw.q) return { params: raw, applied: [] };
  const vocab = await getIntentVocab();
  const intent = parseQueryIntent(raw.q, vocab);
  const demandIntent: DemandIntent = {
    text: intent.text,
    brands: intent.brands,
    categoryName: vocab.categories.find((c) => c.slug === intent.categorySlug)?.name,
  };
  const merged = applyIntent(raw, intent);
  const applied = merged.applied;
  let params = merged.params;
  // Intent consumed every word: "relevance" (the default for a text query) means nothing now, so fall back to
  // the no-query default instead of carrying sort=relevance into the links.
  if (!params.q && !raw.sortExplicit && params.sort === "relevance") {
    params = { ...params, sort: "updated" };
  }
  return { params, applied, demandIntent };
}

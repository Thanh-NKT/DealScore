import "server-only";
import { unstable_cache } from "next/cache";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import type { IntentVocab } from "@/lib/intent/types";
import { reportError } from "@/lib/observability";

type VocabRow = Database["public"]["Functions"]["intent_vocab"]["Returns"][number];

const EMPTY_VOCAB: IntentVocab = { categories: [], brands: [] };

/** RPC rows → IntentVocab. Brands are deduped case-insensitively (first spelling wins). Pure. */
export function mapVocabRows(rows: readonly VocabRow[]): IntentVocab {
  const categories: IntentVocab["categories"] = [];
  const brands: string[] = [];
  const seenBrands = new Set<string>();
  for (const row of rows) {
    const value = row.value?.trim();
    if (!value) continue;
    if (row.kind === "category") {
      categories.push({ slug: value, name: row.label?.trim() || value });
    } else if (row.kind === "brand") {
      const key = value.toLowerCase();
      if (seenBrands.has(key)) continue;
      seenBrands.add(key);
      brands.push(value);
    }
  }
  return { categories, brands };
}

async function loadIntentVocab(): Promise<IntentVocab> {
  // Public catalog data only. unstable_cache can't read cookies(), so this uses a cookie-less anon
  // client (RLS still applies) — same pattern as app/sitemap.ts.
  const supabase = createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const { data, error } = await supabase.rpc("intent_vocab");
  // Throw (not return empty) so a failure is never cached for an hour.
  if (error) throw new Error(`intent_vocab failed: ${error.message}`);
  return mapVocabRows(data ?? []);
}

// No cacheComponents in next.config.ts → unstable_cache (see node_modules/next/dist/docs/
// 01-app/02-guides/caching-without-cache-components.md). The vocab changes when categories or
// verified brands change — an hour of staleness is fine.
const cachedIntentVocab = unstable_cache(loadIntentVocab, ["intent-vocab"], {
  revalidate: 3600,
  tags: ["intent-vocab"],
});

/**
 * Categories + verified brands for the query intent parser (spec §3). Never throws: on error the
 * parser still runs its price/capacity/flag rules with an empty vocab.
 */
export async function getIntentVocab(): Promise<IntentVocab> {
  try {
    return await cachedIntentVocab();
  } catch (err) {
    reportError(err, { where: "getIntentVocab" });
    return EMPTY_VOCAB;
  }
}

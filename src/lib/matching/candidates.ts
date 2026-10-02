import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { detectBrand, type MatchCandidate } from "@/lib/matching/match";

/** Brands of catalog products (product_brands()), non-empty. */
export async function loadBrandVocabulary(client: SupabaseClient<Database>): Promise<string[]> {
  const { data, error } = await client.rpc("product_brands");
  if (error) throw new Error(`product_brands failed: ${error.message}`);
  return (data ?? []).map((r) => r.brand).filter((b): b is string => Boolean(b));
}

/**
 * Verified variants the matcher may attach an offer to: every variant of verified products whose
 * brand appears in the listing title. No recognizable brand → no candidates (v0 never guesses
 * across brands). Pass `brands` when the caller already loaded them.
 */
export async function loadMatchCandidates(
  client: SupabaseClient<Database>,
  title: string,
  brands?: string[],
): Promise<MatchCandidate[]> {
  const brand = detectBrand(title, brands ?? (await loadBrandVocabulary(client)));
  if (!brand) return [];

  const { data, error } = await client
    .from("products")
    .select("id, brand, model, gtin, canonical_name, product_variants ( id, variant_key, specs )")
    .eq("status", "verified")
    .ilike("brand", brand.replace(/[%_\\]/g, (c) => `\\${c}`))
    .limit(200);
  if (error) throw new Error(`Failed to load match candidates: ${error.message}`);

  return (data ?? []).flatMap((p) => {
    const variants = p.product_variants ?? [];
    return variants.map((v) => ({
      variantId: v.id,
      productId: p.id,
      brand: p.brand,
      model: p.model,
      canonicalName: p.canonical_name,
      variantKey: v.variant_key,
      variantSpecs: (v.specs ?? {}) as Record<string, unknown>,
      siblingCount: variants.length,
      gtin: p.gtin,
    }));
  });
}

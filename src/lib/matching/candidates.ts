import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { detectBrand, type MatchCandidate } from "@/lib/matching/match";

/**
 * Verified variants the matcher may attach an offer to: every variant of verified products whose
 * brand appears in the listing title. No recognizable brand → no candidates (v0 never guesses
 * across brands).
 */
export async function loadMatchCandidates(
  client: SupabaseClient<Database>,
  title: string,
): Promise<MatchCandidate[]> {
  const { data: brandRows, error: brandError } = await client.rpc("product_brands");
  if (brandError) throw new Error(`product_brands failed: ${brandError.message}`);

  const brand = detectBrand(
    title,
    (brandRows ?? []).map((r) => r.brand).filter((b): b is string => Boolean(b)),
  );
  if (!brand) return [];

  const { data, error } = await client
    .from("products")
    .select("id, brand, model, canonical_name, product_variants ( id, variant_key, specs )")
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
    }));
  });
}

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { compareAttributes, type AttributeRow } from "@/lib/matching/compare";
import { loadBrandVocabulary } from "@/lib/matching/candidates";
import type { MatchCandidate, OfferToMatch } from "@/lib/matching/match";

export type AttributeTable = { candidateId: string; rows: AttributeRow[] };

const PAGE = 1000;

type OfferRow = {
  id: string;
  listings: { title: string | null } | null;
  product_variants: { variant_key: string; products: { status: string } | null } | null;
};
type VariantRow = {
  id: string;
  product_id: string;
  variant_key: string;
  specs: unknown;
  products: { brand: string | null; model: string | null; canonical_name: string; gtin: string | null } | null;
};

const one = <T>(x: T | T[] | null | undefined): T | null => (Array.isArray(x) ? (x[0] ?? null) : (x ?? null));

/**
 * The A/B attribute tables of match candidates (admin /matches, POST /api/admin/matching/attributes).
 * A = the listing: its title, and as model name the `variant_key` of the draft variant ingest created from
 * the marketplace model name (an offer already on a verified product has no listing model name: ""). B = the
 * suggested variant. A candidate that no longer exists or has no suggestion is left out. Request order kept.
 * Throws on a DB error. Service-role client (match_candidates is admin data).
 */
export async function loadAttributeTables(client: SupabaseClient<Database>, candidateIds: string[]): Promise<AttributeTable[]> {
  const ids = [...new Set(candidateIds)];
  const { data: cands, error } = await client
    .from("match_candidates")
    .select("id, offer_id, suggested_variant_id")
    .in("id", ids);
  if (error) throw new Error(`match_candidates: ${error.message}`);
  const usable = (cands ?? []).filter((c) => c.suggested_variant_id != null);
  if (usable.length === 0) return [];

  const offerIds = [...new Set(usable.map((c) => c.offer_id))];
  const variantIds = [...new Set(usable.map((c) => c.suggested_variant_id as string))];
  const [offersRes, variantsRes, brands] = await Promise.all([
    client.from("offers").select("id, listings(title), product_variants(variant_key, products(status))").in("id", offerIds),
    client.from("product_variants").select("id, product_id, variant_key, specs, products(brand, model, canonical_name, gtin)").in("id", variantIds),
    loadBrandVocabulary(client),
  ]);
  if (offersRes.error) throw new Error(`offers: ${offersRes.error.message}`);
  if (variantsRes.error) throw new Error(`product_variants: ${variantsRes.error.message}`);
  const offers = new Map((offersRes.data as unknown as OfferRow[]).map((o) => [o.id, o]));
  const variants = new Map((variantsRes.data as unknown as VariantRow[]).map((v) => [v.id, v]));

  // Sibling counts (≤ 50 products × ≤ 50 variants can pass the 1,000-row cap: paged).
  const productIds = [...new Set([...variants.values()].map((v) => v.product_id))];
  const siblings = new Map<string, number>();
  for (let from = 0; ; from += PAGE) {
    const { data, error: sErr } = await client
      .from("product_variants")
      .select("id, product_id")
      .in("product_id", productIds)
      .order("id")
      .range(from, from + PAGE - 1);
    if (sErr) throw new Error(`product_variants siblings: ${sErr.message}`);
    for (const r of data ?? []) siblings.set(r.product_id, (siblings.get(r.product_id) ?? 0) + 1);
    if ((data ?? []).length < PAGE) break;
  }

  const byId = new Map(usable.map((c) => [c.id, c]));
  const out: AttributeTable[] = [];
  for (const id of ids) {
    const c = byId.get(id);
    if (!c) continue;
    const o = offers.get(c.offer_id);
    const v = variants.get(c.suggested_variant_id as string);
    const p = one(v?.products);
    if (!o || !v || !p) continue;
    const current = one(o.product_variants);
    const offer: OfferToMatch = {
      title: one(o.listings)?.title ?? "",
      modelName: one(current?.products)?.status === "draft" ? current!.variant_key : "",
    };
    const candidate: MatchCandidate = {
      variantId: v.id,
      productId: v.product_id,
      brand: p.brand,
      model: p.model,
      canonicalName: p.canonical_name,
      variantKey: v.variant_key,
      variantSpecs: v.specs && typeof v.specs === "object" && !Array.isArray(v.specs) ? (v.specs as Record<string, unknown>) : {},
      siblingCount: siblings.get(v.product_id) ?? 1,
      gtin: p.gtin,
    };
    out.push({ candidateId: id, rows: compareAttributes(offer, candidate, brands) });
  }
  return out;
}

import crypto from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { corroborate, type ApiObs, type ExtObs, WINDOW_HOURS } from "@/lib/extension/corroborate";
import type { ObservationModel, ObservationPayload } from "@/lib/extension/payload";
import { normalizeText } from "@/lib/matching/attributes";
import { recomputeDealScores } from "@/lib/pricing/recompute-scores";
import { toVnDate } from "@/lib/format";
import { saveListingExtras } from "@/lib/listing-extras";
import { reportError } from "@/lib/observability";
import { refreshEffectivePrices } from "@/lib/vouchers/refresh-effective";

type Client = SupabaseClient<Database>;

export type ContributionResult =
  | { status: "unknown_item" }
  | { status: "recorded"; recorded: number; promoted: number };

interface OfferRef {
  id: string;
  externalModelId: string | null;
  variantId: string | null;
  variantKey: string | null;
}

/**
 * Which offer each model the extension read belongs to: by Shopee model id when the page gave one,
 * else by name against the variant key, else — only when the listing has exactly one offer — that
 * one. Anything ambiguous is dropped rather than guessed. Pure.
 */
export function mapModelsToOffers(models: ObservationModel[], offers: OfferRef[]): Array<{ model: ObservationModel; offerId: string }> {
  const out: Array<{ model: ObservationModel; offerId: string }> = [];
  for (const m of models) {
    const byId = m.modelId ? offers.find((o) => o.externalModelId === m.modelId) : undefined;
    const name = normalizeText(m.name);
    const byName = name ? offers.filter((o) => o.variantKey && normalizeText(o.variantKey) === name) : [];
    const offer = byId ?? (byName.length === 1 ? byName[0] : offers.length === 1 ? offers[0] : undefined);
    if (offer) out.push({ model: m, offerId: offer.id });
  }
  return out;
}

/**
 * Reporter id stored in vouchers.reporters. That column is public catalog data, so the contributor
 * ("u:<user id>" / "ip:<hash>") is hashed again: stable per contributor, not linkable to an account.
 */
export function voucherReporterId(contributor: string): string {
  const salt = process.env.LOOKUP_IP_SALT || "kairo_lookup_dev_salt";
  return crypto.createHash("sha256").update(`voucher-reporter:${contributor}:${salt}`).digest("hex").slice(0, 32);
}

/** Record one contribution (listing must already be in the catalog), then try to promote. */
export async function recordContribution(
  client: Client,
  contributor: string,
  p: ObservationPayload,
  now = new Date(),
): Promise<ContributionResult> {
  const { data: listing, error: lErr } = await client
    .from("listings")
    .select("id, offers ( id, external_model_id, variant_id, product_variants ( variant_key ) )")
    .eq("marketplace", p.marketplace)
    .eq("external_item_id", p.item)
    .eq("status", "active")
    .maybeSingle();
  if (lErr) throw new Error(`Failed to read listing: ${lErr.message}`);
  if (!listing) return { status: "unknown_item" };

  const offers: OfferRef[] = (listing.offers ?? []).map((o) => ({
    id: o.id,
    externalModelId: o.external_model_id,
    variantId: o.variant_id,
    variantKey: (o.product_variants as { variant_key: string } | null)?.variant_key ?? null,
  }));
  // Vouchers / images: stored as reports; vouchers show only once ≥ 2 contributors saw them
  // (activeVouchers), images only fill a listing that has none. Never fails the price contribution.
  if ((p.vouchers?.length ?? 0) > 0 || (p.images?.length ?? 0) > 0) {
    try {
      await saveListingExtras(client, listing.id, {
        images: p.images,
        vouchers: p.vouchers,
        source: "extension",
        reporter: voucherReporterId(contributor),
      });
    } catch (err) {
      console.error("saveListingExtras from extension failed:", err);
    }
  }

  const mapped = mapModelsToOffers(p.models, offers);
  if (mapped.length === 0) return { status: "recorded", recorded: 0, promoted: 0 };

  const { error: iErr } = await client.from("extension_observations").insert(
    mapped.map(({ model, offerId }) => ({
      offer_id: offerId,
      contributor,
      observed_at: p.observedAt,
      price: model.price,
      original_price: model.originalPrice,
      stock: model.stock,
      free_shipping: p.freeShipping,
      has_voucher: p.hasVoucher,
    })),
  );
  if (iErr) throw new Error(`Failed to store contribution: ${iErr.message}`);

  const promoted = await promoteExtensionObservations(client, [...new Set(mapped.map((m) => m.offerId))], now);
  return { status: "recorded", recorded: mapped.length, promoted };
}

/**
 * Run the corroboration rule for these offers and copy the promoted observations into
 * price_observations (source 'extension'), then refresh current price, today's rollup and scores.
 */
export async function promoteExtensionObservations(client: Client, offerIds: string[], now = new Date()): Promise<number> {
  if (offerIds.length === 0) return 0;
  const since = new Date(now.getTime() - 2 * WINDOW_HOURS * 3_600_000).toISOString();

  const [extRes, apiRes] = await Promise.all([
    client
      .from("extension_observations")
      .select("id, offer_id, contributor, observed_at, price, original_price, stock, free_shipping, has_voucher, promoted_at")
      .in("offer_id", offerIds)
      .gte("observed_at", since)
      .limit(1000),
    client
      .from("price_observations")
      .select("offer_id, observed_at, price")
      .in("offer_id", offerIds)
      .in("source", ["api", "seed"])
      .eq("is_valid", true)
      .gte("observed_at", since)
      .limit(1000),
  ]);
  if (extRes.error) throw new Error(`Failed to read contributions: ${extRes.error.message}`);
  if (apiRes.error) throw new Error(`Failed to read API prices: ${apiRes.error.message}`);

  const rows = extRes.data ?? [];
  const ext: ExtObs[] = rows.map((r) => ({
    id: r.id,
    offerId: r.offer_id,
    contributor: r.contributor,
    observedAt: r.observed_at,
    price: Number(r.price),
    promotedAt: r.promoted_at,
  }));
  const api: ApiObs[] = (apiRes.data ?? [])
    .filter((r) => r.price != null)
    .map((r) => ({ offerId: r.offer_id, observedAt: r.observed_at, price: Number(r.price) }));

  const lastPromotedAt: Record<string, string> = {};
  for (const e of ext) {
    if (e.promotedAt && (!lastPromotedAt[e.offerId] || e.observedAt > lastPromotedAt[e.offerId])) {
      lastPromotedAt[e.offerId] = e.observedAt;
    }
  }

  const promotions = corroborate({ pending: ext.filter((e) => !e.promotedAt), recentExt: ext, recentApi: api, lastPromotedAt, now });
  if (promotions.length === 0) return 0;

  const byId = new Map(rows.map((r) => [r.id, r]));
  const chosen = promotions.map((p) => byId.get(p.id)!);

  const { error: pErr } = await client.from("price_observations").insert(
    chosen.map((r) => ({
      offer_id: r.offer_id,
      observed_at: r.observed_at,
      price: r.price,
      original_price: r.original_price,
      stock: r.stock,
      is_flash_sale: false,
      is_valid: true,
      source: "extension",
    })),
  );
  if (pErr) throw new Error(`Failed to promote contributions: ${pErr.message}`);

  const { error: uErr } = await client
    .from("extension_observations")
    .update({ promoted_at: now.toISOString() })
    .in("id", chosen.map((r) => r.id));
  if (uErr) throw new Error(`Failed to mark promoted contributions: ${uErr.message}`);

  // Free shipping / voucher: only from corroborated reports, like the price.
  for (const r of chosen) {
    if (r.free_shipping == null && r.has_voucher == null) continue;
    const patch: { free_shipping?: boolean; has_voucher?: boolean } = {};
    if (r.free_shipping != null) patch.free_shipping = r.free_shipping;
    if (r.has_voucher != null) patch.has_voucher = r.has_voucher;
    await client.from("offers").update(patch).eq("id", r.offer_id);
  }

  const { data: variants } = await client
    .from("offers")
    .select("variant_id, listing_id")
    .in("id", [...new Set(chosen.map((r) => r.offer_id))]);
  const variantIds = [...new Set((variants ?? []).map((v) => v.variant_id).filter((v): v is string => Boolean(v)))];
  const listingIds = [...new Set((variants ?? []).map((v) => v.listing_id))];
  if (variantIds.length > 0) {
    // Promoted rows can be up to a day old: rebuild the rollup from the oldest one's day.
    const from = toVnDate(chosen.reduce((m, r) => (r.observed_at < m ? r.observed_at : m), chosen[0].observed_at));
    const today = toVnDate(now);
    const { error: cErr } = await client.rpc("refresh_variant_current_price", { p_variant_ids: variantIds });
    if (cErr) throw new Error(`refresh_variant_current_price: ${cErr.message}`);
    const { error: dErr } = await client.rpc("refresh_variant_daily_prices", {
      p_from: from,
      p_to: today,
      p_variant_ids: variantIds,
    });
    if (dErr) throw new Error(`refresh_variant_daily_prices: ${dErr.message}`);
    await recomputeDealScores(client, { now, variantIds });
  }
  // A new current price → recompute the effective price from it (the refresh in saveListingExtras ran
  // before this observation existed). Derived data: a failure never fails the contribution.
  if (listingIds.length > 0) {
    try {
      await refreshEffectivePrices(client, { listingIds, now });
    } catch (err) {
      reportError(err, { where: "promoteExtensionObservations.refreshEffectivePrices" });
    }
  }
  return chosen.length;
}

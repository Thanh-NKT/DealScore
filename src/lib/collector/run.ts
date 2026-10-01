import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { createAdminClient } from "@/lib/supabase/admin";
import { errorRate, selectDueListings, type CollectorListing } from "@/lib/collector/schedule";
import { recomputeDealScores } from "@/lib/pricing/recompute-scores";
import { evaluateWatches } from "@/lib/alerts/evaluate";
import { toVnDate } from "@/lib/format";
import { configuredMarketplaces, getSource } from "@/lib/marketplaces/sources";
import {
  MarketplaceItemGoneError,
  MarketplaceUnavailableError,
  type MarketplaceId,
  type MarketplaceItem,
} from "@/lib/marketplaces/types";
import { saveListingExtras } from "@/lib/listing-extras";
import { refreshEffectivePrices } from "@/lib/vouchers/refresh-effective";
import { reportError } from "@/lib/observability";

/**
 * One collector run (1.10): Collector → Price DB → Deal Engine → Alert Engine.
 *
 *   pick due listings → fetch each from Shopee → record_observations (one transaction per listing)
 *   → refresh today's rollup → recompute Deal Scores → evaluate Watches of the touched variants.
 *
 * Follows the §6 contract of the Watch & Alert spec. Per-item failures are counted, never thrown;
 * only a whole-run failure (DB down) throws.
 */

export interface CollectorDeps {
  fetchItem: (marketplace: MarketplaceId, externalItemId: string) => Promise<MarketplaceItem>;
  configured: () => boolean;
  evaluate: typeof evaluateWatches;
  loadCandidates: (client: SupabaseClient<Database>, poolSize: number) => Promise<CollectorListing[]>;
}

async function loadCandidates(client: SupabaseClient<Database>, poolSize: number): Promise<CollectorListing[]> {
  // Only marketplaces with a data source; today that is Shopee (API or the dev fake).
  const { data, error } = await client.rpc("collector_candidates", {
    p_limit: poolSize,
    p_marketplaces: configuredMarketplaces(),
  });
  if (error) throw new Error(`collector_candidates failed: ${error.message}`);
  return (data ?? []).map((r) => ({
    id: r.id,
    marketplace: r.marketplace as MarketplaceId,
    externalItemId: r.external_item_id,
    refreshPriority: r.refresh_priority,
    lastObservedAt: r.last_observed_at,
    watched: r.watched,
  }));
}

async function fetchItem(marketplace: MarketplaceId, externalItemId: string): Promise<MarketplaceItem> {
  const source = getSource(marketplace);
  if (!source) throw new Error(`No data source for marketplace ${marketplace}`);
  return source.fetchItem(externalItemId);
}

const defaultDeps: CollectorDeps = {
  fetchItem,
  configured: () => configuredMarketplaces().length > 0,
  evaluate: evaluateWatches,
  loadCandidates,
};

export type CollectorResult =
  | { skipped: "not_configured" | "nothing_due" }
  | {
      runId: string;
      selected: number;
      ok: number;
      failed: number;
      aborted: boolean;
      variants: number;
      errorRate: number;
    };

const MAX_ERROR_MESSAGES = 5;
const CANDIDATE_POOL_FACTOR = 5;

export async function runCollector(
  opts: { now?: Date; limit?: number; deadline?: number } = {},
  client: SupabaseClient<Database> = createAdminClient(),
  deps: Partial<CollectorDeps> = {},
): Promise<CollectorResult> {
  const { fetchItem, configured, evaluate, loadCandidates: load } = { ...defaultDeps, ...deps };
  if (!configured()) return { skipped: "not_configured" };

  const now = opts.now ?? new Date();
  const limit = opts.limit ?? 200;

  const due = selectDueListings(await load(client, limit * CANDIDATE_POOL_FACTOR), now, limit);
  if (due.length === 0) return { skipped: "nothing_due" };

  const source = configuredMarketplaces().every((m) => getSource(m)!.isFake()) ? "seed" : "api";
  const { data: run, error: runError } = await client
    .from("collector_runs")
    .insert({ source, started_at: now.toISOString() })
    .select("id")
    .single();
  if (runError || !run) throw new Error(`Failed to open collector run: ${runError?.message}`);

  let ok = 0;
  let failed = 0;
  let aborted = false;
  const errors: string[] = [];
  const touched = new Set<string>();
  const collected: string[] = [];

  for (const listing of due) {
    if (opts.deadline && Date.now() > opts.deadline) break;
    try {
      let payload: Record<string, unknown>;
      let detail: MarketplaceItem | null = null;
      try {
        detail = await fetchItem(listing.marketplace, listing.externalItemId);
        payload = {
          listing_id: listing.id,
          run_id: run.id,
          observed_at: new Date().toISOString(),
          source: detail.source,
          status: "active",
          models: detail.models.map((m) => ({
            model_id: m.modelId,
            price: m.price,
            original_price: m.originalPrice,
            stock: m.stock,
            is_flash_sale: m.isFlashSale,
          })),
        };
      } catch (err) {
        if (!(err instanceof MarketplaceItemGoneError)) throw err;
        payload = { listing_id: listing.id, run_id: run.id, observed_at: new Date().toISOString(), status: "gone" };
      }

      const { data: variantIds, error } = await client.rpc("record_observations", { p: payload as never });
      if (error) throw new Error(`record_observations: ${error.message}`);
      for (const v of variantIds ?? []) touched.add(v);
      collected.push(listing.id);
      ok++;

      // Images + vouchers are extras: a failure here never undoes the recorded price.
      if (detail && ((detail.images?.length ?? 0) > 0 || (detail.vouchers?.length ?? 0) > 0)) {
        try {
          // Effective prices are refreshed once for the whole batch, below.
          await saveListingExtras(
            client,
            listing.id,
            { images: detail.images, vouchers: detail.vouchers, source: detail.source },
            { refreshEffective: false },
          );
        } catch (err) {
          if (errors.length < MAX_ERROR_MESSAGES) {
            errors.push(`${listing.externalItemId} extras: ${err instanceof Error ? err.message : String(err)}`);
          }
        }
      }
    } catch (err) {
      if (err instanceof MarketplaceUnavailableError) {
        // Upstream is down: stop instead of hammering it with the rest of the batch.
        aborted = true;
        errors.push(`${listing.marketplace} unavailable: ${err.message}`);
        break;
      }
      failed++;
      if (errors.length < MAX_ERROR_MESSAGES) {
        errors.push(`${listing.externalItemId}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  const variantIds = [...touched];
  // New prices (and vouchers) → new effective prices, before scores and alerts. Derived data:
  // a failure is reported and never fails the run.
  if (collected.length > 0) {
    try {
      await refreshEffectivePrices(client, { listingIds: collected, now });
    } catch (err) {
      reportError(err, { where: "runCollector.refreshEffectivePrices", runId: run.id });
      if (errors.length < MAX_ERROR_MESSAGES) {
        errors.push(`effective prices: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }
  try {
    if (variantIds.length > 0) {
      const today = toVnDate(now);
      const { error } = await client.rpc("refresh_variant_daily_prices", { p_from: today, p_to: today });
      if (error) throw new Error(`refresh_variant_daily_prices: ${error.message}`);
      await recomputeDealScores(client, { now, variantIds });
      await evaluate({ now, variantIds, deadline: opts.deadline }, client);
    }
  } catch (err) {
    errors.push(`post-processing: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    const { error } = await client
      .from("collector_runs")
      .update({
        finished_at: new Date().toISOString(),
        items_ok: ok,
        items_failed: failed,
        error_summary: errors.length > 0 ? errors.join("\n") : null,
      })
      .eq("id", run.id);
    if (error) console.error("Failed to close collector run:", error.message);
  }

  return { runId: run.id, selected: due.length, ok, failed, aborted, variants: variantIds.length, errorRate: errorRate(ok, failed) };
}

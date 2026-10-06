import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/database.types";
import { createAdminClient } from "@/lib/supabase/admin";
import { errorRate, selectDueListings, type CollectorListing } from "@/lib/collector/schedule";
import { recomputeDealScores } from "@/lib/pricing/recompute-scores";
import { evaluateWatches } from "@/lib/alerts/evaluate";
import { toVnDate } from "@/lib/format";
import { configuredMarketplaces, getSource } from "@/lib/marketplaces/sources";
import {
  MarketplaceItemGoneError,
  MarketplaceItemNotFoundError,
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
 *   pick due listings → fetch each from its marketplace source (one marketplace down never stops the others) → record_observations (one transaction per listing)
 *   → refresh today's rollup → recompute Deal Scores → evaluate Watches of the touched variants.
 *
 * Follows the §6 contract of the Watch & Alert spec. Per-item failures are counted, never thrown;
 * only a whole-run failure (DB down) throws.
 *
 * Time budget: `deadline` is the end of the whole run. Fetching stops POST_PROCESSING_RESERVE_MS before
 * it, so the rollup, Deal Scores and alerts get their own share (evaluateWatches runs until `deadline`).
 * The variants a run touched are stored in collector_runs.pending_variant_ids until they are re-scored:
 * when a run is killed (maxDuration) or its post-processing fails, the next run re-scores them and
 * closes the abandoned run row.
 */

export interface CollectorDeps {
  fetchItem: (marketplace: MarketplaceId, externalItemId: string) => Promise<MarketplaceItem>;
  configured: () => boolean;
  evaluate: typeof evaluateWatches;
  loadCandidates: (client: SupabaseClient<Database>, poolSize: number) => Promise<CollectorListing[]>;
}

async function loadCandidates(client: SupabaseClient<Database>, poolSize: number): Promise<CollectorListing[]> {
  // Every marketplace with a configured data source (API or dev fake).
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
    lastAttemptAt: r.last_attempt_at,
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

export interface MarketplaceRunStats {
  ok: number;
  failed: number;
  aborted: boolean;
}

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
      perMarketplace: Record<string, MarketplaceRunStats>;
    };

const MAX_ERROR_MESSAGES = 5;
const CANDIDATE_POOL_FACTOR = 5;
/** Part of the run's budget kept for post-processing (effective prices, rollup, scores, alerts). */
export const POST_PROCESSING_RESERVE_MS = 20_000;
/** A run still open after this long was killed: the collector lock lives 600 s. */
export const STALE_RUN_MS = 15 * 60_000;
const MAX_ADOPTED_RUNS = 50;

/**
 * Variants left un-scored by earlier runs (killed, or post-processing failed), and the earliest day
 * they were observed. Closes runs that never finished. Best effort: a failure only costs a retry later.
 */
async function adoptPendingRuns(
  client: SupabaseClient<Database>,
  ownRunId: string,
  now: Date,
  errors: string[],
): Promise<{ variantIds: string[]; since: string | null }> {
  const staleBefore = new Date(now.getTime() - STALE_RUN_MS).toISOString();
  const { data, error } = await client
    .from("collector_runs")
    .select("id, started_at, finished_at, pending_variant_ids")
    .neq("id", ownRunId)
    .or(`pending_variant_ids.not.is.null,and(finished_at.is.null,started_at.lt.${staleBefore})`)
    .order("started_at", { ascending: true })
    .limit(MAX_ADOPTED_RUNS);
  if (error) {
    errors.push(`pending runs: ${error.message}`);
    return { variantIds: [], since: null };
  }
  const rows = data ?? [];
  if (rows.length === 0) return { variantIds: [], since: null };

  const variantIds = [...new Set(rows.flatMap((r) => r.pending_variant_ids ?? []))];
  const abandoned = rows.filter((r) => r.finished_at == null && r.started_at < staleBefore).map((r) => r.id);
  const adopted = rows.map((r) => r.id);
  const nowIso = new Date().toISOString();
  if (abandoned.length > 0) {
    const { error: closeError } = await client
      .from("collector_runs")
      .update({ finished_at: nowIso, error_summary: `abandoned: closed by run ${ownRunId} (stopped before it finished)` })
      .in("id", abandoned);
    if (closeError) errors.push(`close abandoned runs: ${closeError.message}`);
  }
  // The ids now belong to this run (written to its own row below until they are re-scored).
  const { error: clearError } = await client.from("collector_runs").update({ pending_variant_ids: null }).in("id", adopted);
  if (clearError) errors.push(`adopt pending variants: ${clearError.message}`);
  return { variantIds, since: rows[0].started_at };
}

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

  const marketplaces = configuredMarketplaces();
  const source = marketplaces.length > 0 && marketplaces.every((m) => getSource(m)!.isFake()) ? "seed" : "api";
  const { data: run, error: runError } = await client
    .from("collector_runs")
    .insert({ source, started_at: now.toISOString() })
    .select("id")
    .single();
  if (runError || !run) throw new Error(`Failed to open collector run: ${runError?.message}`);

  let ok = 0;
  let failed = 0;
  const errors: string[] = [];
  const touched = new Set<string>();
  const carried = await adoptPendingRuns(client, run.id, now, errors);
  for (const v of carried.variantIds) touched.add(v);
  // Fetching stops early so post-processing keeps its share of the budget.
  const fetchDeadline = opts.deadline ? opts.deadline - POST_PROCESSING_RESERVE_MS : undefined;
  const collected: string[] = [];
  const perMarketplace: Record<string, MarketplaceRunStats> = {};
  const stats = (m: string) => (perMarketplace[m] ??= { ok: 0, failed: 0, aborted: false });

  for (const listing of due) {
    if (fetchDeadline && Date.now() > fetchDeadline) break;
    const s = stats(listing.marketplace);
    // A marketplace that is down is not called again this run; the others continue.
    if (s.aborted) continue;
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
      s.ok++;

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
        // Upstream is down: stop calling this marketplace instead of hammering it with the rest of the batch.
        s.aborted = true;
        s.failed++;
        failed++;
        errors.push(`${listing.marketplace} unavailable: ${err.message}`);
        continue;
      }
      failed++;
      s.failed++;
      if (errors.length < MAX_ERROR_MESSAGES) {
        const what = err instanceof MarketplaceItemNotFoundError ? "not found" : err instanceof Error ? err.message : String(err);
        errors.push(`${listing.externalItemId}: ${what}`);
      }
      // Remember the failed attempt (the listing stays active) so it does not stay the most overdue
      // and block healthy listings every run. Best effort: never throws.
      const { error: attemptError } = await client
        .from("listings")
        .update({ last_attempt_at: new Date().toISOString() })
        .eq("id", listing.id);
      if (attemptError && errors.length < MAX_ERROR_MESSAGES) {
        errors.push(`${listing.externalItemId} last_attempt_at: ${attemptError.message}`);
      }
    }
  }
  const aborted = Object.values(perMarketplace).some((s) => s.aborted);

  const variantIds = [...touched];
  // Remember what still needs scoring, in case this run is killed during post-processing.
  if (variantIds.length > 0) {
    const { error } = await client.from("collector_runs").update({ pending_variant_ids: variantIds }).eq("id", run.id);
    if (error && errors.length < MAX_ERROR_MESSAGES) errors.push(`pending variants: ${error.message}`);
  }
  let scored = variantIds.length === 0;
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
      // Variants carried over from an earlier run may have observations from an earlier day.
      const from = carried.since ? toVnDate(new Date(Math.min(Date.parse(carried.since), now.getTime()))) : today;
      const { error } = await client.rpc("refresh_variant_daily_prices", {
        p_from: from,
        p_to: today,
        p_variant_ids: variantIds,
      });
      if (error) throw new Error(`refresh_variant_daily_prices: ${error.message}`);
      await recomputeDealScores(client, { now, variantIds });
      scored = true;
      // Its own deadline: the end of the run budget (fetching already stopped earlier). Watches it does
      // not reach are picked up by the 15-minute alerts cron.
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
        per_marketplace: perMarketplace as unknown as Json,
        ...(scored ? { pending_variant_ids: null } : {}),
      })
      .eq("id", run.id);
    if (error) reportError(new Error(`Failed to close collector run: ${error.message}`), { where: "runCollector.close", runId: run.id });
  }

  return {
    runId: run.id,
    selected: due.length,
    ok,
    failed,
    aborted,
    variants: variantIds.length,
    errorRate: errorRate(ok, failed),
    perMarketplace,
  };
}

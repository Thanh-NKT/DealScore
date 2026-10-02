import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { getSource } from "@/lib/marketplaces/sources";
import { MarketplaceUnavailableError, type MarketplaceId, type MarketplaceItem, type MarketplaceSource } from "@/lib/marketplaces/types";
import { ingestItem, type IngestResult } from "@/lib/ingest";
import { planSourcing, sourcingCap, type SourcingMode, type SourcingQuery } from "@/lib/sourcing/plan";
import { toVnDate } from "@/lib/format";

/**
 * Automatic sourcing: walk the active sourcing_queries of one marketplace (pending demand keywords from
 * searches with few results first) page by page and ingest listings Kairo does not have yet
 * (priority 3 = refreshed daily), up to SOURCING_DAILY_CAP per day.
 * New items go through the same ingest_listing + matcher as pasted links (draft + match_candidates
 * when unsure). Per-item failures are counted, never thrown.
 */

const PAGE_LIMIT = 50;
const MAX_ERROR_MESSAGES = 5;

export interface SourcingRunRow {
  marketplace: MarketplaceId;
  startedAt: string;
  queries: number;
  seen: number;
  ingested: number;
  skippedExisting: number;
  failed: number;
  errorSummary: string | null;
}

export interface SourcingDeps {
  source: MarketplaceSource | null;
  loadQueries(marketplace: MarketplaceId): Promise<SourcingQuery[]>;
  saveQuery(id: string, patch: { nextPage: string | null; lastRunAt: string }): Promise<void>;
  existingIds(marketplace: MarketplaceId, ids: string[]): Promise<Set<string>>;
  ingest(item: MarketplaceItem): Promise<IngestResult>;
  ingestedToday(marketplace: MarketplaceId, now: Date): Promise<number>;
  recordRun(row: SourcingRunRow): Promise<void>;
}

export type SourcingResult =
  | { skipped: "not_configured" | "cap_reached" | "no_queries" }
  | { queries: number; seen: number; ingested: number; skippedExisting: number; failed: number; aborted: boolean };

export async function runSourcing(
  opts: { marketplace: MarketplaceId; now?: Date; deadline?: number; cap?: number; mode?: SourcingMode },
  deps: SourcingDeps,
): Promise<SourcingResult> {
  const now = opts.now ?? new Date();
  const source = deps.source;
  if (!source || !source.isConfigured()) return { skipped: "not_configured" };

  const cap = opts.cap ?? sourcingCap();
  const budget = cap - (await deps.ingestedToday(opts.marketplace, now));
  if (budget <= 0) return { skipped: "cap_reached" };

  const plan = planSourcing(await deps.loadQueries(opts.marketplace), { mode: opts.mode ?? "all" });
  if (plan.length === 0) return { skipped: "no_queries" };

  let queries = 0;
  let seen = 0;
  let ingested = 0;
  let skippedExisting = 0;
  let failed = 0;
  let aborted = false;
  const errors: string[] = [];

  let thrown: unknown;
  let didThrow = false;
  try {
    for (const q of plan) {
      if (ingested >= budget || (opts.deadline && Date.now() > opts.deadline)) break;
      let page;
      try {
        page = await source.searchItems({ kind: q.kind, value: q.value, cursor: q.nextPage, limit: PAGE_LIMIT });
      } catch (err) {
        if (err instanceof MarketplaceUnavailableError) {
          aborted = true;
          errors.push(`${opts.marketplace} unavailable: ${err.message}`);
          break;
        }
        failed++;
        if (errors.length < MAX_ERROR_MESSAGES) errors.push(`${q.kind}:${q.value}: ${err instanceof Error ? err.message : String(err)}`);
        // Always record the attempt: a stale page token restarts from page 1, and a never-run demand query stops being pending until requested again.
        await deps.saveQuery(q.id, { nextPage: null, lastRunAt: now.toISOString() });
        continue;
      }
      queries++;
      seen += page.items.length;

      const existing = await deps.existingIds(opts.marketplace, page.items.map((i) => i.externalItemId));
      let pageDone = true;
      for (const item of page.items) {
        if (ingested >= budget || (opts.deadline && Date.now() > opts.deadline)) {
          pageDone = false;
          break;
        }
        if (existing.has(item.externalItemId)) {
          skippedExisting++;
          continue;
        }
        if (item.models.every((m) => m.price == null)) continue;
        const r = await deps.ingest(item);
        if (r.status === "error") {
          failed++;
          if (errors.length < MAX_ERROR_MESSAGES) errors.push(`${item.externalItemId}: ingest ${r.code}`);
        } else if (r.status === "ingested") {
          ingested++;
        } else {
          skippedExisting++;
        }
      }
      // Stopped mid-page: keep the cursor so the unprocessed items are revisited. A finished query
      // starts again from page 1 next time.
      await deps.saveQuery(q.id, { nextPage: pageDone ? page.nextCursor : q.nextPage, lastRunAt: now.toISOString() });
    }
  } catch (err) {
    didThrow = true;
    thrown = err;
    errors.push(`sourcing aborted: ${err instanceof Error ? err.message : String(err)}`);
  }

  await deps.recordRun({
    marketplace: opts.marketplace,
    startedAt: now.toISOString(),
    queries,
    seen,
    ingested,
    skippedExisting,
    failed,
    errorSummary: errors.length > 0 ? errors.join("\n") : null,
  });
  if (didThrow) throw thrown;
  return { queries, seen, ingested, skippedExisting, failed, aborted };
}

/** Start of today in Vietnam (UTC+7) as an ISO timestamp. */
function vnDayStart(now: Date): string {
  return new Date(Date.parse(`${toVnDate(now)}T00:00:00+07:00`)).toISOString();
}

export function supabaseSourcingDeps(client: SupabaseClient<Database>, marketplace: MarketplaceId): SourcingDeps {
  return {
    source: getSource(marketplace),
    async loadQueries(m) {
      const { data, error } = await client
        .from("sourcing_queries")
        .select("id, marketplace, kind, value, active, next_page, last_run_at, origin, request_count, last_requested_at")
        .eq("marketplace", m)
        .eq("active", true);
      if (error) throw new Error(`sourcing_queries: ${error.message}`);
      return (data ?? []).map((r) => ({
        id: r.id,
        marketplace: r.marketplace as MarketplaceId,
        kind: r.kind as "keyword" | "category",
        value: r.value,
        active: r.active,
        nextPage: r.next_page,
        lastRunAt: r.last_run_at,
        origin: r.origin as "seed" | "demand",
        requestCount: r.request_count,
        lastRequestedAt: r.last_requested_at,
      }));
    },
    async saveQuery(id, patch) {
      const { error } = await client.from("sourcing_queries").update({ next_page: patch.nextPage, last_run_at: patch.lastRunAt }).eq("id", id);
      if (error) throw new Error(`sourcing_queries update: ${error.message}`);
    },
    async existingIds(m, ids) {
      if (ids.length === 0) return new Set();
      const { data, error } = await client.from("listings").select("external_item_id").eq("marketplace", m).in("external_item_id", ids);
      if (error) throw new Error(`listings lookup: ${error.message}`);
      return new Set((data ?? []).map((r) => r.external_item_id));
    },
    ingest: (item) => ingestItem(item, { refreshPriority: 3 }, client),
    async ingestedToday(m, now) {
      const { data, error } = await client.from("sourcing_runs").select("ingested").eq("marketplace", m).gte("started_at", vnDayStart(now));
      if (error) throw new Error(`sourcing_runs: ${error.message}`);
      return (data ?? []).reduce((sum, r) => sum + r.ingested, 0);
    },
    async recordRun(row) {
      const { error } = await client.from("sourcing_runs").insert({
        marketplace: row.marketplace,
        started_at: row.startedAt,
        finished_at: new Date().toISOString(),
        queries: row.queries,
        seen: row.seen,
        ingested: row.ingested,
        skipped_existing: row.skippedExisting,
        failed: row.failed,
        error_summary: row.errorSummary,
      });
      if (error) console.error("Failed to record sourcing run:", error.message);
    },
  };
}

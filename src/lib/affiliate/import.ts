import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { createAdminClient } from "@/lib/supabase/admin";
import type { NormalizedConversion } from "@/lib/affiliate/normalize";
import { normalizeApiRow } from "@/lib/affiliate/normalize";
import type { ShopeeAffiliateClient } from "@/lib/affiliate/shopee-client";

export const UPSERT_BATCH = 500;

export async function upsertNormalizedConversions(
  rows: NormalizedConversion[],
  client: SupabaseClient<Database> = createAdminClient(),
): Promise<{ inserted: number; updated: number; matched: number }> {
  const total = { inserted: 0, updated: 0, matched: 0 };
  for (let i = 0; i < rows.length; i += UPSERT_BATCH) {
    const { data, error } = await client.rpc("upsert_conversions", {
      p_rows: rows.slice(i, i + UPSERT_BATCH) as never,
    });
    if (error) throw new Error(`upsert_conversions failed: ${error.message}`);
    const r = data?.[0];
    total.inserted += r?.inserted ?? 0;
    total.updated += r?.updated ?? 0;
    total.matched += r?.matched ?? 0;
  }
  return total;
}

export const PULL_WINDOW_DAYS = 60; // G6
/** The window is pulled in slices of this many days, NEWEST first. */
export const PULL_SLICE_DAYS = 7;
const PAGE_LIMIT = 500;
const DAY_MS = 86_400_000;

export interface PullResult {
  pages: number;
  rows: number;
  rejected: number;
  inserted: number;
  updated: number;
  matched: number;
  /** false = the deadline stopped the pull before the oldest slice; `pulledFrom` says how far it got. */
  complete: boolean;
  /** Start of the oldest slice that was pulled completely (ISO), or null when none was. */
  pulledFrom: string | null;
}

/**
 * Pull the conversion report for the last PULL_WINDOW_DAYS, newest slice first: when a run cannot
 * finish within its deadline it is the OLDEST orders (status updates only) that wait, never the
 * newest ones. Upsert is idempotent, so the next run simply pulls again; an incomplete pull is
 * reported by the caller (complete: false).
 */
export async function pullConversions(
  opts: { client: ShopeeAffiliateClient; now: Date; deadline?: number },
  upsert: (rows: NormalizedConversion[]) => Promise<{ inserted: number; updated: number; matched: number }> =
    upsertNormalizedConversions,
): Promise<PullResult> {
  const out: PullResult = { pages: 0, rows: 0, rejected: 0, inserted: 0, updated: 0, matched: 0, complete: false, pulledFrom: null };
  const windowStart = opts.now.getTime() - PULL_WINDOW_DAYS * DAY_MS;

  for (let endMs = opts.now.getTime(); endMs > windowStart; endMs -= PULL_SLICE_DAYS * DAY_MS) {
    const start = new Date(Math.max(windowStart, endMs - PULL_SLICE_DAYS * DAY_MS));
    const done = await pullSlice(opts, { start, end: new Date(endMs) }, upsert, out);
    if (!done) return out;
    out.pulledFrom = start.toISOString();
  }
  out.complete = true;
  return out;
}

async function pullSlice(
  opts: { client: ShopeeAffiliateClient; deadline?: number },
  slice: { start: Date; end: Date },
  upsert: (rows: NormalizedConversion[]) => Promise<{ inserted: number; updated: number; matched: number }>,
  out: PullResult,
): Promise<boolean> {
  let scrollId: string | null = null;
  do {
    if (opts.deadline && Date.now() > opts.deadline) return false;

    const page = await opts.client.conversionReport({ start: slice.start, end: slice.end, scrollId, limit: PAGE_LIMIT });
    out.pages++;
    const rows: NormalizedConversion[] = [];
    for (const order of page.orders) {
      for (const item of order.items) {
        const n = normalizeApiRow(order, item);
        if (n.ok) rows.push(n.row);
        else {
          out.rejected++;
          console.warn(`pullConversions: skipping row — ${n.reason}`); // never log raw
        }
      }
    }
    if (rows.length > 0) {
      const r = await upsert(rows);
      out.rows += rows.length;
      out.inserted += r.inserted;
      out.updated += r.updated;
      out.matched += r.matched;
    }
    scrollId = page.nextScrollId;
  } while (scrollId);
  return true;
}

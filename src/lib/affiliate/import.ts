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
const PAGE_LIMIT = 500;

export async function pullConversions(
  opts: { client: ShopeeAffiliateClient; now: Date; deadline?: number },
  upsert: (rows: NormalizedConversion[]) => Promise<{ inserted: number; updated: number; matched: number }> =
    upsertNormalizedConversions,
): Promise<{ pages: number; rows: number; rejected: number; inserted: number; updated: number; matched: number; complete: boolean }> {
  const out = { pages: 0, rows: 0, rejected: 0, inserted: 0, updated: 0, matched: 0, complete: false };
  const start = new Date(opts.now.getTime() - PULL_WINDOW_DAYS * 86_400_000);
  let scrollId: string | null = null;

  do {
    // Stopping midway is harmless: the next run pulls from the start again, and upsert is idempotent.
    if (opts.deadline && Date.now() > opts.deadline) return out;

    const page = await opts.client.conversionReport({ start, end: opts.now, scrollId, limit: PAGE_LIMIT });
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

  out.complete = true;
  return out;
}

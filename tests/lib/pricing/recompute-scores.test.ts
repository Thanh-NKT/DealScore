import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { recomputeDealScores } from "@/lib/pricing/recompute-scores";
import type { DailyPriceRow } from "@/lib/pricing/price-history";

const NOW = new Date("2026-06-15T03:00:00Z");

function history(variantId: string, days: number, price: (i: number) => number) {
  return Array.from({ length: days }, (_, i): DailyPriceRow & { variant_id: string } => {
    const p = price(i);
    return {
      variant_id: variantId,
      day: new Date(NOW.getTime() - (days - 1 - i) * 86_400_000).toISOString().slice(0, 10),
      min_price: p,
      median_price: p,
      max_price: p,
      obs_count: 1,
      offer_count: 1,
      has_flash_sale: false,
      flash_min_price: null,
    };
  });
}

/** Minimal chainable stand-in for the three tables recomputeDealScores touches. */
function fakeClient(tables: Record<string, object[]>) {
  const upserts: Record<string, unknown>[] = [];
  const from = (table: string) => {
    let rows = [...(tables[table] ?? [])] as Record<string, unknown>[];
    const q = {
      select: () => q,
      in: (col: string, vals: unknown[]) => {
        rows = rows.filter((r) => vals.includes(r[col]));
        return q;
      },
      gte: (col: string, v: string) => {
        rows = rows.filter((r) => String(r[col]) >= v);
        return q;
      },
      order: () => q,
      range: (a: number, b: number) => Promise.resolve({ data: rows.slice(a, b + 1), error: null }),
      delete: () => q,
      upsert: (r: Record<string, unknown>[]) => {
        upserts.push(...r);
        return Promise.resolve({ error: null });
      },
      then: (res: (v: { data: unknown; error: null }) => unknown) => Promise.resolve({ data: rows, error: null }).then(res),
    };
    return q;
  };
  return { client: { from } as unknown as SupabaseClient<Database>, upserts };
}

describe("recomputeDealScores — fake_sale cache", () => {
  it("writes the best offer's fake-sale kind per variant, null when not checkable", async () => {
    const { client, upserts } = fakeClient({
      variant_current_price: [
        { variant_id: "inflated", price: 1050, original_price: 1500, in_stock: true, is_flash_sale: false },
        { variant_id: "honest", price: 800, original_price: 1500, in_stock: true, is_flash_sale: false },
        { variant_id: "young", price: 1000, original_price: 1500, in_stock: true, is_flash_sale: false },
      ],
      variant_daily_prices: [
        ...history("inflated", 60, (i) => 1000 + (i % 10) * 20),
        ...history("honest", 60, (i) => 1000 + (i % 10) * 20),
        ...history("young", 10, () => 1000),
      ],
    });
    await recomputeDealScores(client, { now: NOW, variantIds: ["inflated", "honest", "young"] });
    const byId = Object.fromEntries(upserts.map((r) => [r.variant_id, r.fake_sale]));
    expect(byId).toEqual({ inflated: "list_inflated", honest: null, young: null });
  });
});

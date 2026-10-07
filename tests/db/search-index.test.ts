import { describe, expect, it } from "vitest";
import { admin } from "./helpers";

// Migration 0030 (spec 2026-10-07-search-quality-logic §3): a keyword search reads products through the
// FTS / trigram indexes. search_index_report() runs search_products with seq scans disabled and reports
// this transaction's scan counters — with no usable index the planner would fall back to a Seq Scan or a
// full scan of another products index (v11 read all of idx_products_category).
const report = async (q: string, groups?: string[][]) => {
  const { data, error } = await admin.rpc("search_index_report", { p_q: q, p_term_groups: groups });
  if (error) throw error;
  return data![0];
};

describe("search_products — index path", () => {
  it("a keyword search uses the FTS index, never a full products scan", async () => {
    const r = await report("sony");
    expect(r.products_seq_scans).toBe(0);
    expect(r.other_index_scans).toBe(0);
    expect(r.fts_index_scans).toBeGreaterThanOrEqual(1);
  });

  it("synonym groups keep the index path", async () => {
    const r = await report("tai nghe", [["tai nghe", "headphone", "earbuds"]]);
    expect(r.products_seq_scans).toBe(0);
    expect(r.other_index_scans).toBe(0);
    expect(r.fts_index_scans).toBeGreaterThanOrEqual(1);
  });

  it("the typo fallback (%>) goes through the trigram index", async () => {
    const r = await report("samsng");
    expect(r.products_seq_scans).toBe(0);
    expect(r.other_index_scans).toBe(0);
    expect(r.trgm_index_scans).toBeGreaterThanOrEqual(1);
  });

  it("is not callable by anon", async () => {
    const { createClient } = await import("@supabase/supabase-js");
    const anon = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { error } = await anon.rpc("search_index_report", { p_q: "sony" });
    expect(error).not.toBeNull();
  });
});

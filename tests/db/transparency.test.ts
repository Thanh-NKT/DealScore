import { createClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "@/lib/database.types";
import { admin, SUPABASE_URL } from "./helpers";

// Migration 0044: deal_score_accuracy is callable by anon; backtest_runs stays closed.
const anon = createClient<Database>(SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const ids: string[] = [];
const base = { horizon_days: 30, drop_threshold: 0.0123, variants: 3, samples: 10, buy_n: 4, buy_correct: 3, wait_n: 4, wait_correct: 2, avoid_n: 2, avoid_correct: 1, accuracy: 0.6, version: "v0" };

beforeAll(async () => {
  const day = 86_400_000;
  const { data, error } = await admin
    .from("backtest_runs")
    .insert([
      { ...base, ran_at: new Date(Date.now() - 2 * day).toISOString() },
      { ...base, ran_at: new Date(Date.now() - 10 * day).toISOString() },
      { ...base, ran_at: new Date(Date.now() - 100 * 7 * day).toISOString() },
    ])
    .select("id");
  if (error) throw error;
  ids.push(...(data ?? []).map((r) => r.id));
});
afterAll(async () => {
  await admin.from("backtest_runs").delete().in("id", ids);
});

// Rows of this test are told apart by their unusual drop_threshold.
const testRows = (rows: Array<{ drop_threshold: number }> | null) => (rows ?? []).filter((r) => Number(r.drop_threshold) === 0.0123);

describe("deal_score_accuracy (0044)", () => {
  it("anon can call it; rows newest first", async () => {
    const { data, error } = await anon.rpc("deal_score_accuracy", { p_weeks: 12 });
    expect(error).toBeNull();
    const rows = testRows(data);
    expect(rows).toHaveLength(2);
    const times = (data ?? []).map((r) => Date.parse(r.ran_at));
    expect([...times].sort((a, b) => b - a)).toEqual(times);
  });

  it("anon still cannot select backtest_runs", async () => {
    const { error } = await anon.from("backtest_runs").select("id").limit(1);
    expect(error?.code).toBe("42501");
  });

  it("p_weeks is clamped: 0 → 1 week, 999 → 52 weeks", async () => {
    expect(testRows((await anon.rpc("deal_score_accuracy", { p_weeks: 0 })).data)).toHaveLength(1);
    expect(testRows((await anon.rpc("deal_score_accuracy", { p_weeks: 999 })).data)).toHaveLength(2);
  });
});

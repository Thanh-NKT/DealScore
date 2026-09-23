import { describe, expect, it } from "vitest";
import { configFromRow, stateFromRow, toRpcState } from "@/lib/watch/rows";

const row = {
  id: "w",
  user_id: "u",
  product_id: "p",
  variant_id: "v",
  target_price: "1250000",
  drop_pct: 10,
  notify_low: true,
  min_deal_score: null,
  notify_back_in_stock: false,
  channels: ["email"],
  folder: null,
  note: null,
  status: "active",
  created_at: "2026-09-01T00:00:00Z",
  baseline_price: 1300000,
  cond_state: { target_price: true, rac: 1 },
  last_alert_price: null,
  last_alerted_at: null,
  last_in_stock: true,
  last_evaluated_at: null,
  config_version: 3,
  updated_at: "2026-09-01T00:00:00Z",
};

describe("rows", () => {
  it("configFromRow converts numeric to number", () => {
    expect(configFromRow(row as never)).toEqual({
      targetPrice: 1250000,
      dropPct: 10,
      notifyLow: true,
      minDealScore: null,
      notifyBackInStock: false,
      channels: ["email"],
    });
  });
  it("stateFromRow keeps only valid boolean keys of cond_state", () => {
    expect(stateFromRow(row as never).condState).toEqual({ target_price: true });
  });
  it("toRpcState uses record_watch_evaluation's key names", () => {
    expect(
      toRpcState({ condState: { low: false }, lastInStock: true, baselinePrice: 5, alerted: { price: 4, at: "t" } }),
    ).toEqual({ cond_state: { low: false }, last_in_stock: true, baseline_price: 5, alerted: { price: 4, at: "t" } });
    expect(toRpcState({ condState: {}, lastInStock: null })).toEqual({ cond_state: {} });
  });
});

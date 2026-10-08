import { describe, expect, it, vi } from "vitest";
import { detectPriceAnomalies } from "@/lib/anomalies/detect";
import {
  ANOMALY_BASELINE_DAYS,
  ANOMALY_DROP_RATIO,
  ANOMALY_MIN_BASELINE_OBS,
  ANOMALY_SPIKE_RATIO,
  ANOMALY_THRESHOLDS,
} from "@/lib/anomalies/constants";

const client = (result: { data: unknown; error: unknown }) => {
  const rpc = vi.fn(async () => result);
  return { rpc, c: { rpc } as never };
};

describe("ANOMALY_THRESHOLDS", () => {
  it("gathers the four detector constants", () => {
    expect(ANOMALY_THRESHOLDS).toEqual({
      spikeRatio: ANOMALY_SPIKE_RATIO, dropRatio: ANOMALY_DROP_RATIO,
      baselineDays: ANOMALY_BASELINE_DAYS, minBaselineObs: ANOMALY_MIN_BASELINE_OBS,
    });
    expect(ANOMALY_SPIKE_RATIO).toBeGreaterThan(1);
    expect(ANOMALY_DROP_RATIO).toBeGreaterThan(0);
    expect(ANOMALY_DROP_RATIO).toBeLessThan(1);
  });
});

describe("detectPriceAnomalies", () => {
  it("calls detect_price_anomalies with the thresholds and returns the count", async () => {
    const { rpc, c } = client({ data: 4, error: null });
    const since = new Date("2026-10-08T01:00:00Z");
    expect(await detectPriceAnomalies(c, { since, offerIds: ["o1"] })).toBe(4);
    expect(rpc).toHaveBeenCalledWith("detect_price_anomalies", {
      p_since: since.toISOString(), p_baseline_days: 30, p_spike_ratio: 3, p_drop_ratio: 0.4, p_min_baseline_obs: 5, p_offer_ids: ["o1"],
    });
  });
  it("omits p_offer_ids when not scoped", async () => {
    const { rpc, c } = client({ data: 0, error: null });
    await detectPriceAnomalies(c, { since: new Date() });
    expect(rpc.mock.calls[0]).toHaveLength(2);
    expect((rpc.mock.calls[0] as unknown[])[1]).not.toHaveProperty("p_offer_ids");
  });
  it("throws on a DB error", async () => {
    const { c } = client({ data: null, error: { message: "boom" } });
    await expect(detectPriceAnomalies(c, { since: new Date() })).rejects.toThrow(/boom/);
  });
});

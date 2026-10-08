import { describe, expect, it } from "vitest";
import { summarizeAccuracy, type AccuracyRow } from "@/lib/transparency/accuracy";

const row = (o: Partial<AccuracyRow> = {}): AccuracyRow => ({
  ranAt: "2026-10-01T00:00:00Z",
  version: "v1",
  horizonDays: 30,
  dropThreshold: 0.05,
  variants: 40,
  samples: 300,
  buyN: 100,
  buyCorrect: 80,
  waitN: 150,
  waitCorrect: 90,
  avoidN: 50,
  avoidCorrect: 20,
  accuracy: 0.99, // never trusted
  ...o,
});

describe("summarizeAccuracy", () => {
  it("empty → latest null, not enough", () => {
    expect(summarizeAccuracy([], "v1")).toEqual({ latest: null, trend: [], enough: false });
  });

  it("only live-version rows; overall recomputed from the counts", () => {
    const s = summarizeAccuracy([row({ version: "v0", ranAt: "2026-10-05T00:00:00Z", samples: 999 }), row()], "v1");
    expect(s.latest!.samples).toBe(300);
    expect(s.latest!.overall).toBeCloseTo(190 / 300);
    expect(s.enough).toBe(true);
    expect(s.latest!.buy).toEqual({ n: 100, correct: 80, pct: 0.8 });
  });

  it("a verdict under 30 samples → pct null; under 200 samples → not enough", () => {
    const s = summarizeAccuracy([row({ samples: 150, avoidN: 29, avoidCorrect: 10 })], "v1");
    expect(s.latest!.avoid.pct).toBeNull();
    expect(s.enough).toBe(false);
  });

  it("trend ordered oldest → newest", () => {
    const s = summarizeAccuracy(
      [row({ ranAt: "2026-10-08T00:00:00Z" }), row({ ranAt: "2026-09-24T00:00:00Z" }), row({ ranAt: "2026-10-01T00:00:00Z", samples: 0 })],
      "v1",
    );
    expect(s.trend.map((t) => t.ranAt)).toEqual(["2026-09-24T00:00:00Z", "2026-10-01T00:00:00Z", "2026-10-08T00:00:00Z"]);
    expect(s.trend[1].overall).toBeNull();
    expect(s.latest!.ranAt).toBe("2026-10-08T00:00:00Z");
  });

  it("a run under ACCURACY_MIN_SAMPLES is not plotted (overall null), like the hidden headline", () => {
    const s = summarizeAccuracy([row({ ranAt: "2026-09-24T00:00:00Z", samples: 199 }), row({ samples: 200 })], "v1");
    expect(s.trend.map((t) => t.overall)).toEqual([null, 190 / 200]);
  });
});

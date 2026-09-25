import { describe, expect, it } from "vitest";
import { corroborate, type ExtObs } from "@/lib/extension/corroborate";

const NOW = new Date("2026-09-25T12:00:00Z");
const ago = (h: number) => new Date(NOW.getTime() - h * 3_600_000).toISOString();
let seq = 0;
const ext = (o: Partial<ExtObs> = {}): ExtObs => ({
  id: ++seq,
  offerId: "o1",
  contributor: "u1",
  observedAt: ago(1),
  price: 1_000_000,
  promotedAt: null,
  ...o,
});

const run = (pending: ExtObs[], extra: Partial<Parameters<typeof corroborate>[0]> = {}) =>
  corroborate({ pending, recentExt: pending, recentApi: [], lastPromotedAt: {}, now: NOW, ...extra });

describe("corroborate", () => {
  it("a single contributor is never enough", () => {
    expect(run([ext(), ext({ observedAt: ago(2) })])).toEqual([]);
  });

  it("two different contributors within 2% and 24h corroborate each other (one promotion per hour)", () => {
    const a = ext({ contributor: "u1", observedAt: ago(3), price: 1_000_000 });
    const b = ext({ contributor: "u2", observedAt: ago(1), price: 1_015_000 });
    expect(run([a, b])).toEqual([
      { id: a.id, reason: "peer" },
      { id: b.id, reason: "peer" },
    ]);
  });

  it("prices more than 2% apart do not corroborate", () => {
    expect(run([ext({ contributor: "u1" }), ext({ contributor: "u2", price: 1_030_000 })])).toEqual([]);
  });

  it("a peer more than 24h away does not count", () => {
    expect(run([ext({ contributor: "u1", observedAt: ago(1) }), ext({ contributor: "u2", observedAt: ago(26) })])).toEqual([]);
  });

  it("matching a recent API price (±2%, ≤ 24h) is enough on its own", () => {
    const a = ext();
    expect(run([a], { recentApi: [{ offerId: "o1", observedAt: ago(5), price: 990_000 }] })).toEqual([{ id: a.id, reason: "api" }]);
  });

  it("peers on another offer never count", () => {
    expect(run([ext({ contributor: "u1" }), ext({ contributor: "u2", offerId: "o2" })])).toEqual([]);
  });

  it("at most one promotion per offer per hour", () => {
    const a = ext({ contributor: "u1", observedAt: ago(1.2) });
    const b = ext({ contributor: "u2", observedAt: ago(1) });
    const c = ext({ contributor: "u3", observedAt: ago(0.1) });
    expect(run([a, b, c]).map((r) => r.id)).toEqual([a.id, c.id]);
  });

  it("respects the last promotion already stored", () => {
    const a = ext({ contributor: "u1", observedAt: ago(0.5) });
    const b = ext({ contributor: "u2", observedAt: ago(0.4) });
    expect(run([a, b], { lastPromotedAt: { o1: ago(0.9) } })).toEqual([]);
  });

  it("already promoted or too old pending rows are skipped", () => {
    const old = ext({ contributor: "u1", observedAt: ago(30) });
    const done = ext({ contributor: "u2", observedAt: ago(1), promotedAt: ago(0.5) });
    expect(run([old, done])).toEqual([]);
  });
});

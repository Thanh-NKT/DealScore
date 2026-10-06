import { describe, expect, it } from "vitest";
import { corroborate, inPeerBand, peerKeyOf, type ExtObs } from "@/lib/extension/corroborate";

const NOW = new Date("2026-09-25T12:00:00Z");
const ago = (h: number) => new Date(NOW.getTime() - h * 3_600_000).toISOString();
let seq = 0;
const ext = (o: Partial<ExtObs> = {}): ExtObs => {
  const id = ++seq;
  return {
    id,
    offerId: "o1",
    contributor: `u${id}`,
    peerKey: `net${id}`,
    observedAt: ago(1),
    price: 1_000_000,
    promotedAt: null,
    ...o,
  };
};

// The offer's latest API price: peer-only promotions must stay near it.
const ANCHORS = { o1: 1_000_000, o2: 1_000_000 };
const run = (pending: ExtObs[], extra: Partial<Parameters<typeof corroborate>[0]> = {}) =>
  corroborate({ pending, recentExt: pending, recentApi: [], anchors: ANCHORS, lastPromotedAt: {}, now: NOW, ...extra });

describe("corroborate", () => {
  it("a single contributor is never enough", () => {
    expect(run([ext({ contributor: "u1", peerKey: "n1" }), ext({ contributor: "u1", peerKey: "n1", observedAt: ago(2) })])).toEqual([]);
  });

  it("two independent contributors within 2% and 24h corroborate each other (one promotion per hour)", () => {
    const a = ext({ contributor: "u1", peerKey: "n1", observedAt: ago(3), price: 1_000_000 });
    const b = ext({ contributor: "u2", peerKey: "n2", observedAt: ago(1), price: 1_015_000 });
    expect(run([a, b])).toEqual([
      { id: a.id, reason: "peer" },
      { id: b.id, reason: "peer" },
    ]);
  });

  it("the same network with and without an account cookie is one peer, not two", () => {
    const signedIn = ext({ contributor: "u:user-1", peerKey: "hash-1", price: 100_000 });
    const anonymous = ext({ contributor: "ip:hash-1", peerKey: "hash-1", price: 100_000 });
    expect(run([signedIn, anonymous], { anchors: { o1: 120_000 } })).toEqual([]);
    // Legacy anonymous rows without peer_key are keyed by the hash inside the contributor id.
    expect(run([signedIn, { ...anonymous, peerKey: null }], { anchors: { o1: 120_000 } })).toEqual([]);
  });

  it("two accounts on the same network are one peer", () => {
    expect(run([ext({ contributor: "u:a", peerKey: "h" }), ext({ contributor: "u:b", peerKey: "h" })])).toEqual([]);
  });

  it("a signed-in row without a peer key cannot prove independence", () => {
    expect(run([ext({ contributor: "u:a", peerKey: null }), ext({ contributor: "u:b", peerKey: "h2" })])).toEqual([]);
  });

  it("peer agreement far from the latest API price is not promoted (forged -90% price)", () => {
    const a = ext({ price: 100_000 });
    const b = ext({ price: 100_000 });
    expect(run([a, b])).toEqual([]);
    const high = [ext({ price: 1_600_000 }), ext({ price: 1_600_000 })];
    expect(run(high)).toEqual([]);
    const inBand = [ext({ price: 600_000 }), ext({ price: 600_000 })];
    expect(run(inBand).map((p) => p.reason)).toEqual(["peer"]);
  });

  it("without a trusted anchor price, peers alone never promote", () => {
    expect(run([ext(), ext()], { anchors: {} })).toEqual([]);
  });

  it("observations claimed in the future are never promoted, nor counted as peers", () => {
    const future = new Date(NOW.getTime() + 10 * 60_000).toISOString();
    expect(run([ext({ observedAt: future }), ext({ observedAt: future })])).toEqual([]);
    const api = [{ offerId: "o1", observedAt: ago(1), price: 1_000_000 }];
    expect(run([ext({ observedAt: future })], { recentApi: api })).toEqual([]);
    expect(run([ext(), ext({ observedAt: future })])).toEqual([]);
  });

  it("prices more than 2% apart do not corroborate", () => {
    expect(run([ext(), ext({ price: 1_030_000 })])).toEqual([]);
  });

  it("a peer more than 24h away does not count", () => {
    expect(run([ext({ observedAt: ago(1) }), ext({ observedAt: ago(26) })])).toEqual([]);
  });

  it("matching a recent API price (±2%, ≤ 24h) is enough on its own", () => {
    const a = ext();
    expect(run([a], { recentApi: [{ offerId: "o1", observedAt: ago(5), price: 990_000 }] })).toEqual([{ id: a.id, reason: "api" }]);
  });

  it("peers on another offer never count", () => {
    expect(run([ext(), ext({ offerId: "o2" })])).toEqual([]);
  });

  it("at most one promotion per offer per hour", () => {
    const a = ext({ observedAt: ago(1.2) });
    const b = ext({ observedAt: ago(1) });
    const c = ext({ observedAt: ago(0.1) });
    expect(run([a, b, c]).map((r) => r.id)).toEqual([a.id, c.id]);
  });

  it("respects the last promotion already stored", () => {
    const a = ext({ observedAt: ago(0.5) });
    const b = ext({ observedAt: ago(0.4) });
    expect(run([a, b], { lastPromotedAt: { o1: ago(0.9) } })).toEqual([]);
  });

  it("already promoted or too old pending rows are skipped", () => {
    const old = ext({ observedAt: ago(30) });
    const done = ext({ observedAt: ago(1), promotedAt: ago(0.5) });
    expect(run([old, done])).toEqual([]);
  });
});

describe("peer helpers", () => {
  it("peerKeyOf prefers the stored key, then the anonymous id", () => {
    expect(peerKeyOf({ contributor: "u:x", peerKey: "k" })).toBe("k");
    expect(peerKeyOf({ contributor: "ip:abc", peerKey: null })).toBe("abc");
    expect(peerKeyOf({ contributor: "u:x", peerKey: null })).toBeNull();
  });

  it("inPeerBand is 0.5×–1.5× of the anchor", () => {
    expect(inPeerBand(500_000, 1_000_000)).toBe(true);
    expect(inPeerBand(1_500_000, 1_000_000)).toBe(true);
    expect(inPeerBand(499_999, 1_000_000)).toBe(false);
    expect(inPeerBand(1_500_001, 1_000_000)).toBe(false);
    expect(inPeerBand(1_000_000, null)).toBe(false);
  });
});

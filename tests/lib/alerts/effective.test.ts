import { describe, expect, it } from "vitest";
import { alertEffectivePrice } from "@/lib/alerts/dispatch";

// The "≈ X sau voucher" line of an alert email: the stored effective price must still describe the
// offer's current observation (spec 2026-09-28 §4, final review finding 1).
const NOW = new Date("2026-09-28T12:00:00Z");
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000).toISOString();

const event = (over: Partial<Parameters<typeof alertEffectivePrice>[0]> = {}) => ({
  price: 1_050_000,
  effective: { price: 950_000, at: hoursAgo(1), until: null },
  current: { price: 1_050_000, observedAt: hoursAgo(2) },
  ...over,
});

describe("alertEffectivePrice", () => {
  it("shown when computed from the current observation and still valid", () => {
    expect(alertEffectivePrice(event(), NOW)).toBe(950_000);
  });

  it("hidden when a newer observation came after the computation", () => {
    expect(alertEffectivePrice(event({ current: { price: 1_050_000, observedAt: hoursAgo(0.5) } }), NOW)).toBeNull();
  });

  it("hidden when the alert price is no longer the offer's current price, or it is unknown", () => {
    expect(alertEffectivePrice(event({ current: { price: 980_000, observedAt: hoursAgo(2) } }), NOW)).toBeNull();
    expect(alertEffectivePrice(event({ current: null }), NOW)).toBeNull();
  });

  it("hidden once a voucher of the combination expired", () => {
    expect(alertEffectivePrice(event({ effective: { price: 950_000, at: hoursAgo(1), until: hoursAgo(0.1) } }), NOW)).toBeNull();
  });
});

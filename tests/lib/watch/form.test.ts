import { describe, expect, it } from "vitest";
import { parseWatchForm, suggestTargetPrice } from "@/lib/watch/form";

const V = "0b6f1c2e-5a8d-4c1e-9f3a-2d7b8e6c4a10";

describe("parseWatchForm", () => {
  it("no condition → _form", () => {
    const r = parseWatchForm({ variantId: V });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors._form).toBeTruthy();
  });

  it("'1.250.000' → 1250000; channel=account → null", () => {
    const r = parseWatchForm({ variantId: V, targetPrice: "1.250.000", channel: "account" });
    expect(r).toEqual({
      ok: true,
      variantId: V,
      config: {
        targetPrice: 1250000,
        dropPct: null,
        notifyLow: false,
        minDealScore: null,
        notifyBackInStock: false,
        channels: null,
        notifyPriceHike: false,
      },
    });
  });

  it("notifyPriceHike=on alone is a valid condition", () => {
    const r = parseWatchForm({ variantId: V, notifyPriceHike: "on" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.config.notifyPriceHike).toBe(true);
  });

  it("repeated channel → subset", () => {
    const f = new FormData();
    f.set("variantId", V);
    f.set("notifyLow", "on");
    f.append("channel", "push");
    f.append("channel", "email");
    const r = parseWatchForm(f);
    expect(r.ok && r.config.channels).toEqual(["email", "push"]);
  });

  it.each([
    [{ dropPct: "0" }, "dropPct"],
    [{ dropPct: "91" }, "dropPct"],
    [{ minDealScore: "101" }, "minDealScore"],
    [{ targetPrice: "-5" }, "targetPrice"],
    [{ targetPrice: "abc" }, "targetPrice"],
  ])("%j → error %s", (extra, field) => {
    const r = parseWatchForm({ variantId: V, notifyLow: "on", ...extra });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors).toHaveProperty(field);
  });

  it("UUID sai → variantId", () => {
    const r = parseWatchForm({ variantId: "x", notifyLow: "on" });
    expect(!r.ok && r.errors.variantId).toBeTruthy();
  });

  it("unknown channel → channels", () => {
    const r = parseWatchForm({ variantId: V, notifyLow: "on", channel: "sms" });
    expect(!r.ok && r.errors.channels).toBeTruthy();
  });
});

describe("suggestTargetPrice", () => {
  it("price − 10%, rounded down to 1,000", () => {
    expect(suggestTargetPrice(1_234_567)).toBe(1_111_000);
    expect(suggestTargetPrice(null)).toBeNull();
  });
});

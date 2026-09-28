import { describe, expect, it } from "vitest";
import { formatTyping, parseVndInput } from "@/components/watch/price-input";

const ok = (value: number) => ({ ok: true, value });

describe("parseVndInput", () => {
  it("reads plain amounts with Vietnamese or Western thousands separators", () => {
    expect(parseVndInput("2.399.000")).toEqual(ok(2_399_000));
    expect(parseVndInput("2,399,000")).toEqual(ok(2_399_000));
    expect(parseVndInput("2 399 000")).toEqual(ok(2_399_000));
    expect(parseVndInput("2399000")).toEqual(ok(2_399_000));
    expect(parseVndInput("2.399.000đ")).toEqual(ok(2_399_000));
    expect(parseVndInput("2.399.000 ₫")).toEqual(ok(2_399_000));
    expect(parseVndInput("2399000 VND")).toEqual(ok(2_399_000));
  });

  it("reads shorthand millions the way people type them", () => {
    expect(parseVndInput("2tr4")).toEqual(ok(2_400_000));
    expect(parseVndInput("2tr45")).toEqual(ok(2_450_000));
    expect(parseVndInput("2tr450")).toEqual(ok(2_450_000));
    expect(parseVndInput("2,4 triệu")).toEqual(ok(2_400_000));
    expect(parseVndInput("2.4tr")).toEqual(ok(2_400_000));
    expect(parseVndInput("2 trieu")).toEqual(ok(2_000_000));
    expect(parseVndInput("15tr")).toEqual(ok(15_000_000));
    expect(parseVndInput("2m4")).toEqual(ok(2_400_000));
  });

  it("reads thousands and billions", () => {
    expect(parseVndInput("450k")).toEqual(ok(450_000));
    expect(parseVndInput("450 nghìn")).toEqual(ok(450_000));
    expect(parseVndInput("1k5")).toEqual(ok(1_500));
    expect(parseVndInput("1 tỷ 2")).toEqual(ok(1_200_000_000));
    expect(parseVndInput("1,2 tỉ")).toEqual(ok(1_200_000_000));
  });

  it("explains what is wrong instead of guessing", () => {
    expect(parseVndInput("")).toEqual({ ok: false, reason: "empty" });
    expect(parseVndInput("   ")).toEqual({ ok: false, reason: "empty" });
    expect(parseVndInput("0")).toEqual({ ok: false, reason: "zero" });
    expect(parseVndInput("-500000")).toEqual({ ok: false, reason: "negative" });
    expect(parseVndInput("abc")).toEqual({ ok: false, reason: "unreadable" });
    expect(parseVndInput("2,4")).toEqual({ ok: false, reason: "ambiguous" });
    expect(parseVndInput("2tr4tr")).toEqual({ ok: false, reason: "unreadable" });
  });
});

describe("formatTyping", () => {
  it("groups plain digits with dots while typing", () => {
    expect(formatTyping("2399000")).toBe("2.399.000");
    expect(formatTyping("2.3990")).toBe("23.990");
    expect(formatTyping("")).toBe("");
  });

  it("leaves shorthand alone so the user can keep typing it", () => {
    expect(formatTyping("2tr4")).toBe("2tr4");
    expect(formatTyping("2,4 triệu")).toBe("2,4 triệu");
  });
});

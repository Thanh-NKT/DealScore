import { describe, expect, it } from "vitest";
import { verdictNote } from "@/lib/pricing/verdict-copy";

describe("verdictNote", () => {
  it("no note without a score", () => {
    expect(verdictNote("insufficient_data", true, true)).toBeUndefined();
  });

  it("a flash-sale price is named in the verdict sentence", () => {
    expect(verdictNote("buy", false, true)).toMatch(/flash sale/);
    expect(verdictNote("buy", false, false)).not.toMatch(/flash sale/);
  });

  it("fake sale and flash sale are both said", () => {
    const note = verdictNote("wait", true, true)!;
    expect(note).toMatch(/chưa thực chất/);
    expect(note).toMatch(/flash sale/);
  });
});

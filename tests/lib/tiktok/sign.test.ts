import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { signTikTokRequest, tiktokCanonicalString } from "@/lib/tiktok/sign";

describe("tiktokCanonicalString (T2)", () => {
  it("secret + path + sorted key/value pairs (minus sign, access_token) + body + secret", () => {
    expect(
      tiktokCanonicalString({
        path: "/x/202405/y",
        query: { timestamp: "1700000000", app_key: "k", sign: "zzz", access_token: "t", page_size: "20" },
        body: '{"a":1}',
        secret: "S",
      }),
    ).toBe('S/x/202405/yapp_keykpage_size20timestamp1700000000{"a":1}S');
  });

  it("no body → nothing between params and trailing secret", () => {
    expect(tiktokCanonicalString({ path: "/p", query: { b: "2", a: "1" }, secret: "S" })).toBe("S/pa1b2S");
  });
});

describe("signTikTokRequest", () => {
  it("is hex HMAC-SHA256 of the canonical string keyed by the secret", () => {
    const input = { path: "/p", query: { a: "1" }, body: "{}", secret: "S" };
    const want = createHmac("sha256", "S").update("S/pa1{}S").digest("hex");
    expect(signTikTokRequest(input)).toBe(want);
  });
});

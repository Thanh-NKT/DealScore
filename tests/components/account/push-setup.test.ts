import { describe, expect, it } from "vitest";
import { keyBytes } from "@/components/account/push-setup";

describe("keyBytes", () => {
  it("decodes a base64url VAPID key without padding", () => {
    // "AQID_w" = bytes 01 02 03 ff (base64url, no "=" padding, "_" instead of "/")
    expect(Array.from(keyBytes("AQID_w"))).toEqual([1, 2, 3, 255]);
  });

  it("decodes '-' as the base64url form of '+'", () => {
    // "-w" → 0xfb in base64url ("+w" in plain base64)
    expect(Array.from(keyBytes("-w"))).toEqual([0xfb]);
  });

  it("returns a 65-byte uncompressed P-256 key for a real-length VAPID key", () => {
    const key = "BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U";
    const bytes = keyBytes(key);
    expect(bytes.length).toBe(65);
    expect(bytes[0]).toBe(0x04);
  });
});

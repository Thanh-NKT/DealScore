import { describe, expect, it } from "vitest";
import { hashNetwork, networkPrefix, rateKeyHash } from "@/lib/rate-limit";

describe("networkPrefix", () => {
  it("IPv4 → /24, with or without a port or an IPv4-mapped IPv6 prefix", () => {
    expect(networkPrefix("198.51.100.7")).toBe("198.51.100.0/24");
    expect(networkPrefix("198.51.100.7:4433")).toBe("198.51.100.0/24");
    expect(networkPrefix("::ffff:198.51.100.7")).toBe("198.51.100.0/24");
  });

  it("IPv6 → the first four groups (/64), whatever the notation", () => {
    const want = "2001:db8:1:2::/64";
    expect(networkPrefix("2001:db8:1:2::1")).toBe(want);
    expect(networkPrefix("2001:0DB8:0001:0002:ffff:1:2:3")).toBe(want);
    expect(networkPrefix("[2001:db8:1:2::5]:443")).toBe(want);
    expect(networkPrefix("2001:db8:1:2::1%eth0")).toBe(want);
    expect(networkPrefix("2001:db8::1")).toBe("2001:db8:0:0::/64");
    expect(networkPrefix("::1")).toBe("0:0:0:0::/64");
    expect(networkPrefix("64:ff9b::198.51.100.7")).toBe("64:ff9b:0:0::/64");
  });

  it("anything else is kept as is", () => {
    expect(networkPrefix("unknown")).toBe("unknown");
    expect(networkPrefix("999.1.1.1")).toBe("999.1.1.1");
    expect(networkPrefix("1:2:3")).toBe("1:2:3");
    expect(networkPrefix("1::2::3")).toBe("1::2::3");
  });
});

describe("hashNetwork", () => {
  it("is the same for two addresses of one /64 and differs across /64s; never contains the address", () => {
    expect(hashNetwork("2001:db8:1:2::1")).toBe(hashNetwork("2001:db8:1:2:dead:beef:0:1"));
    expect(hashNetwork("2001:db8:1:2::1")).not.toBe(hashNetwork("2001:db8:1:3::1"));
    expect(hashNetwork("198.51.100.7")).not.toContain("198.51");
  });
});

describe("rateKeyHash", () => {
  it("never throws, even in production without LOOKUP_IP_SALT", () => {
    const env = process.env as Record<string, string | undefined>;
    const saved = { salt: env.LOOKUP_IP_SALT, node: env.NODE_ENV };
    try {
      delete env.LOOKUP_IP_SALT;
      env.NODE_ENV = "production";
      expect(rateKeyHash("email:an@dealscore.vn")).toMatch(/^[0-9a-f]{64}$/);
    } finally {
      env.LOOKUP_IP_SALT = saved.salt;
      env.NODE_ENV = saved.node;
      if (saved.salt === undefined) delete env.LOOKUP_IP_SALT;
    }
  });
});

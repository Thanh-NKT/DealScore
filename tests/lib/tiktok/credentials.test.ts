import { describe, expect, it, vi } from "vitest";
import { getTikTokAccessToken, REFRESH_BACKOFF_MS, REFRESH_MARGIN_MS, type TokenStore } from "@/lib/tiktok/credentials";
import type { TikTokTokens } from "@/lib/tiktok/oauth";
import { MarketplaceUnavailableError } from "@/lib/marketplaces/types";

const now = new Date("2026-10-01T00:00:00Z");
const at = (ms: number) => new Date(now.getTime() + ms);
const tokens = (accessIn: number, refreshIn = 30 * 86_400_000, access = "A0"): TikTokTokens => ({
  accessToken: access,
  accessExpiresAt: at(accessIn),
  refreshToken: "R0",
  refreshExpiresAt: at(refreshIn),
});

function memoryStore(initial: TikTokTokens | null): TokenStore & { saved: TikTokTokens[] } {
  let current = initial;
  let lockedBy: string | null = null;
  const saved: TikTokTokens[] = [];
  return {
    saved,
    load: async () => current,
    save: async (t) => {
      current = t;
      saved.push(t);
    },
    tryLock: async (owner) => {
      if (lockedBy) return false;
      lockedBy = owner;
      return true;
    },
    unlock: async (owner) => {
      if (lockedBy === owner) lockedBy = null;
    },
  };
}

describe("getTikTokAccessToken", () => {
  it("not authorized → MarketplaceUnavailableError", async () => {
    const err = await getTikTokAccessToken(memoryStore(null), { now, refresh: vi.fn() }).catch((e) => e);
    expect(err).toBeInstanceOf(MarketplaceUnavailableError);
    expect(err.message).toContain("tiktok:authorize");
  });

  it("fresh token → returned without refresh", async () => {
    const refresh = vi.fn();
    expect(await getTikTokAccessToken(memoryStore(tokens(REFRESH_MARGIN_MS + 60_000)), { now, refresh })).toBe("A0");
    expect(refresh).not.toHaveBeenCalled();
  });

  it("< 24h left → refreshes and saves", async () => {
    const store = memoryStore(tokens(3_600_000));
    const refresh = vi.fn(async () => tokens(7 * 86_400_000, 60 * 86_400_000, "A1"));
    expect(await getTikTokAccessToken(store, { now, refresh })).toBe("A1");
    expect(refresh).toHaveBeenCalledWith("R0");
    expect(store.saved).toHaveLength(1);
  });

  it("refresh token expired → MarketplaceUnavailableError, no refresh attempt", async () => {
    const refresh = vi.fn();
    const err = await getTikTokAccessToken(memoryStore(tokens(-1, -1)), { now, refresh }).catch((e) => e);
    expect(err).toBeInstanceOf(MarketplaceUnavailableError);
    expect(refresh).not.toHaveBeenCalled();
  });

  it("two concurrent callers refresh exactly once", async () => {
    const store = memoryStore(tokens(3_600_000));
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const refresh = vi.fn(async () => {
      await gate;
      return tokens(7 * 86_400_000, 60 * 86_400_000, "A1");
    });
    // eslint-disable-next-line prefer-const -- assigned after `sleep` closes over it
    let firstDone!: Promise<string>;
    const sleep = vi.fn(async () => {
      release();
      await firstDone;
    });
    firstDone = getTikTokAccessToken(store, { now, refresh, sleep });
    const second = getTikTokAccessToken(store, { now, refresh, sleep });
    expect(await Promise.all([firstDone, second])).toEqual(["A1", "A1"]);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("refresh failure → MarketplaceUnavailableError, lock released", async () => {
    // Access token already expired, refresh token still valid.
    const store = memoryStore(tokens(-1));
    const refresh = vi.fn(async () => {
      throw new Error("boom");
    });
    await expect(getTikTokAccessToken(store, { now, refresh })).rejects.toBeInstanceOf(MarketplaceUnavailableError);
    expect(await store.tryLock("x")).toBe(true);
  });

  it("refresh fails but token still valid → returns current token", async () => {
    const store = memoryStore(tokens(3_600_000));
    const refresh = vi.fn(async () => {
      throw new Error("boom");
    });
    expect(await getTikTokAccessToken(store, { now, refresh })).toBe("A0");
    expect(await store.tryLock("x")).toBe(true);
  });

  it("after a failed refresh, later calls reuse the valid token without retrying until the backoff ends", async () => {
    const store = memoryStore(tokens(3_600_000));
    const refresh = vi.fn(async () => {
      throw new Error("boom");
    });
    const backoff = { failedAt: null };
    expect(await getTikTokAccessToken(store, { now, refresh, backoff })).toBe("A0");
    expect(await getTikTokAccessToken(store, { now: at(60_000), refresh, backoff })).toBe("A0");
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(await getTikTokAccessToken(store, { now: at(REFRESH_BACKOFF_MS + 1), refresh, backoff })).toBe("A0");
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it("save fails after a successful refresh → still returns the new token, logs no token", async () => {
    const store = memoryStore(tokens(3_600_000));
    store.save = async () => {
      throw new Error("db down");
    };
    const refresh = vi.fn(async () => tokens(7 * 86_400_000, 60 * 86_400_000, "A1"));
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(await getTikTokAccessToken(store, { now, refresh })).toBe("A1");
      expect(log).toHaveBeenCalled();
      const logged = JSON.stringify(log.mock.calls.map((c) => c.map(String)));
      expect(logged).toContain("db down");
      for (const secret of ["A0", "A1", "R0"]) expect(logged).not.toContain(secret);
      expect(await store.tryLock("x")).toBe(true);
    } finally {
      log.mockRestore();
    }
  });
});

import { afterAll, describe, expect, it } from "vitest";
import { supabaseTokenStore } from "@/lib/tiktok/credentials";
import { admin } from "./helpers";

afterAll(async () => {
  await admin.from("marketplace_credentials").delete().eq("marketplace", "tiktok");
  await admin.from("job_locks").delete().eq("name", "tiktok_token_refresh");
});

describe("supabaseTokenStore", () => {
  it("saves, loads and locks", async () => {
    const store = supabaseTokenStore(admin);
    const t = {
      accessToken: "A",
      accessExpiresAt: new Date("2026-10-08T00:00:00Z"),
      refreshToken: "R",
      refreshExpiresAt: new Date("2026-12-01T00:00:00Z"),
    };
    await store.save(t);
    expect(await store.load()).toEqual(t);
    expect(await store.tryLock("one")).toBe(true);
    expect(await store.tryLock("two")).toBe(false);
    await store.unlock("one");
    expect(await store.tryLock("two")).toBe(true);
    await store.unlock("two");
  });
});

import { afterAll, describe, expect, it } from "vitest";
import { consumeState, registerState, signState, verifyState } from "@/lib/tiktok/oauth";
import { admin } from "./helpers";

const names: string[] = [];
afterAll(async () => {
  if (names.length > 0) await admin.from("job_locks").delete().in("name", names);
});

describe("TikTok OAuth state nonce (job_locks)", () => {
  it("a registered state can be consumed once", async () => {
    const now = new Date();
    const state = signState("k", now);
    const nonce = verifyState("k", state, now)!;
    names.push(`tiktok-oauth:${nonce}`);
    await registerState(admin, state);
    expect(await consumeState(admin, nonce)).toBe(true);
    expect(await consumeState(admin, nonce)).toBe(false);
  });

  it("an unregistered nonce is refused", async () => {
    const nonce = verifyState("k", signState("k", new Date()), new Date())!;
    expect(await consumeState(admin, nonce)).toBe(false);
  });

  it("two concurrent callbacks with the same state: exactly one wins", async () => {
    const now = new Date();
    const state = signState("k", now);
    const nonce = verifyState("k", state, now)!;
    names.push(`tiktok-oauth:${nonce}`);
    await registerState(admin, state);
    const results = await Promise.all([consumeState(admin, nonce), consumeState(admin, nonce), consumeState(admin, nonce)]);
    expect(results.filter(Boolean)).toHaveLength(1);
  });
});

describe("prune_operational_data and OAuth nonces", () => {
  it("deletes used / long-expired nonces and keeps a live one", async () => {
    const used = `tiktok-oauth:prune-used-${Date.now()}`;
    const live = `tiktok-oauth:prune-live-${Date.now()}`;
    names.push(used, live);
    await admin.from("job_locks").insert([
      { name: used, owner: "oauth-state", locked_until: "-infinity" },
      { name: live, owner: "oauth-state", locked_until: new Date(Date.now() + 30 * 60_000).toISOString() },
    ]);
    const { data, error } = await admin.rpc("prune_operational_data");
    expect(error).toBeNull();
    expect((data as { oauth_nonces: number }).oauth_nonces).toBeGreaterThanOrEqual(1);
    const { data: left } = await admin.from("job_locks").select("name").in("name", [used, live]);
    expect(left).toEqual([{ name: live }]);
  });
});

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

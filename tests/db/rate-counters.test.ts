import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { admin } from "./helpers";

const keys: string[] = [];
const key = () => {
  const k = `test:${randomUUID()}`;
  keys.push(k);
  return k;
};
afterAll(async () => {
  await admin.from("rate_counters").delete().in("key", keys);
});

describe("rate_hit", () => {
  it("counts hits in a fixed window and refuses past the limit", async () => {
    const k = key();
    const hit = async () => (await admin.rpc("rate_hit", { p_key: k, p_window_seconds: 60, p_limit: 2 })).data;
    expect([await hit(), await hit(), await hit()]).toEqual([true, true, false]);
  });

  it("concurrent hits cannot all pass the last slot", async () => {
    const k = key();
    const results = await Promise.all(
      Array.from({ length: 10 }, async () => (await admin.rpc("rate_hit", { p_key: k, p_window_seconds: 60, p_limit: 3 })).data),
    );
    expect(results.filter((r) => r === true)).toHaveLength(3);
  });

  it("an expired window starts over", async () => {
    const k = key();
    await admin.rpc("rate_hit", { p_key: k, p_window_seconds: 60, p_limit: 1 });
    await admin.from("rate_counters").update({ expires_at: new Date(Date.now() - 1000).toISOString() }).eq("key", k);
    expect((await admin.rpc("rate_hit", { p_key: k, p_window_seconds: 60, p_limit: 1 })).data).toBe(true);
  });
});

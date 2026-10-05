import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { admin, createTestUser, deleteTestUser } from "./helpers";

const tag = `demand-${randomUUID().slice(0, 8)}`;

afterAll(async () => {
  await admin.from("sourcing_queries").delete().like("value", `${tag}%`);
});

describe("request_sourcing_query", () => {
  it("inserts once per marketplace, then counts repeats", async () => {
    const { data: n1 } = await admin.rpc("request_sourcing_query", { p_value: `${tag} a`, p_marketplaces: ["shopee", "tiktok"], p_daily_cap: 100 });
    expect(n1).toBe(2);
    const { data: n2 } = await admin.rpc("request_sourcing_query", { p_value: `${tag} a`, p_marketplaces: ["shopee", "tiktok"], p_daily_cap: 100 });
    expect(n2).toBe(0);
    const { data } = await admin.from("sourcing_queries").select("origin, request_count, kind").eq("value", `${tag} a`);
    expect(data).toHaveLength(2);
    for (const r of data!) expect(r).toMatchObject({ origin: "demand", request_count: 2, kind: "keyword" });
  });

  it("daily cap blocks new keywords but still counts existing ones", async () => {
    // Cap 0 = already full whatever other tests inserted today.
    const { data: blocked } = await admin.rpc("request_sourcing_query", { p_value: `${tag} b`, p_marketplaces: ["shopee"], p_daily_cap: 0 });
    expect(blocked).toBe(0);
    const { data: again } = await admin.rpc("request_sourcing_query", { p_value: `${tag} a`, p_marketplaces: ["shopee"], p_daily_cap: 0 });
    expect(again).toBe(0);
    const { data: row } = await admin.from("sourcing_queries").select("request_count").eq("value", `${tag} a`).eq("marketplace", "shopee").single();
    expect(row!.request_count).toBe(3);
  });

  it("does not reactivate a seed query an admin turned off", async () => {
    await admin.from("sourcing_queries").insert({ marketplace: "shopee", kind: "keyword", value: `${tag} seed`, active: false });
    await admin.rpc("request_sourcing_query", { p_value: `${tag} seed`, p_marketplaces: ["shopee"], p_daily_cap: 100 });
    const { data } = await admin.from("sourcing_queries").select("active, request_count").eq("value", `${tag} seed`).single();
    expect(data).toEqual({ active: false, request_count: 1 });
  });

  it("does not reactivate a demand keyword an admin turned off", async () => {
    await admin.rpc("request_sourcing_query", { p_value: `${tag} off`, p_marketplaces: ["shopee"], p_daily_cap: 100 });
    await admin.from("sourcing_queries").update({ active: false }).eq("value", `${tag} off`);
    await admin.rpc("request_sourcing_query", { p_value: `${tag} off`, p_marketplaces: ["shopee"], p_daily_cap: 100 });
    const { data } = await admin.from("sourcing_queries").select("active, request_count, origin").eq("value", `${tag} off`).single();
    expect(data).toEqual({ active: false, request_count: 2, origin: "demand" });
  });

  it("anon/authenticated cannot call it", async () => {
    const user = await createTestUser();
    try {
      const { error } = await user.client.rpc("request_sourcing_query", { p_value: `${tag} x`, p_marketplaces: ["shopee"], p_daily_cap: 100 });
      expect(error).not.toBeNull();
    } finally {
      await deleteTestUser(user.id);
    }
  });
});

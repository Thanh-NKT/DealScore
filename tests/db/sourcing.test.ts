import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it, vi } from "vitest";
import { runSourcing, supabaseSourcingDeps } from "@/lib/sourcing/run";
import { admin } from "./helpers";

const tag = randomUUID().slice(0, 8);

afterAll(async () => {
  const { data: seller } = await admin.from("sellers").select("id").eq("external_seller_id", "900000").maybeSingle();
  if (seller) await admin.from("listings").delete().eq("seller_id", seller.id);
  await admin.from("sourcing_queries").delete().eq("value", `test-${tag}`);
  await admin.from("sourcing_runs").delete().eq("marketplace", "shopee").gte("started_at", new Date(Date.now() - 3_600_000).toISOString());
  if (seller) await admin.from("sellers").delete().eq("id", seller.id);
  vi.unstubAllEnvs();
});

describe("sourcing on the fake Shopee source", () => {
  it("ingests new listings at priority 3, stores the cursor and the run", async () => {
    vi.stubEnv("SHOPEE_CLIENT", "fake");
    vi.stubEnv("NODE_ENV", "development");
    // Earlier runs today would count against the cap.
    await admin.from("sourcing_runs").delete().eq("marketplace", "shopee");
    await admin.from("sourcing_queries").update({ active: false }).eq("marketplace", "shopee");
    const { data: q } = await admin
      .from("sourcing_queries")
      .insert({ marketplace: "shopee", kind: "keyword", value: `test-${tag}` })
      .select("id")
      .single();
    try {
      const r = await runSourcing({ marketplace: "shopee", cap: 3 }, supabaseSourcingDeps(admin, "shopee"));
      expect(r).toMatchObject({ ingested: 3, queries: 1 });
      const { data: row } = await admin.from("sourcing_queries").select("next_page, last_run_at").eq("id", q!.id).single();
      expect(row!.next_page).toBe("2");
      expect(row!.last_run_at).not.toBeNull();
      const { data: seller } = await admin.from("sellers").select("id").eq("external_seller_id", "900000").single();
      const { data: listings } = await admin.from("listings").select("refresh_priority").eq("seller_id", seller!.id);
      expect(listings!.length).toBeGreaterThan(0);
      expect(listings!.every((l) => l.refresh_priority === 3)).toBe(true);
      // Cap already used today → the second run makes no call.
      expect(await runSourcing({ marketplace: "shopee", cap: 3 }, supabaseSourcingDeps(admin, "shopee"))).toEqual({ skipped: "cap_reached" });
    } finally {
      await admin.from("sourcing_queries").update({ active: true }).eq("marketplace", "shopee").neq("value", `test-${tag}`);
    }
  });
});

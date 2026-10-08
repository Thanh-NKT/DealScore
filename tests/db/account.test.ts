import { afterEach, describe, expect, it } from "vitest";
import { admin, createTestUser, deleteTestUser, type TestUser } from "./helpers";

const created: TestUser[] = [];
async function user() {
  const u = await createTestUser();
  created.push(u);
  return u;
}
afterEach(async () => {
  while (created.length) await deleteTestUser(created.pop()!.id);
});

describe("0005 — profile creation trigger", () => {
  it("creates users and notification_settings with default values", async () => {
    const u = await user();
    const { data } = await admin.from("notification_settings").select("*").eq("user_id", u.id).single();
    expect(data).toMatchObject({
      email_enabled: true,
      push_enabled: false,
      frequency: "instant",
      digest_hour: 8,
      quiet_start: null,
      quiet_end: null,
    });
  });
});

describe("0005 — RLS and column privileges", () => {
  it("user A cannot read user B's settings", async () => {
    const a = await user();
    const b = await user();
    const { data } = await a.client.from("notification_settings").select("*").eq("user_id", b.id);
    expect(data).toEqual([]);
  });

  it("a user cannot write their own consent_version", async () => {
    const u = await user();
    const { error } = await u.client.from("users").update({ consent_version: "gia-mao" }).eq("id", u.id);
    expect(error).not.toBeNull();
  });

  it("a user cannot clear their own deleted_at", async () => {
    const u = await user();
    await admin.from("users").update({ deleted_at: new Date().toISOString() }).eq("id", u.id);
    const { error } = await u.client.from("users").update({ deleted_at: null }).eq("id", u.id);
    expect(error).not.toBeNull();
  });

  it("a user can change their own marketing_opt_in", async () => {
    const u = await user();
    const { error } = await u.client.from("users").update({ marketing_opt_in: true }).eq("id", u.id);
    expect(error).toBeNull();
    const { data } = await admin.from("users").select("marketing_opt_in").eq("id", u.id).single();
    expect(data?.marketing_opt_in).toBe(true);
  });

  it("a user cannot insert into users / notification_settings", async () => {
    const u = await user();
    const r1 = await u.client.from("users").insert({ id: u.id, email: u.email });
    const r2 = await u.client.from("notification_settings").insert({ user_id: u.id });
    expect(r1.error).not.toBeNull();
    expect(r2.error).not.toBeNull();
  });

  it("a user can update their own settings", async () => {
    const u = await user();
    const { error } = await u.client
      .from("notification_settings")
      .update({ frequency: "daily_digest", quiet_start: 22, quiet_end: 7 })
      .eq("user_id", u.id);
    expect(error).toBeNull();
  });

  it("quiet hours need both ends and they must differ", async () => {
    const u = await user();
    const one = await u.client.from("notification_settings").update({ quiet_start: 22 }).eq("user_id", u.id);
    const same = await u.client
      .from("notification_settings")
      .update({ quiet_start: 5, quiet_end: 5 })
      .eq("user_id", u.id);
    expect(one.error).not.toBeNull();
    expect(same.error).not.toBeNull();
  });
});

describe("0005 — watches.channels", () => {
  it("rejects unknown channels", async () => {
    const u = await user();
    const { data: variant } = await admin.from("product_variants").select("id, product_id").order("id").limit(1).single();
    const { error } = await admin.from("watches").insert({
      user_id: u.id,
      product_id: variant!.product_id,
      variant_id: variant!.id,
      target_price: 1000,
      channels: ["sms"],
    });
    expect(error).not.toBeNull();
  });
});

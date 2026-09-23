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

describe("0005 — trigger tạo hồ sơ", () => {
  it("tạo users và notification_settings với giá trị mặc định", async () => {
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

describe("0005 — RLS và quyền cột", () => {
  it("user A không đọc được cài đặt của user B", async () => {
    const a = await user();
    const b = await user();
    const { data } = await a.client.from("notification_settings").select("*").eq("user_id", b.id);
    expect(data).toEqual([]);
  });

  it("user không tự ghi được consent_version", async () => {
    const u = await user();
    const { error } = await u.client.from("users").update({ consent_version: "gia-mao" }).eq("id", u.id);
    expect(error).not.toBeNull();
  });

  it("user không tự xóa được deleted_at", async () => {
    const u = await user();
    await admin.from("users").update({ deleted_at: new Date().toISOString() }).eq("id", u.id);
    const { error } = await u.client.from("users").update({ deleted_at: null }).eq("id", u.id);
    expect(error).not.toBeNull();
  });

  it("user tự đổi được marketing_opt_in", async () => {
    const u = await user();
    const { error } = await u.client.from("users").update({ marketing_opt_in: true }).eq("id", u.id);
    expect(error).toBeNull();
    const { data } = await admin.from("users").select("marketing_opt_in").eq("id", u.id).single();
    expect(data?.marketing_opt_in).toBe(true);
  });

  it("user không tự insert được vào users / notification_settings", async () => {
    const u = await user();
    const r1 = await u.client.from("users").insert({ id: u.id, email: u.email });
    const r2 = await u.client.from("notification_settings").insert({ user_id: u.id });
    expect(r1.error).not.toBeNull();
    expect(r2.error).not.toBeNull();
  });

  it("user tự cập nhật được cài đặt của mình", async () => {
    const u = await user();
    const { error } = await u.client
      .from("notification_settings")
      .update({ frequency: "daily_digest", quiet_start: 22, quiet_end: 7 })
      .eq("user_id", u.id);
    expect(error).toBeNull();
  });

  it("giờ im lặng phải có cả hai đầu và khác nhau", async () => {
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
  it("không nhận kênh lạ", async () => {
    const u = await user();
    const { data: variant } = await admin.from("product_variants").select("id, product_id").limit(1).single();
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

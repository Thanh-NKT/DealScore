import { randomBytes } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "@/lib/database.types";
import { admin, createTestUser, deleteTestUser, SUPABASE_URL, type TestUser } from "./helpers";

// Roadmap P4 J (0062): watch_folder_shares, shared_folder_view, admin share RPCs.
const anon = createClient<Database>(SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const created: TestUser[] = [];
afterAll(async () => {
  while (created.length) await deleteTestUser(created.pop()!.id);
});
const token = () => randomBytes(32).toString("base64url");
let variants: string[] = [];
beforeAll(async () => {
  const { data } = await admin.from("variant_current_price").select("variant_id").not("price", "is", null).limit(3);
  variants = (data ?? []).map((r) => r.variant_id);
});

async function sharedFolder(o: Record<string, unknown> = {}) {
  const u = await createTestUser();
  created.push(u);
  const { data: f } = await u.client.from("watch_folders").insert({ user_id: u.id, name: "Quà Tết" }).select("id").single();
  const statuses = ["active", "paused", "done"];
  for (const [i, v] of variants.entries()) {
    const { data: w } = await u.client.from("watches").insert({ variant_id: v, target_price: 123456 }).select("id").single();
    const { error } = await admin
      .from("watches")
      .update({ folder_id: f!.id, note: "riêng tư 0912345678", status: statuses[i] })
      .eq("id", w!.id);
    if (error) throw error;
  }
  const t = token();
  const { data: s, error } = await admin
    .from("watch_folder_shares")
    .insert({ folder_id: f!.id, user_id: u.id, token: t, ...o })
    .select("id")
    .single();
  if (error) throw error;
  return { u, folderId: f!.id, token: t, shareId: s!.id };
}

function keysDeep(v: unknown, out = new Set<string>()): Set<string> {
  if (Array.isArray(v)) v.forEach((x) => keysDeep(x, out));
  else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) (out.add(k), keysDeep(x, out));
  return out;
}

describe("shared_folder_view", () => {
  it("anon gets the list without any account data (deep scan)", async () => {
    const { token: t, u } = await sharedFolder();
    const { data, error } = await anon.rpc("shared_folder_view", { p_token: t });
    expect(error).toBeNull();
    const keys = keysDeep(data);
    for (const k of ["email", "user_id", "watch_id", "folder_id", "id", "channels", "token", "cond_state"]) expect(keys.has(k)).toBe(false);
    expect(JSON.stringify(data)).not.toContain(u.email);
    expect(JSON.stringify(data)).not.toContain(u.id);
    // include_done = false: active + paused only; notes off by default
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const items = (data as any).items as Array<Record<string, unknown>>;
    expect(items.map((i) => i.status).sort()).toEqual(["active", "paused"].slice(0, Math.min(2, variants.length)).sort());
    expect(items.every((i) => i.note === null && i.target_price === null)).toBe(true);
  });

  it("show_prices = false → every price / score null; include_done shows done; notes when enabled", async () => {
    const { token: t } = await sharedFolder({ show_prices: false, include_done: true, show_notes: true, show_target: true });
    const { data } = await anon.rpc("shared_folder_view", { p_token: t });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const items = (data as any).items as Array<Record<string, unknown>>;
    expect(items).toHaveLength(variants.length);
    expect(items.every((i) => i.price === null && i.score === null && i.recommendation === null && i.observed_at === null)).toBe(true);
    expect(items.every((i) => i.note === "riêng tư 0912345678" && Number(i.target_price) === 123456)).toBe(true);
  });

  it("revoked / rotated old token → null; owner pending deletion → null; bad format → null", async () => {
    const { token: t, folderId, u } = await sharedFolder();
    const t2 = token();
    await admin.from("watch_folder_shares").update({ token: t2 }).eq("folder_id", folderId);
    expect((await anon.rpc("shared_folder_view", { p_token: t })).data).toBeNull();
    expect((await anon.rpc("shared_folder_view", { p_token: t2 })).data).not.toBeNull();
    await admin.from("users").update({ deleted_at: new Date().toISOString() }).eq("id", u.id);
    expect((await anon.rpc("shared_folder_view", { p_token: t2 })).data).toBeNull();
    await admin.from("users").update({ deleted_at: null }).eq("id", u.id);
    await u.client.from("watch_folder_shares").delete().eq("folder_id", folderId);
    expect((await anon.rpc("shared_folder_view", { p_token: t2 })).data).toBeNull();
    expect((await anon.rpc("shared_folder_view", { p_token: "short" })).data).toBeNull();
  });
});

describe("watch_folder_shares privileges", () => {
  it("authenticated cannot insert a share or update its token; another user cannot read or edit", async () => {
    const { u, folderId, token: t } = await sharedFolder();
    const ins = await u.client.from("watch_folder_shares").insert({ folder_id: folderId, user_id: u.id, token: token() });
    expect(ins.error?.code).toBe("42501");
    const tok = await u.client.from("watch_folder_shares").update({ token: token() } as never).eq("folder_id", folderId);
    expect(tok.error?.code).toBe("42501");
    const ok = await u.client.from("watch_folder_shares").update({ title: "Mới" }).eq("folder_id", folderId);
    expect(ok.error).toBeNull();
    const other = await createTestUser();
    created.push(other);
    expect((await other.client.from("watch_folder_shares").select("id").eq("folder_id", folderId)).data).toEqual([]);
    await other.client.from("watch_folder_shares").update({ title: "hack" }).eq("folder_id", folderId);
    const { data } = await admin.from("watch_folder_shares").select("title, token").eq("folder_id", folderId).single();
    expect(data).toEqual({ title: "Mới", token: t });
  });

  it("a share must point at the owner's folder; folder delete cascades", async () => {
    const { u, folderId } = await sharedFolder();
    const other = await createTestUser();
    created.push(other);
    const wrong = await admin.from("watch_folder_shares").insert({ folder_id: folderId, user_id: other.id, token: token() });
    expect(wrong.error).not.toBeNull();
    await u.client.from("watch_folders").delete().eq("id", folderId);
    expect((await admin.from("watch_folder_shares").select("id").eq("folder_id", folderId)).data).toEqual([]);
  });
});

describe("admin share RPCs", () => {
  it("lists without owner identity, revokes with an admin_audit row, second revoke → revoked false", async () => {
    const title = `Kiểm duyệt ${Math.random().toString(36).slice(2, 8)}`;
    const { shareId, token: t } = await sharedFolder({ title, display_name: "Bé Na" });
    const { data: rows, error } = await admin.rpc("admin_folder_shares", { p_q: title.slice(-6) });
    expect(error).toBeNull();
    expect(rows).toHaveLength(1);
    expect(Object.keys(rows![0]).sort()).toEqual(
      ["created_at", "display_name", "folder_name", "item_count", "owner_pending_deletion", "share_id", "title", "total_count", "updated_at"].sort(),
    );
    expect(rows![0]).toMatchObject({ share_id: shareId, title, display_name: "Bé Na", folder_name: "Quà Tết", owner_pending_deletion: false });
    const r1 = await admin.rpc("admin_revoke_folder_share", { p_share_id: shareId, p_note: "spam" });
    expect(r1.data).toEqual({ revoked: true });
    const { data: audit } = await admin.from("admin_audit").select("action, before, note").eq("entity_id", shareId);
    expect(audit).toHaveLength(1);
    expect(audit![0]).toMatchObject({ action: "folder_share.revoke", note: "spam" });
    expect((audit![0].before as Record<string, unknown>).title).toBe(title);
    expect((await anon.rpc("shared_folder_view", { p_token: t })).data).toBeNull();
    const r2 = await admin.rpc("admin_revoke_folder_share", { p_share_id: shareId });
    expect(r2.data).toEqual({ revoked: false });
    expect((await admin.from("admin_audit").select("id").eq("entity_id", shareId)).data).toHaveLength(1);
    expect((await admin.rpc("admin_folder_shares", { p_q: "x".repeat(101) })).error?.message).toContain("admin_folder_shares");
  });
});

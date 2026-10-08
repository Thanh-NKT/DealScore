import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "@/lib/database.types";
import { toVnDate } from "@/lib/format";
import { admin, createTestUser, deleteTestUser, SUPABASE_URL, type TestUser } from "./helpers";

// Migration 0053: admin user KPIs + weekly retention cohorts (roadmap P3 item 14). Other users exist in the
// local DB, so every check compares a "before" and an "after" snapshot (DB test files run serially).
const tag = `us${randomUUID().replace(/-/g, "").slice(0, 8)}`;
const users: TestUser[] = [];
let productId: string;
let variantId: string;
const DAY = 86_400_000;

type Kpis = Record<string, number>;
type CohortRow = { cohort_week: string; segment: string; cohort_size: number; week_offset: number; active_users: number; complete: boolean };

const kpis = async () => {
  const { data, error } = await admin.rpc("admin_user_kpis");
  if (error) throw error;
  return data as Kpis;
};
const cohorts = async (weeks = 8, maxOffset = 4) => {
  const { data, error } = await admin.rpc("admin_retention_cohorts", { p_weeks: weeks, p_max_offset: maxOffset });
  if (error) throw error;
  return (data ?? []) as CohortRow[];
};
const cell = (rows: CohortRow[], week: string, segment: string, k: number) =>
  rows.find((r) => r.cohort_week === week && r.segment === segment && r.week_offset === k);

/** Monday (VN calendar) of the week containing `date` (YYYY-MM-DD). */
function mondayOf(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  const dow = (d.getUTCDay() + 6) % 7; // Monday = 0
  return new Date(d.getTime() - dow * DAY).toISOString().slice(0, 10);
}
const addDays = (date: string, n: number) => new Date(Date.parse(`${date}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
const vn = (date: string, hhmm: string) => new Date(`${date}T${hhmm}:00+07:00`).toISOString();

const today = toVnDate(new Date());
const W = mondayOf(addDays(today, -21)); // a cohort week with T0–T2 complete and T3 running
const CUR = mondayOf(today);

let before: { kpis: Kpis; cohorts: CohortRow[] };
let u1: TestUser; // signs up Sunday 23:00 VN (still week W), active Monday of W+1 → T1; watch on day 8 → without_watch
let u2: TestUser; // signs up Monday of W, watch on day 2 → with_watch, click in W+2 → T2
let u3: TestUser; // pending deletion: never counted
let u4: TestUser; // new this week, active today in both sources

async function user(createdAt: string) {
  const u = await createTestUser();
  users.push(u);
  await admin.from("users").update({ created_at: createdAt }).eq("id", u.id);
  return u;
}
async function event(userId: string, name: string, at: string) {
  const { error } = await admin.from("analytics_events").insert({ user_id: userId, name, created_at: at });
  if (error) throw error;
}
async function watch(userId: string, createdAt: string, channels = ["email"]) {
  const { data, error } = await admin.from("watches")
    .insert({ user_id: userId, variant_id: variantId, target_price: 1, channels }).select("id").single();
  if (error) throw error;
  await admin.from("watches").update({ created_at: createdAt }).eq("id", data.id);
}

beforeAll(async () => {
  const { data: p } = await admin.from("products").insert({ canonical_name: `U ${tag}`, status: "verified", slug: `test-${tag}` }).select("id").single();
  productId = p!.id;
  const { data: v } = await admin.from("product_variants").insert({ product_id: productId, variant_key: "A" }).select("id").single();
  variantId = v!.id;

  before = { kpis: await kpis(), cohorts: await cohorts() };

  const u1At = vn(addDays(W, 6), "23:00");
  u1 = await user(u1At);
  await event(u1.id, "signup_completed", u1At);
  await event(u1.id, "product_viewed", vn(addDays(W, 7), "00:30"));
  await watch(u1.id, new Date(Date.parse(u1At) + 8 * DAY).toISOString());

  const u2At = vn(W, "10:00");
  u2 = await user(u2At);
  await event(u2.id, "signup_completed", u2At);
  await watch(u2.id, new Date(Date.parse(u2At) + 2 * DAY).toISOString());
  const { error: cErr } = await admin.from("click_events").insert({ user_id: u2.id, source: "web", created_at: vn(addDays(W, 14), "00:05") });
  if (cErr) throw cErr;

  u3 = await user(vn(W, "11:00"));
  await event(u3.id, "signup_completed", vn(W, "11:00"));
  await event(u3.id, "product_viewed", new Date().toISOString());
  await admin.from("users").update({ deleted_at: new Date().toISOString() }).eq("id", u3.id);

  u4 = await createTestUser();
  users.push(u4);
  await event(u4.id, "signup_completed", new Date().toISOString());
  await admin.from("click_events").insert({ user_id: u4.id, source: "web" });
  await watch(u4.id, new Date().toISOString(), ["email", "push"]);
  await admin.from("push_subscriptions").insert({ user_id: u4.id, endpoint: `https://push.test/${tag}`, p256dh: "k", auth: "a" });
});

afterAll(async () => {
  await admin.from("click_events").delete().in("user_id", users.map((u) => u.id));
  for (const u of users) await deleteTestUser(u.id);
  await admin.from("products").delete().eq("id", productId);
});

describe("admin_user_kpis", () => {
  it("counts users, activity across analytics_events and click_events (distinct), watches, push; excludes pending deletion", async () => {
    const after = await kpis();
    const d = (k: string) => after[k] - before.kpis[k];
    expect(Object.keys(after).sort()).toEqual([
      "active_30d", "active_7d", "active_watches", "alerts_sent_7d", "new_30d", "new_7d", "pending_deletion",
      "push_subscribers", "total_users", "watches_email", "watches_push", "watching_users",
    ]);
    expect(d("total_users")).toBe(3);
    expect(d("pending_deletion")).toBe(1);
    expect(d("new_7d")).toBe(1);
    expect(d("new_30d")).toBe(1 + (Date.parse(vn(addDays(W, 6), "23:00")) > Date.now() - 30 * DAY ? 1 : 0) + (Date.parse(vn(W, "10:00")) > Date.now() - 30 * DAY ? 1 : 0));
    expect(d("active_7d")).toBe(1); // u4 in both sources counts once; u3 is pending deletion
    expect(d("active_watches")).toBe(3);
    expect(d("watching_users")).toBe(3);
    expect(d("watches_email")).toBe(3);
    expect(d("watches_push")).toBe(1);
    expect(d("push_subscribers")).toBe(1);
    expect(d("alerts_sent_7d")).toBe(0);
  });
});

describe("admin_retention_cohorts", () => {
  it("VN calendar weeks: Sunday 23:00 VN belongs to its week; T0 / T1 / T2 by calendar week", async () => {
    const after = await cohorts();
    const delta = (segment: string, k: number, field: "cohort_size" | "active_users") =>
      (cell(after, W, segment, k)?.[field] ?? 0) - (cell(before.cohorts, W, segment, k)?.[field] ?? 0);
    expect(delta("all", 0, "cohort_size")).toBe(2);
    expect(delta("all", 0, "active_users")).toBe(2);
    expect(delta("all", 1, "active_users")).toBe(1);
    expect(delta("all", 2, "active_users")).toBe(1);
    expect(delta("all", 3, "active_users")).toBe(0);
    expect(delta("with_watch", 0, "cohort_size")).toBe(1);
    expect(delta("with_watch", 2, "active_users")).toBe(1);
    expect(delta("with_watch", 1, "active_users")).toBe(0);
    expect(delta("without_watch", 0, "cohort_size")).toBe(1);
    expect(delta("without_watch", 1, "active_users")).toBe(1);
  });

  it("only started weeks have rows; the running week is incomplete", async () => {
    const after = await cohorts();
    const ws = after.filter((r) => r.cohort_week === W && r.segment === "all").sort((a, b) => a.week_offset - b.week_offset);
    expect(ws.map((r) => r.week_offset)).toEqual([0, 1, 2, 3]);
    expect(ws.map((r) => r.complete)).toEqual([true, true, true, false]);
    const cur = after.filter((r) => r.cohort_week === CUR && r.segment === "all");
    expect(cur.map((r) => [r.week_offset, r.complete])).toEqual([[0, false]]);
    expect(after.every((r) => r.cohort_week >= addDays(CUR, -7 * 7) && r.cohort_size > 0)).toBe(true);
    expect(after.every((r) => !("user_id" in r))).toBe(true);
  });

  it("clamps the window", async () => {
    const one = await cohorts(1, 1);
    expect(new Set(one.map((r) => r.cohort_week))).toEqual(new Set([CUR]));
  });

  it("anon / authenticated cannot call the user RPCs", async () => {
    const anon = createClient<Database>(SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    for (const c of [anon, u4.client]) {
      expect((await c.rpc("admin_user_kpis")).error?.code).toBe("42501");
      expect((await c.rpc("admin_retention_cohorts", {})).error?.code).toBe("42501");
    }
  });
});

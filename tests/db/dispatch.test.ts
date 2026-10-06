import { afterEach, describe, expect, it, vi } from "vitest";
import type { EmailMessage } from "@/lib/email";
import { admin, createTestUser, deleteTestUser, type TestUser } from "./helpers";

const sentMessages: EmailMessage[] = [];
/** Resend error code the next send fails with (once). */
let nextSendErrorCode: string | null = null;
vi.mock("@/lib/email", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/email")>();
  return {
    ...actual,
    sendEmail: async (msg: EmailMessage) => {
      sentMessages.push(msg);
      if (nextSendErrorCode) {
        const code = nextSendErrorCode;
        nextSendErrorCode = null;
        throw new actual.EmailSendError("same key, other body", code);
      }
      return actual.sendEmail(msg);
    },
  };
});
const reportError = vi.fn();
vi.mock("@/lib/observability", () => ({ reportError: (...a: unknown[]) => reportError(...a) }));

const { evaluateWatches } = await import("@/lib/alerts/evaluate");
const { dispatchDueDeliveries, deliveryIdempotencyKey } = await import("@/lib/alerts/dispatch");

const created: TestUser[] = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  sentMessages.length = 0;
  reportError.mockClear();
  while (created.length) await deleteTestUser(created.pop()!.id);
});

async function userWithAlert() {
  const u = await createTestUser();
  created.push(u);
  const { data: v } = await admin
    .from("variant_current_price")
    .select("variant_id, price")
    .eq("in_stock", true)
    .not("price", "is", null)
    .limit(1)
    .single();
  await admin.from("variant_current_price").update({ observed_at: new Date().toISOString() }).eq("variant_id", v!.variant_id);
  await u.client.from("watches").insert({ variant_id: v!.variant_id, target_price: Number(v!.price) + 1000 });
  await evaluateWatches({ now: new Date(), variantIds: [v!.variant_id] }, admin);
  return u;
}

async function statusesOf(userId: string) {
  const { data } = await admin
    .from("alert_deliveries")
    .select("status, skip_reason, alert_events!inner(watches!inner(user_id))")
    .eq("alert_events.watches.user_id", userId);
  return (data ?? []).map((r) => [r.status, r.skip_reason]);
}

describe("dispatchDueDeliveries (email)", () => {
  it("sends in console mode → sent", async () => {
    vi.stubEnv("RESEND_API_KEY", "");
    vi.stubEnv("UNSUBSCRIBE_SECRET", "test-secret");
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    const u = await userWithAlert();
    await dispatchDueDeliveries({ now: new Date() }, admin);
    expect(await statusesOf(u.id)).toEqual([["sent", null]]);
  });

  it("Watch paused before sending → skipped/watch_inactive", async () => {
    vi.stubEnv("UNSUBSCRIBE_SECRET", "test-secret");
    const u = await userWithAlert();
    await admin.from("watches").update({ status: "paused" }).eq("user_id", u.id);
    await dispatchDueDeliveries({ now: new Date() }, admin);
    expect(await statusesOf(u.id)).toEqual([["skipped", "watch_inactive"]]);
  });
});

async function deliveriesOf(userId: string) {
  const { data } = await admin
    .from("alert_deliveries")
    .select("id, status, attempts, claimed_at, alert_events!inner(watches!inner(user_id))")
    .eq("alert_events.watches.user_id", userId);
  return data ?? [];
}

/** The admin client, except that marking alert_deliveries 'sent' fails (DB blip after the send). */
function clientFailingMarkSent() {
  return new Proxy(admin, {
    get(target, key, receiver) {
      if (key !== "from") return Reflect.get(target, key, receiver);
      return (table: string) => {
        const builder = target.from(table as "alert_deliveries");
        if (table !== "alert_deliveries") return builder;
        return new Proxy(builder, {
          get(b, k, r) {
            if (k !== "update") return Reflect.get(b, k, r);
            return (patch: { status?: string }) =>
              patch.status === "sent"
                ? { in: async () => ({ data: null, error: { message: "connection reset" } }) }
                : b.update(patch as never);
          },
        });
      };
    },
  }) as typeof admin;
}

describe("dispatchDueDeliveries: send, then bookkeeping (at-least-once)", () => {
  it("a failed 'sent' update after a successful send is reported, never re-queued as pending", async () => {
    vi.stubEnv("RESEND_API_KEY", "");
    vi.stubEnv("UNSUBSCRIBE_SECRET", "test-secret");
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    const u = await userWithAlert();
    const [before] = await deliveriesOf(u.id);

    const stats = await dispatchDueDeliveries({ now: new Date() }, clientFailingMarkSent());
    expect(stats).toMatchObject({ sent: 1, retried: 0, failed: 0 });
    expect(sentMessages).toHaveLength(1);
    expect(sentMessages[0].idempotencyKey).toBe(deliveryIdempotencyKey([before.id]));
    expect(reportError).toHaveBeenCalledWith(expect.any(Error), expect.objectContaining({ where: "alert_dispatch_mark_sent" }));
    // Still 'sending' (not 'pending'): an immediate next run does not send it again.
    const [row] = await deliveriesOf(u.id);
    expect(row.status).toBe("sending");
    await dispatchDueDeliveries({ now: new Date() }, admin);
    expect(sentMessages).toHaveLength(1);
  });

  it("a stale 'sending' row is reclaimed with an attempt counted, with the same idempotency key", async () => {
    vi.stubEnv("RESEND_API_KEY", "");
    vi.stubEnv("UNSUBSCRIBE_SECRET", "test-secret");
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    const u = await userWithAlert();
    const [d] = await deliveriesOf(u.id);
    const stale = new Date(Date.now() - 16 * 60_000).toISOString();
    await admin.from("alert_deliveries").update({ status: "sending", claimed_at: stale, attempts: 0 }).eq("id", d.id);

    const { data: claimed } = await admin.rpc("claim_due_deliveries", { p_now: new Date().toISOString(), p_limit: 999 });
    const mine = (claimed ?? []).find((c) => c.delivery_id === d.id);
    expect(mine?.attempts).toBe(1);
    // Released again for the dispatcher run below.
    await admin.from("alert_deliveries").update({ status: "sending", claimed_at: stale }).eq("id", d.id);
    await dispatchDueDeliveries({ now: new Date() }, admin);
    const [row] = await deliveriesOf(u.id);
    expect(row).toMatchObject({ status: "sent", attempts: 3 });
    expect(sentMessages.at(-1)?.idempotencyKey).toBe(deliveryIdempotencyKey([d.id]));
  });

  it("a stale 'sending' row out of attempts becomes failed instead of being sent again", async () => {
    vi.stubEnv("UNSUBSCRIBE_SECRET", "test-secret");
    const u = await userWithAlert();
    const [d] = await deliveriesOf(u.id);
    const stale = new Date(Date.now() - 16 * 60_000).toISOString();
    await admin.from("alert_deliveries").update({ status: "sending", claimed_at: stale, attempts: 2 }).eq("id", d.id);

    await dispatchDueDeliveries({ now: new Date() }, admin);
    const [row] = await deliveriesOf(u.id);
    expect(row).toMatchObject({ status: "failed", attempts: 3 });
    expect(sentMessages).toHaveLength(0);
  });
});

describe("dispatchDueDeliveries: invalid_idempotent_request", () => {
  it("is not taken as proof of delivery: the delivery fails (no retry) and it is reported", async () => {
    vi.stubEnv("RESEND_API_KEY", "");
    vi.stubEnv("UNSUBSCRIBE_SECRET", "test-secret");
    const u = await userWithAlert();
    nextSendErrorCode = "invalid_idempotent_request";
    const stats = await dispatchDueDeliveries({ now: new Date() }, admin);
    expect(stats).toMatchObject({ sent: 0, failed: 1, retried: 0 });
    const [row] = await deliveriesOf(u.id);
    expect(row).toMatchObject({ status: "failed", attempts: 1 });
    expect(reportError).toHaveBeenCalledWith(expect.any(Error), expect.objectContaining({ where: "alert_dispatch_non_retryable" }));
  });
});

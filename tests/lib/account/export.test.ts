import { describe, expect, it } from "vitest";
import { buildAccountExport, exportFileName } from "@/lib/account/export";

const input = {
  exportedAt: new Date("2026-09-23T20:00:00Z"),
  profile: {
    id: "u1",
    email: "an@kairo.vn",
    auth_provider: "email",
    created_at: "2026-09-01T00:00:00Z",
    marketing_opt_in: false,
    consent_version: "2026-09-23",
    consent_at: "2026-09-01T00:00:00Z",
    deleted_at: null,
  },
  settings: {
    user_id: "u1",
    email_enabled: true,
    push_enabled: false,
    frequency: "instant",
    digest_hour: 8,
    quiet_start: null,
    quiet_end: null,
    updated_at: "2026-09-01T00:00:00Z",
  },
  watches: [
    {
      id: "w1",
      user_id: "u1",
      product_id: "p1",
      variant_id: "v1",
      target_price: 1000,
      drop_pct: 10,
      notify_low: true,
      min_deal_score: null,
      notify_back_in_stock: false,
      channels: null,
      folder: null,
      note: "birthday gift",
      status: "active",
      created_at: "2026-09-02T00:00:00Z",
      baseline_price: 1200,
      cond_state: { target_price: true },
      last_alert_price: null,
      last_alerted_at: "2026-09-05T00:00:00Z",
      last_in_stock: true,
      last_evaluated_at: null,
      config_version: 1,
      updated_at: "2026-09-02T00:00:00Z",
      future_column: "must not leak",
    },
  ],
  alertEvents: [
    {
      watch_id: "w1",
      trigger_types: ["target_price"],
      price: 950,
      deal_score: 80,
      created_at: "2026-09-05T00:00:00Z",
      alert_deliveries: [
        { channel: "email", status: "sent", sent_at: "2026-09-05T00:01:00Z", provider_message_id: "x" },
      ],
    },
  ],
  pushDevices: [
    { created_at: "2026-09-06T00:00:00Z", user_agent: "Chrome", endpoint: "https://secret", p256dh: "k", auth: "a" },
  ],
  clicks: [
    {
      id: "c1",
      user_id: "u1",
      offer_id: "o1",
      source: "web",
      watch_id: null,
      alert_event_id: null,
      created_at: "2026-09-03T00:00:00Z",
      session_id: "s",
    },
  ],
  lookups: [{ created_at: "2026-09-04T00:00:00Z", outcome: "resolved", ip_hash: "KHONG-DUOC-XUAT" }],
  orders: [
    { purchase_time: "2026-09-10T00:00:00Z", status: "completed", order_value: 500000, item_id: "111", commission: 25000, raw: { x: 1 } },
  ],
};

describe("buildAccountExport", () => {
  const out = buildAccountExport(input as never);

  it("has schema_version and exported_at", () => {
    expect(out.schema_version).toBe(1);
    expect(out.exported_at).toBe("2026-09-23T20:00:00.000Z");
  });
  it("explicit column selection — unknown columns and engine state don't leak", () => {
    const s = JSON.stringify(out);
    expect(s).not.toContain("future_column");
    expect(out.watches[0]).not.toHaveProperty("cond_state");
    expect(out.watches[0]).not.toHaveProperty("config_version");
  });
  it("watch has the new condition columns and the user's note", () => {
    expect(out.watches[0]).toMatchObject({ drop_pct: 10, notify_low: true, baseline_price: 1200, note: "birthday gift" });
  });
  it("no ip_hash, session_id, provider_message_id", () => {
    const s = JSON.stringify(out);
    expect(s).not.toContain("KHONG-DUOC-XUAT");
    expect(s).not.toContain("session_id");
    expect(s).not.toContain("provider_message_id");
  });
  it("alerts include deliveries", () => {
    expect(out.alert_events[0].deliveries).toEqual([{ channel: "email", status: "sent", sent_at: "2026-09-05T00:01:00Z" }]);
  });
  it("push has only created_at + user_agent — no endpoint, no keys", () => {
    expect(out.push_devices).toEqual([{ created_at: "2026-09-06T00:00:00Z", user_agent: "Chrome" }]);
    expect(JSON.stringify(out)).not.toContain("https://secret");
  });
  it("orders: timestamp, status, value — NO commission or raw", () => {
    expect(out.orders).toEqual([
      { purchase_time: "2026-09-10T00:00:00Z", status: "completed", order_value: 500000, product_item_id: "111" },
    ]);
    expect(JSON.stringify(out.orders)).not.toContain("25000");
  });
  it("settings in NotificationSettings shape", () => {
    expect(out.notification_settings).toMatchObject({ emailEnabled: true, frequency: "instant" });
  });
});

describe("exportFileName", () => {
  it("dated in Vietnam time", () => {
    // 20:00Z on the 23rd = 03:00 Vietnam time on the 24th
    expect(exportFileName(new Date("2026-09-23T20:00:00Z"))).toBe("kairo-du-lieu-2026-09-24.json");
  });
});

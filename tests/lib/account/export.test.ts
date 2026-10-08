import { describe, expect, it } from "vitest";
import { buildAccountExport, exportFileName } from "@/lib/account/export";

const input = {
  exportedAt: new Date("2026-09-23T20:00:00Z"),
  profile: {
    id: "u1",
    email: "an@dealscore.vn",
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
      folder_id: "f1",
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
  folders: [{ id: "f1", user_id: "u1", name: "Quà tặng", sort_order: 0, created_at: "2026-09-02T00:00:00Z" }],
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
  preferences: {
    user_id: "u1",
    brands: ["Samsung"],
    excluded_brands: [],
    category_ids: ["11111111-1111-4111-8111-111111111111"],
    min_price: 100000,
    max_price: 3000000,
    marketplaces: ["shopee"],
    updated_at: "2026-09-12T00:00:00Z",
  },
  activity: [
    { created_at: "2026-09-11T00:00:00Z", name: "product_viewed", props: { is_draft: false }, session_id: "s", id: 7 },
  ],
  extensionObservations: [
    {
      id: 9, offer_id: "o1", contributor: "u:u1", user_id: "u1", observed_at: "2026-09-13T00:00:00Z", price: 990000,
      original_price: 1200000, stock: 4, free_shipping: true, has_voucher: null, promoted_at: "2026-09-13T01:00:00Z",
      created_at: "2026-09-13T00:00:05Z",
    },
  ],
  extensionContributions: [{ id: 3, contributor: "u:u1", user_id: "u1", created_at: "2026-09-13T00:00:05Z" }],
};

describe("buildAccountExport", () => {
  const out = buildAccountExport(input as never);

  it("exports the user's named folders and each watch's folder_id, no user id", () => {
    expect(out.folders).toEqual([{ id: "f1", name: "Quà tặng", sort_order: 0, created_at: "2026-09-02T00:00:00Z" }]);
    expect(out.watches[0].folder_id).toBe("f1");
    expect(JSON.stringify(out.folders)).not.toContain("u1");
  });

  it("exports analytics activity without internal ids or session ids", () => {
    expect(out.activity).toEqual([
      { created_at: "2026-09-11T00:00:00Z", event: "product_viewed", props: { is_draft: false } },
    ]);
  });
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
  it("shopping preferences with their updated_at, no user id", () => {
    expect(out.preferences).toEqual({
      brands: ["Samsung"],
      excluded_brands: [],
      category_ids: ["11111111-1111-4111-8111-111111111111"],
      min_price: 100000,
      max_price: 3000000,
      marketplaces: ["shopee"],
      updated_at: "2026-09-12T00:00:00Z",
    });
  });
  it("no preferences row → null", () => {
    expect(buildAccountExport({ ...input, preferences: null } as never).preferences).toBeNull();
  });
  it("extension contributions: the prices the user sent, without internal ids or the contributor key", () => {
    expect(out.extension_observations).toEqual([
      {
        offer_id: "o1", observed_at: "2026-09-13T00:00:00Z", price: 990000, original_price: 1200000, stock: 4,
        free_shipping: true, has_voucher: null, promoted: true, created_at: "2026-09-13T00:00:05Z",
      },
    ]);
    expect(out.extension_contributions).toEqual([{ created_at: "2026-09-13T00:00:05Z" }]);
    expect(JSON.stringify(out)).not.toContain("u:u1");
  });
  it("no extension data → empty lists", () => {
    const bare = buildAccountExport({ ...input, extensionObservations: undefined, extensionContributions: undefined } as never);
    expect(bare.extension_observations).toEqual([]);
    expect(bare.extension_contributions).toEqual([]);
  });
  it("data reports: only kind / message / created_at / status; none → empty list", () => {
    const withReports = buildAccountExport({
      ...input,
      dataReports: [{ kind: "wrong_price", message: "giá sai", created_at: "2026-10-07T00:00:00Z", status: "open", user_id: "u1" } as never],
    } as never);
    expect(withReports.data_reports).toEqual([{ kind: "wrong_price", message: "giá sai", created_at: "2026-10-07T00:00:00Z", status: "open" }]);
    expect(out.data_reports).toEqual([]);
  });
  it("watches carry the opt-in hike flag and the Đã mua snapshot, never the engine state", () => {
    expect(out.watches[0]).toMatchObject({ notify_price_hike: false, purchased_at: null, purchased_price: null, purchased_median_days: null });
    const done = buildAccountExport({ ...input, watches: [{ ...input.watches[0], purchased_median_days: 27 }] } as never);
    expect(done.watches[0].purchased_median_days).toBe(27);
    expect(out.watches[0]).not.toHaveProperty("hike_active");
  });
  it("settings in NotificationSettings shape", () => {
    expect(out.notification_settings).toMatchObject({ emailEnabled: true, frequency: "instant" });
  });
});

describe("buildAccountExport — roadmap P4 sections", () => {
  it("saved searches, demand follows (no known_product_ids), folder shares (no token); alert source", () => {
    const out = buildAccountExport({
      ...input,
      alertEvents: [
        { watch_id: null, saved_search_id: "s1", demand_follow_id: null, trigger_types: ["saved_search"], price: 1, deal_score: null, created_at: "2026-10-01T00:00:00Z", alert_deliveries: [] },
        { watch_id: null, saved_search_id: null, demand_follow_id: "f1", trigger_types: ["demand_found"], price: 1, deal_score: null, created_at: "2026-10-01T00:00:00Z", alert_deliveries: [] },
      ],
      savedSearches: [{ name: "SSD", params: { q: "ssd", maxPrice: 1 }, status: "active", created_at: "c", last_alerted_at: null, params_version: 3, initialized_at: "x" } as never],
      demandFollows: [{ keyword: "g10", status: "waiting", created_at: "c", expires_at: "e", found_at: null, known_product_ids: ["p1"] } as never],
      folderShares: [{ folder_id: "f1", title: null, display_name: "An", show_prices: true, show_target: false, show_notes: false, include_done: false, created_at: "c", token: "secret-token" } as never],
    } as never);
    expect(out.alert_events.map((e) => e.source)).toEqual(["saved_search", "demand_found"]);
    expect(out.saved_searches).toEqual([{ name: "SSD", params: { q: "ssd", maxPrice: 1 }, status: "active", created_at: "c", last_alerted_at: null }]);
    expect(out.demand_follows).toEqual([{ keyword: "g10", status: "waiting", created_at: "c", expires_at: "e", found_at: null }]);
    expect(JSON.stringify(out)).not.toContain("secret-token");
    expect(JSON.stringify(out)).not.toContain("known_product_ids");
    expect(out.folder_shares[0]).toMatchObject({ folder_id: "f1", display_name: "An" });
  });
  it("a watch alert says source watch; no P4 data → empty lists", () => {
    const out = buildAccountExport(input as never);
    expect(out.saved_searches).toEqual([]);
    expect(out.demand_follows).toEqual([]);
    expect(out.folder_shares).toEqual([]);
    expect(out.alert_events.every((e) => e.source === "watch")).toBe(true);
  });
});

describe("exportFileName", () => {
  it("dated in Vietnam time", () => {
    // 20:00Z on the 23rd = 03:00 Vietnam time on the 24th
    expect(exportFileName(new Date("2026-09-23T20:00:00Z"))).toBe("dealscore-du-lieu-2026-09-24.json");
  });
});

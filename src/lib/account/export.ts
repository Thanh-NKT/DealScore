import type { Database } from "@/lib/database.types";
import { fromRow, type NotificationSettings } from "@/lib/account/notification-settings";
import type { ConversionStatus } from "@/lib/affiliate/normalize";

type Row<T extends keyof Database["public"]["Tables"]> =
  Database["public"]["Tables"][T]["Row"];

const num = (v: unknown): number | null => (v == null ? null : Number(v));

export interface AccountExport {
  schema_version: 1;
  exported_at: string;
  profile: {
    email: string | null;
    created_at: string;
    consent_version: string | null;
    consent_at: string | null;
    marketing_opt_in: boolean;
    deleted_at: string | null;
  };
  notification_settings: NotificationSettings;
  /** Shopping preferences (spec §5); null when the user never saved any. */
  preferences: {
    brands: string[];
    excluded_brands: string[];
    category_ids: string[];
    min_price: number | null;
    max_price: number | null;
    marketplaces: string[];
    updated_at: string;
  } | null;
  watches: Array<{
    id: string;
    product_id: string | null;
    variant_id: string;
    target_price: number | null;
    drop_pct: number | null;
    notify_low: boolean;
    min_deal_score: number | null;
    notify_back_in_stock: boolean;
    notify_price_hike: boolean;
    channels: string[] | null;
    /** Legacy free-text folder. */
    folder: string | null;
    /** The folder in `folders` this watch is filed in. */
    folder_id: string | null;
    note: string | null;
    baseline_price: number | null;
    last_alerted_at: string | null;
    status: string;
    created_at: string;
    /** "Đã mua" snapshot (migration 0040): price DealScore recorded when marked done, and the 30-day median. */
    purchased_at: string | null;
    purchased_price: number | null;
    purchased_median_30d: number | null;
    /** Days of history behind purchased_median_30d (null = no median). */
    purchased_median_days: number | null;
  }>;
  /** The user's named watch folders. */
  folders: Array<{ id: string; name: string; sort_order: number; created_at: string }>;
  alert_events: Array<{
    watch_id: string;
    trigger_types: string[];
    price: number | null;
    deal_score: number | null;
    created_at: string;
    deliveries: Array<{ channel: string; status: string; sent_at: string | null }>;
  }>;
  push_devices: Array<{ created_at: string; user_agent: string | null }>;
  clicks: Array<{ created_at: string; offer_id: string | null; source: string | null }>;
  url_lookups: Array<{ created_at: string; outcome: string }>;
  orders: Array<{ purchase_time: string; status: ConversionStatus; order_value: number | null; product_item_id: string }>;
  /** First-party analytics events (1.11) — allow-listed properties only. */
  activity: Array<{ created_at: string; event: string; props: unknown }>;
  /** Prices the user's browser extension sent (signed-in contributions only). */
  extension_observations: Array<{
    offer_id: string;
    observed_at: string;
    price: number | null;
    original_price: number | null;
    stock: number | null;
    free_shipping: boolean | null;
    has_voucher: boolean | null;
    /** true once the price was corroborated into the public price history. */
    promoted: boolean;
    created_at: string;
  }>;
  /** When each extension contribution was received (the hourly quota log). */
  extension_contributions: Array<{ created_at: string }>;
  /** "Góp ý dữ liệu" the user sent while signed in. */
  data_reports: Array<{ kind: string; message: string | null; created_at: string; status: string }>;
}

/**
 * Select columns EXPLICITLY for each section — no `...row`: columns added to a table later
 * (e.g. internal engine state such as cond_state) must not leak in automatically
 * file export.
 */
export function buildAccountExport(input: {
  exportedAt: Date;
  profile: Row<"users">;
  settings: Row<"notification_settings">;
  watches: Row<"watches">[];
  folders?: Array<Pick<Row<"watch_folders">, "id" | "name" | "sort_order" | "created_at">>;
  alertEvents: Array<
    Pick<Row<"alert_events">, "watch_id" | "trigger_types" | "price" | "deal_score" | "created_at"> & {
      alert_deliveries: Array<{ channel: string; status: string; sent_at: string | null }>;
    }
  >;
  pushDevices: Array<{ created_at: string; user_agent: string | null }>;
  clicks: Row<"click_events">[];
  lookups: Array<{ created_at: string; outcome: string }>;
  orders: Array<{ purchase_time: string; status: string; order_value: number | null; item_id: string }>;
  activity?: Array<{ created_at: string; name: string; props: unknown }>;
  preferences?: Row<"user_preferences"> | null;
  extensionObservations?: Array<
    Pick<
      Row<"extension_observations">,
      "offer_id" | "observed_at" | "price" | "original_price" | "stock" | "free_shipping" | "has_voucher" | "promoted_at" | "created_at"
    >
  >;
  extensionContributions?: Array<{ created_at: string }>;
  dataReports?: Array<{ kind: string; message: string | null; created_at: string; status: string }>;
}): AccountExport {
  const p = input.profile;
  const pref = input.preferences;
  return {
    schema_version: 1,
    exported_at: input.exportedAt.toISOString(),
    profile: {
      email: p.email,
      created_at: p.created_at,
      consent_version: p.consent_version,
      consent_at: p.consent_at,
      marketing_opt_in: p.marketing_opt_in,
      deleted_at: p.deleted_at,
    },
    notification_settings: fromRow(input.settings),
    preferences: pref
      ? {
          brands: pref.brands,
          excluded_brands: pref.excluded_brands,
          category_ids: pref.category_ids,
          min_price: num(pref.min_price),
          max_price: num(pref.max_price),
          marketplaces: pref.marketplaces,
          updated_at: pref.updated_at,
        }
      : null,
    watches: input.watches.map((w) => ({
      id: w.id,
      product_id: w.product_id,
      variant_id: w.variant_id,
      target_price: num(w.target_price),
      drop_pct: w.drop_pct,
      notify_low: w.notify_low,
      min_deal_score: w.min_deal_score,
      notify_back_in_stock: w.notify_back_in_stock,
      notify_price_hike: w.notify_price_hike ?? false,
      channels: w.channels,
      folder: w.folder,
      folder_id: w.folder_id ?? null,
      note: w.note,
      baseline_price: num(w.baseline_price),
      last_alerted_at: w.last_alerted_at,
      status: w.status,
      created_at: w.created_at,
      purchased_at: w.purchased_at ?? null,
      purchased_price: num(w.purchased_price),
      purchased_median_30d: num(w.purchased_median_30d),
      purchased_median_days: w.purchased_median_days ?? null,
    })),
    folders: (input.folders ?? []).map((f) => ({ id: f.id, name: f.name, sort_order: f.sort_order, created_at: f.created_at })),
    alert_events: input.alertEvents.map((e) => ({
      watch_id: e.watch_id,
      trigger_types: e.trigger_types,
      price: num(e.price),
      deal_score: e.deal_score,
      created_at: e.created_at,
      // Do not export provider_message_id / last_error — internal operational data.
      deliveries: e.alert_deliveries.map((d) => ({ channel: d.channel, status: d.status, sent_at: d.sent_at })),
    })),
    // Only timestamp + browser — NEVER the endpoint or keys (they are push-delivery secrets).
    push_devices: input.pushDevices.map((d) => ({ created_at: d.created_at, user_agent: d.user_agent })),
    clicks: input.clicks.map((c) => ({ created_at: c.created_at, offer_id: c.offer_id, source: c.source })),
    url_lookups: input.lookups.map((l) => ({ created_at: l.created_at, outcome: l.outcome })),
    // A8: do not export commission / raw / sub_ids — that is DealScore's revenue.
    orders: input.orders.map((o) => ({
      purchase_time: o.purchase_time,
      status: o.status as ConversionStatus,
      order_value: num(o.order_value),
      product_item_id: o.item_id,
    })),
    activity: (input.activity ?? []).map((a) => ({ created_at: a.created_at, event: a.name, props: a.props })),
    // No contributor key: it is the user id (or an IP hash), not the user's data.
    extension_observations: (input.extensionObservations ?? []).map((o) => ({
      offer_id: o.offer_id,
      observed_at: o.observed_at,
      price: num(o.price),
      original_price: num(o.original_price),
      stock: o.stock,
      free_shipping: o.free_shipping,
      has_voucher: o.has_voucher,
      promoted: o.promoted_at != null,
      created_at: o.created_at,
    })),
    extension_contributions: (input.extensionContributions ?? []).map((c) => ({ created_at: c.created_at })),
    data_reports: (input.dataReports ?? []).map((r) => ({ kind: r.kind, message: r.message, created_at: r.created_at, status: r.status })),
  };
}

/** dealscore-du-lieu-YYYY-MM-DD.json, dated in Vietnam time. */
export function exportFileName(exportedAt: Date): string {
  const vnDate = exportedAt.toLocaleDateString("en-CA", { timeZone: "Asia/Ho_Chi_Minh" });
  return `dealscore-du-lieu-${vnDate}.json`;
}

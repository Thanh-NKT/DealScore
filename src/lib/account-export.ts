import type { Database } from "@/lib/database.types";
import { fromRow, type NotificationSettings } from "@/lib/notification-settings";
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
  watches: Array<{
    id: string;
    product_id: string | null;
    variant_id: string;
    target_price: number | null;
    drop_pct: number | null;
    notify_low: boolean;
    min_deal_score: number | null;
    notify_back_in_stock: boolean;
    channels: string[] | null;
    folder: string | null;
    note: string | null;
    baseline_price: number | null;
    last_alerted_at: string | null;
    status: string;
    created_at: string;
  }>;
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
}

/**
 * Chọn cột TƯỜNG MINH cho từng mục — không `...row`: cột thêm vào bảng sau này
 * (vd trạng thái nội bộ của engine như cond_state) không được tự động lọt vào
 * file export.
 */
export function buildAccountExport(input: {
  exportedAt: Date;
  profile: Row<"users">;
  settings: Row<"notification_settings">;
  watches: Row<"watches">[];
  alertEvents: Array<
    Pick<Row<"alert_events">, "watch_id" | "trigger_types" | "price" | "deal_score" | "created_at"> & {
      alert_deliveries: Array<{ channel: string; status: string; sent_at: string | null }>;
    }
  >;
  pushDevices: Array<{ created_at: string; user_agent: string | null }>;
  clicks: Row<"click_events">[];
  lookups: Array<{ created_at: string; outcome: string }>;
  orders: Array<{ purchase_time: string; status: string; order_value: number | null; item_id: string }>;
}): AccountExport {
  const p = input.profile;
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
    watches: input.watches.map((w) => ({
      id: w.id,
      product_id: w.product_id,
      variant_id: w.variant_id,
      target_price: num(w.target_price),
      drop_pct: w.drop_pct,
      notify_low: w.notify_low,
      min_deal_score: w.min_deal_score,
      notify_back_in_stock: w.notify_back_in_stock,
      channels: w.channels,
      folder: w.folder,
      note: w.note,
      baseline_price: num(w.baseline_price),
      last_alerted_at: w.last_alerted_at,
      status: w.status,
      created_at: w.created_at,
    })),
    alert_events: input.alertEvents.map((e) => ({
      watch_id: e.watch_id,
      trigger_types: e.trigger_types,
      price: num(e.price),
      deal_score: e.deal_score,
      created_at: e.created_at,
      // Không xuất provider_message_id / last_error — dữ liệu vận hành nội bộ.
      deliveries: e.alert_deliveries.map((d) => ({ channel: d.channel, status: d.status, sent_at: d.sent_at })),
    })),
    // Chỉ thời điểm + trình duyệt — KHÔNG endpoint hay khóa (là bí mật gửi push).
    push_devices: input.pushDevices.map((d) => ({ created_at: d.created_at, user_agent: d.user_agent })),
    clicks: input.clicks.map((c) => ({ created_at: c.created_at, offer_id: c.offer_id, source: c.source })),
    url_lookups: input.lookups.map((l) => ({ created_at: l.created_at, outcome: l.outcome })),
    // A8: không xuất commission / raw / sub_ids — đó là doanh thu của Kairo.
    orders: input.orders.map((o) => ({
      purchase_time: o.purchase_time,
      status: o.status as ConversionStatus,
      order_value: num(o.order_value),
      product_item_id: o.item_id,
    })),
  };
}

/** kairo-du-lieu-YYYY-MM-DD.json theo ngày VN. */
export function exportFileName(exportedAt: Date): string {
  const vnDate = exportedAt.toLocaleDateString("en-CA", { timeZone: "Asia/Ho_Chi_Minh" });
  return `kairo-du-lieu-${vnDate}.json`;
}

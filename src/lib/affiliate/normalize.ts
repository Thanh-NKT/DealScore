import { parseSubId, type ClickSource } from "@/lib/affiliate/link";

export type ConversionStatus = "pending" | "completed" | "cancelled" | "unknown";

/** Đúng khóa của RPC upsert_conversions (0007). */
export interface NormalizedConversion {
  order_id: string;
  item_id: string;
  model_id: string; // '' khi không có
  click_event_id: string | null;
  sub_ids: string[];
  source_channel: ClickSource | "unknown";
  purchase_time: string;
  complete_time: string | null;
  status: ConversionStatus;
  raw_status: string;
  item_price: number | null;
  quantity: number | null;
  order_value: number | null;
  commission: number | null;
  import_source: "api" | "csv";
  raw: Record<string, unknown>;
}

/** G3 — tối thiểu các field dùng tới; mọi field chưa chắc chắn đều optional. */
export interface ApiOrder {
  orderId?: string | number;
  orderStatus?: string;
  purchaseTime?: string | number;
  completeTime?: string | number;
  utmContent?: string;
  subIds?: string[];
}
export interface ApiItem {
  itemId?: string | number;
  modelId?: string | number;
  itemPrice?: string | number;
  qty?: string | number;
  actualAmount?: string | number;
  itemTotalCommission?: string | number;
  displayItemStatus?: string;
  completeTime?: string | number;
}

// ------------------------------------------------------------- trạng thái (G3)
const STATUS_MAP: Record<string, ConversionStatus> = {
  pending: "pending",
  unpaid: "pending",
  processing: "pending",
  to_ship: "pending",
  shipping: "pending",
  completed: "completed",
  complete: "completed",
  settled: "completed",
  paid: "completed",
  cancelled: "cancelled",
  canceled: "cancelled",
  refunded: "cancelled",
  returned: "cancelled",
  invalid: "cancelled",
};

export function normalizeStatus(raw: string): ConversionStatus {
  const key = (raw ?? "").trim().toLowerCase().replace(/\s+/g, "_");
  return STATUS_MAP[key] ?? "unknown";
}

// ------------------------------------------------------------------- tiền
export function parseMoney(raw: unknown): number | null {
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  if (typeof raw !== "string") return null;
  let s = raw.replace(/₫|đ|vnd|\s/gi, "");
  if (!s) return null;

  const lastDot = s.lastIndexOf(".");
  const lastComma = s.lastIndexOf(",");
  if (lastDot >= 0 && lastComma >= 0) {
    // Ký tự xuất hiện sau cùng là dấu thập phân.
    const dec = lastDot > lastComma ? "." : ",";
    const thousands = dec === "." ? "," : ".";
    s = s.split(thousands).join("").replace(dec, ".");
  } else {
    const sep = lastDot >= 0 ? "." : lastComma >= 0 ? "," : null;
    if (sep) {
      const parts = s.split(sep);
      // Nhiều dấu, hoặc nhóm cuối đúng 3 chữ số → phân nhóm hàng nghìn (VND không có phần lẻ).
      s = parts.length > 2 || parts[parts.length - 1].length === 3 ? parts.join("") : parts.join(".");
    }
  }
  return /^-?\d+(\.\d+)?$/.test(s) ? Number(s) : null;
}

// ------------------------------------------------------------- thời gian
const VN_OFFSET_MS = 7 * 3_600_000;

export function parseTime(raw: unknown): string | null {
  if (raw == null || raw === "") return null;
  if (typeof raw === "number" || (typeof raw === "string" && /^\d+$/.test(raw.trim()))) {
    const n = Number(raw);
    if (!Number.isFinite(n) || n <= 0) return null;
    return new Date(n > 1e12 ? n : n * 1000).toISOString();
  }
  if (typeof raw !== "string") return null;
  const s = raw.trim();

  const vn = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (vn) {
    const [, d, m, y, hh, mm, ss] = vn;
    const utc = Date.UTC(Number(y), Number(m) - 1, Number(d), Number(hh), Number(mm), Number(ss ?? 0)) - VN_OFFSET_MS;
    return new Date(utc).toISOString();
  }
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
    const t = Date.parse(s);
    return Number.isNaN(t) ? null : new Date(t).toISOString();
  }
  return null;
}

// ------------------------------------------------------------------- dòng API
const str = (v: unknown) => (v == null || v === "" ? null : String(v).trim());
const int = (v: unknown) => {
  const n = parseMoney(v);
  return n == null ? null : Math.round(n);
};

function finish(
  base: Omit<NormalizedConversion, "click_event_id" | "source_channel" | "order_value"> & { order_value: number | null },
): NormalizedConversion {
  const { clickId, source } = parseSubId(base.sub_ids);
  const orderValue =
    base.order_value ?? (base.item_price != null && base.quantity != null ? base.item_price * base.quantity : null);
  return { ...base, click_event_id: clickId, source_channel: source, order_value: orderValue };
}

export function normalizeApiRow(
  order: ApiOrder,
  item: ApiItem,
): { ok: true; row: NormalizedConversion } | { ok: false; reason: string } {
  const orderId = str(order.orderId);
  const itemId = str(item.itemId);
  const purchase = parseTime(order.purchaseTime);
  if (!orderId) return { ok: false, reason: "thiếu orderId" };
  if (!itemId) return { ok: false, reason: `đơn ${orderId}: thiếu itemId` };
  if (!purchase) return { ok: false, reason: `đơn ${orderId}: thiếu / sai purchaseTime` };

  const rawStatus = str(item.displayItemStatus) ?? str(order.orderStatus) ?? "";
  return {
    ok: true,
    row: finish({
      order_id: orderId,
      item_id: itemId,
      model_id: str(item.modelId) ?? "",
      sub_ids: order.subIds?.length ? order.subIds : order.utmContent ? order.utmContent.split("-") : [],
      purchase_time: purchase,
      complete_time: parseTime(item.completeTime ?? order.completeTime),
      status: normalizeStatus(rawStatus),
      raw_status: rawStatus,
      item_price: parseMoney(item.itemPrice),
      quantity: int(item.qty),
      order_value: parseMoney(item.actualAmount),
      commission: parseMoney(item.itemTotalCommission),
      import_source: "api",
      raw: { order, item },
    }),
  };
}

// ------------------------------------------------------------------- dòng CSV
/** G5 — MỘT chỗ duy nhất chứa tên cột CSV. Mỗi trường là danh sách tên chấp nhận được. */
export const CSV_COLUMNS = {
  orderId: ["Order ID", "Mã đơn hàng"],
  itemId: ["Item ID", "ID sản phẩm"],
  modelId: ["Model ID", "ID phân loại"],
  purchaseTime: ["Purchase Time", "Thời gian đặt hàng"],
  completeTime: ["Complete Time", "Thời gian hoàn thành"],
  status: ["Order Status", "Item Status", "Trạng thái đặt hàng"],
  itemPrice: ["Item Price", "Giá sản phẩm"],
  quantity: ["Qty", "Quantity", "Số lượng"],
  commission: ["Item Total Commission", "Total Commission", "Tổng hoa hồng sản phẩm"],
  orderValue: ["Actual Amount", "Purchase Value", "Giá trị mua"],
  subIds: ["Sub_id1", "Sub_id2", "Sub_id3", "Sub_id4", "Sub_id5"],
} as const;

export const REQUIRED_CSV_FIELDS = ["orderId", "itemId", "purchaseTime", "status"] as const;

function pick(record: Record<string, string>, names: readonly string[]): string | null {
  const wanted = new Set(names.map((n) => n.trim().toLowerCase()));
  for (const [k, v] of Object.entries(record)) {
    if (wanted.has(k.trim().toLowerCase()) && v != null && String(v).trim() !== "") return String(v).trim();
  }
  return null;
}

/** Tên cột thật của file CSV có khớp đủ trường bắt buộc không — dùng để báo lỗi sớm. */
export function missingCsvFields(headers: string[]): string[] {
  const have = new Set(headers.map((h) => h.trim().toLowerCase()));
  return REQUIRED_CSV_FIELDS.filter((f) => !CSV_COLUMNS[f].some((n) => have.has(n.toLowerCase())));
}

export function normalizeCsvRow(
  record: Record<string, string>,
): { ok: true; row: NormalizedConversion } | { ok: false; reason: string } {
  const orderId = pick(record, CSV_COLUMNS.orderId);
  const itemId = pick(record, CSV_COLUMNS.itemId);
  const purchase = parseTime(pick(record, CSV_COLUMNS.purchaseTime));
  if (!orderId) return { ok: false, reason: "thiếu Order ID" };
  if (!itemId) return { ok: false, reason: `đơn ${orderId}: thiếu Item ID` };
  if (!purchase) return { ok: false, reason: `đơn ${orderId}: thiếu / sai Purchase Time` };

  const rawStatus = pick(record, CSV_COLUMNS.status) ?? "";
  const subIds = CSV_COLUMNS.subIds.map((c) => pick(record, [c])).filter((v): v is string => !!v);
  return {
    ok: true,
    row: finish({
      order_id: orderId,
      item_id: itemId,
      model_id: pick(record, CSV_COLUMNS.modelId) ?? "",
      sub_ids: subIds,
      purchase_time: purchase,
      complete_time: parseTime(pick(record, CSV_COLUMNS.completeTime)),
      status: normalizeStatus(rawStatus),
      raw_status: rawStatus,
      item_price: parseMoney(pick(record, CSV_COLUMNS.itemPrice)),
      quantity: int(pick(record, CSV_COLUMNS.quantity)),
      order_value: parseMoney(pick(record, CSV_COLUMNS.orderValue)),
      commission: parseMoney(pick(record, CSV_COLUMNS.commission)),
      import_source: "csv",
      raw: record,
    }),
  };
}

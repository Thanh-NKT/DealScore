import { formatVnd } from "@/lib/format";
import { VOUCHER_FRESH_DAYS } from "@/lib/vouchers/select";

/**
 * Shop voucher patterns (roadmap P4 item K, spec §7.2): which shop vouchers DealScore SAW in the months it
 * actually checked the shop. Recorded facts only — never "sắp có mã". Never feeds Deal Score / search / alerts.
 * Pure. Thresholds — tune with real data.
 */
export const VOUCHER_PATTERN_WINDOW_DAYS = 90;
export const VOUCHER_PATTERN_MIN_CHECK_DAYS = 20; // tune with real data
export const VOUCHER_PATTERN_MIN_CHECK_MONTHS = 2; // tune with real data
export const VOUCHER_PATTERN_MIN_SHAPE_MONTHS = 2; // tune with real data
export const VOUCHER_PATTERN_TIMING_SHARE = 0.6; // tune with real data
export const VOUCHER_PATTERN_MAX_SHOWN = 3;

export type VoucherTiming = "early" | "mid" | "late" | "double_day";

export interface VoucherShape {
  discountType: "percent" | "amount";
  discountValue: number;
  maxDiscount: number | null;
  minSpend: number;
  hasCode: boolean;
  /** Vietnam days ("YYYY-MM-DD") with a trusted sighting. */
  days: string[];
}
/** seller_voucher_history() (0063) in camelCase. */
export interface SellerVoucherHistory {
  checkDays: number;
  firstCheckDay: string | null;
  checkMonths: string[];
  shapes: VoucherShape[];
}

export interface VoucherPattern {
  label: string;
  monthsSeen: number;
  monthsChecked: number;
  daysSeen: number;
  lastSeenDay: string;
  timing: VoucherTiming | null;
  seenRecently: boolean;
}
export type VoucherPatternSummary =
  | { status: "insufficient"; checkDays: number; minCheckDays: number; checkMonths: number; minCheckMonths: number }
  | { status: "none"; checkDays: number }
  | { status: "patterns"; patterns: VoucherPattern[]; checkDays: number };

const num = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : typeof v === "string" && v !== "" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
};
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** RPC jsonb → SellerVoucherHistory. Tolerant: malformed shapes are dropped. */
export function parseSellerVoucherHistory(raw: unknown): SellerVoucherHistory {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const shapes: VoucherShape[] = [];
  for (const x of Array.isArray(r.shapes) ? r.shapes : []) {
    const s = (x ?? {}) as Record<string, unknown>;
    const value = num(s.discount_value);
    if ((s.discount_type !== "percent" && s.discount_type !== "amount") || value == null || value <= 0) continue;
    shapes.push({
      discountType: s.discount_type,
      discountValue: value,
      maxDiscount: num(s.max_discount),
      minSpend: num(s.min_spend) ?? 0,
      hasCode: s.has_code === true,
      days: (Array.isArray(s.days) ? s.days : []).filter((d): d is string => typeof d === "string" && DAY_RE.test(d)),
    });
  }
  return {
    checkDays: num(r.check_days) ?? 0,
    firstCheckDay: typeof r.first_check_day === "string" ? r.first_check_day : null,
    checkMonths: (Array.isArray(r.check_months) ? r.check_months : []).filter((m): m is string => typeof m === "string"),
    shapes,
  };
}

/** "Mã giảm 50.000đ (đơn từ 500.000đ)", "Giảm 10%, tối đa 30.000đ" — same wording as the VoucherPicker. */
export function voucherShapeLabel(s: Pick<VoucherShape, "discountType" | "discountValue" | "maxDiscount" | "minSpend" | "hasCode">): string {
  const what =
    s.discountType === "percent"
      ? `${s.discountValue}%${s.maxDiscount != null ? `, tối đa ${formatVnd(s.maxDiscount)}` : ""}`
      : formatVnd(s.discountValue);
  return `${s.hasCode ? "Mã giảm" : "Giảm"} ${what}${s.minSpend > 0 ? ` (đơn từ ${formatVnd(s.minSpend)})` : ""}`;
}

function bucket(day: string): Exclude<VoucherTiming, "double_day"> {
  const d = Number(day.slice(8, 10));
  return d <= 10 ? "early" : d <= 20 ? "mid" : "late";
}
const isDoubleDay = (day: string) => Number(day.slice(5, 7)) === Number(day.slice(8, 10));

export function voucherTiming(days: string[]): VoucherTiming | null {
  if (days.length === 0) return null;
  const share = (n: number) => n / days.length;
  // Double days (9.9, 11.11 …) win ties with the plain month buckets they also fall in.
  if (share(days.filter(isDoubleDay).length) >= VOUCHER_PATTERN_TIMING_SHARE) return "double_day";
  for (const b of ["early", "mid", "late"] as const) {
    if (share(days.filter((d) => bucket(d) === b).length) >= VOUCHER_PATTERN_TIMING_SHARE) return b;
  }
  return null;
}

const vnToday = (now: Date) => new Date(now.getTime() + 7 * 3_600_000).toISOString().slice(0, 10);
const dayDiff = (a: string, b: string) => Math.round((Date.parse(a) - Date.parse(b)) / 86_400_000);

export function voucherPatterns(h: SellerVoucherHistory, now: Date): VoucherPatternSummary {
  const checkMonths = new Set(h.checkMonths);
  if (h.checkDays < VOUCHER_PATTERN_MIN_CHECK_DAYS || checkMonths.size < VOUCHER_PATTERN_MIN_CHECK_MONTHS) {
    return {
      status: "insufficient",
      checkDays: h.checkDays,
      minCheckDays: VOUCHER_PATTERN_MIN_CHECK_DAYS,
      checkMonths: checkMonths.size,
      minCheckMonths: VOUCHER_PATTERN_MIN_CHECK_MONTHS,
    };
  }
  const today = vnToday(now);
  const patterns: Array<VoucherPattern & { value: number }> = [];
  for (const s of h.shapes) {
    const days = [...new Set(s.days)].sort();
    if (days.length === 0) continue;
    // Months with a sighting but no recorded check are not counted (DealScore did not "look" that month).
    const monthsSeen = new Set(days.map((d) => d.slice(0, 7)).filter((m) => checkMonths.has(m))).size;
    if (monthsSeen < VOUCHER_PATTERN_MIN_SHAPE_MONTHS) continue;
    const last = days[days.length - 1];
    patterns.push({
      label: voucherShapeLabel(s),
      monthsSeen,
      monthsChecked: checkMonths.size,
      daysSeen: days.length,
      lastSeenDay: last,
      timing: voucherTiming(days),
      seenRecently: dayDiff(today, last) < VOUCHER_FRESH_DAYS,
      value: s.discountValue,
    });
  }
  if (patterns.length === 0) return { status: "none", checkDays: h.checkDays };
  patterns.sort((a, b) => b.monthsSeen - a.monthsSeen || b.value - a.value);
  return {
    status: "patterns",
    checkDays: h.checkDays,
    patterns: patterns.slice(0, VOUCHER_PATTERN_MAX_SHOWN).map(({ value: _value, ...p }) => p),
  };
}

const TIMING_TEXT: Record<VoucherTiming, string> = {
  early: "thường vào đầu tháng",
  mid: "thường vào giữa tháng",
  late: "thường vào cuối tháng",
  double_day: "thường vào các ngày đôi như 11.11",
};

/** Display copy of one pattern / of a summary (UI spec §4). Pure. */
export function voucherPatternCopy(p: VoucherPattern): { title: string; months: string; timing: string | null } {
  return {
    title: p.label,
    months: `Có trong ${p.monthsSeen}/${p.monthsChecked} tháng gần đây`,
    timing: p.timing ? TIMING_TEXT[p.timing] : null,
  };
}

export function voucherSummaryCopy(s: VoucherPatternSummary): string | null {
  if (s.status === "insufficient") {
    return `Chưa đủ dữ liệu: mới kiểm tra mã của shop ${s.checkDays}/${s.minCheckDays} ngày trong ${s.checkMonths}/${s.minCheckMonths} tháng.`;
  }
  if (s.status === "none") return `DealScore đã kiểm tra ${s.checkDays} ngày, chưa thấy mã nào lặp lại.`;
  return null;
}

/** One line for the product page (best-buy seller only, patterns only). */
export function productVoucherLine(shop: string, s: VoucherPatternSummary): string | null {
  if (s.status !== "patterns") return null;
  const p = s.patterns[0];
  return `${shop}: ${p.label} có trong ${p.monthsSeen}/${p.monthsChecked} tháng gần đây${p.timing ? `, ${TIMING_TEXT[p.timing]}` : ""}.`;
}

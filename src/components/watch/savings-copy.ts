import { formatVnd } from "@/lib/format";
import type { SavingsLine } from "@/lib/watch/savings";

export type Purchase = SavingsLine & { purchasedAt: string; purchasedPrice: number | null };

const vnDate = (iso: string) => new Date(iso).toLocaleDateString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" });

/**
 * Copy for a "Đã mua" row (UI spec §4). Neutral wording when the purchase was above the median — it is
 * a record, not a verdict. Nothing is invented when the snapshot lacks data.
 */
export function savingsCopy(p: Purchase): { text: string; tone: "buy" | "ink-2" | "ink-3"; sub: string } {
  let text: string;
  let tone: "buy" | "ink-2" | "ink-3";
  if (p.status === "saved" && p.vsMedian != null) {
    text = `Thấp hơn trung vị 30 ngày ${formatVnd(p.vsMedian)}`;
    tone = "buy";
  } else if (p.status === "above" && p.vsMedian != null) {
    text = `Cao hơn trung vị 30 ngày ${formatVnd(-p.vsMedian)}`;
    tone = "ink-2";
  } else if (p.status === "flat") {
    text = "Ngang trung vị 30 ngày";
    tone = "ink-2";
  } else {
    text = "Chưa đủ lịch sử giá để so";
    tone = "ink-3";
  }
  const when = vnDate(p.purchasedAt);
  let sub = p.purchasedPrice != null ? `Mua lúc ${formatVnd(p.purchasedPrice)} · ${when}` : `Mua ngày ${when}`;
  if (p.vsBaseline != null) {
    // vsBaseline > 0 = cheaper than when tracking started → the price moved down.
    const sign = p.vsBaseline > 0 ? "−" : p.vsBaseline < 0 ? "+" : "±";
    sub += ` · so với lúc bắt đầu theo dõi: ${sign}${formatVnd(Math.abs(p.vsBaseline))}`;
  }
  return { text, tone, sub };
}

/** One line for the result after "Đã mua" — only the saving, only once the server has the snapshot. */
export function purchaseNotice(name: string, p: Purchase | undefined): string {
  const base = `Đã chuyển “${name}” vào Đã mua.`;
  return p?.status === "saved" && p.vsMedian != null
    ? `${base} Bạn mua thấp hơn trung vị 30 ngày ${formatVnd(p.vsMedian)}.`
    : base;
}

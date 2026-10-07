/**
 * "Góp ý dữ liệu" (roadmap P2 item 6). Limits are guesses until real traffic exists — tune with real data.
 */
export type ReportKind = "wrong_price" | "wrong_match" | "stock" | "other";

export const REPORT_KINDS: readonly ReportKind[] = ["wrong_price", "wrong_match", "stock", "other"];

/** User-facing labels for the dialog's radio list (UI spec §7). */
export const REPORT_KIND_LABEL: Record<ReportKind, string> = {
  wrong_price: "Giá sai",
  wrong_match: "Ghép nhầm sản phẩm khác",
  stock: "Hết hàng nhưng vẫn hiện / còn hàng nhưng báo hết",
  other: "Khác",
};

/** Max characters of the free-text message, after trimming (same check as data_reports.message). */
export const REPORT_MESSAGE_MAX = 500;
/** A member's identical open report inside this window is not stored twice (submit_data_report). */
export const REPORT_DEDUP_HOURS = 24;
export const REPORTS_PER_HOUR_USER = 10;
export const REPORTS_PER_HOUR_GUEST = 3;
export const REPORTS_PER_DAY_GLOBAL = 500;

"use server";

import { headers } from "next/headers";
import { getCurrentUser } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { clientIp, networkPrefix, rateKeyHash } from "@/lib/rate-limit";
import { reportError } from "@/lib/observability";
import {
  REPORT_DEDUP_HOURS,
  REPORTS_PER_DAY_GLOBAL,
  REPORTS_PER_HOUR_GUEST,
  REPORTS_PER_HOUR_USER,
} from "@/lib/reports/constants";
import { validateReport, type ReportInput } from "@/lib/reports/validate";

export type ReportResult =
  | { ok: true; duplicate: boolean }
  | { ok: false; error: "invalid" | "rate_limited" | "unavailable" };

/**
 * "Góp ý dữ liệu" from the product page — signed in or not. The reporter's id comes from the session only,
 * never from the input. Throttled per user (or per hashed client network for guests) and globally; a
 * throttle FAILURE refuses the report ("unavailable") rather than storing it unthrottled. No IP is stored:
 * the hashed network key lives only in rate_counters.
 */
export async function submitDataReport(input: ReportInput): Promise<ReportResult> {
  const parsed = validateReport(input);
  if (!parsed.ok) return { ok: false, error: "invalid" };
  const report = parsed.value;

  const user = await getCurrentUser().catch(() => null);
  const supabase = createAdminClient();

  try {
    const who = user
      ? { key: `report:u:${user.id}`, limit: REPORTS_PER_HOUR_USER }
      : { key: `report:ip:${rateKeyHash(networkPrefix(clientIp(await headers())))}`, limit: REPORTS_PER_HOUR_GUEST };
    const hits = await Promise.all([
      supabase.rpc("rate_hit", { p_key: who.key, p_window_seconds: 3600, p_limit: who.limit }),
      supabase.rpc("rate_hit", { p_key: "report:all", p_window_seconds: 86_400, p_limit: REPORTS_PER_DAY_GLOBAL }),
    ]);
    for (const { error } of hits) if (error) throw new Error(`rate_hit: ${error.message}`);
    if (hits.some(({ data }) => data === false)) return { ok: false, error: "rate_limited" };
  } catch (err) {
    reportError(err, { where: "data_report_throttle" });
    return { ok: false, error: "unavailable" };
  }

  const { data, error } = await supabase.rpc("submit_data_report", {
    p: {
      product_id: report.productId,
      variant_id: report.variantId,
      offer_id: report.offerId,
      kind: report.kind,
      message: report.message,
      user_id: user?.id ?? null,
      dedup_hours: REPORT_DEDUP_HOURS,
    },
  });
  if (error) {
    // Business refusals (mismatched ids, …) are the caller's input; anything else is ours.
    if (error.message.startsWith("submit_data_report:")) return { ok: false, error: "invalid" };
    reportError(new Error(`submit_data_report: ${error.message}`), { where: "data_report_submit" });
    return { ok: false, error: "unavailable" };
  }
  return { ok: true, duplicate: (data as { duplicate?: boolean } | null)?.duplicate === true };
}

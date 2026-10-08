import { NextResponse, type NextRequest } from "next/server";
import { adminAuthError, NO_STORE } from "@/lib/admin/api-auth";
import { REFRESH_INTERVAL_HOURS } from "@/lib/collector/schedule";
import { MARKETPLACES } from "@/lib/marketplaces";
import { getSource } from "@/lib/marketplaces/sources";
import { siteUrl } from "@/lib/site-url";
import { STALE_HOURS } from "@/lib/watch/constants";
import { ANOMALY_SCAN_MAX_HOURS, ANOMALY_THRESHOLDS } from "@/lib/anomalies/constants";

/**
 * Collector cadence for the admin "Chất lượng dữ liệu" page, read from the constants (never copied there).
 * A listing with an active Watch is refreshed at the priority-1 rate whatever its stored priority.
 */
const COLLECTOR_STATUS = {
  refreshIntervalHours: Object.fromEntries(Object.entries(REFRESH_INTERVAL_HOURS)) as Record<string, number>,
  watchedPriority: 1,
  staleHours: STALE_HOURS,
};

/** Price-anomaly detection thresholds (0051): the admin "/prices" page shows them read-only. */
const ANOMALY_STATUS = { ...ANOMALY_THRESHOLDS, scanMaxHours: ANOMALY_SCAN_MAX_HOURS };

export const dynamic = "force-dynamic";

/** Which marketplace sources this deployment has (env only lives here). Never returns secret values. */
export async function GET(request: NextRequest) {
  const denied = adminAuthError(request.headers);
  if (denied) return denied;
  const marketplaces = MARKETPLACES.map((m) => {
    const source = getSource(m.id);
    return {
      id: m.id,
      name: m.name,
      configured: source?.isConfigured() ?? false,
      fake: source?.isFake() ?? false,
      affiliateLinks: m.id === "shopee" ? Boolean(process.env.SHOPEE_AFFILIATE_ID) : false,
    };
  });
  return NextResponse.json(
    { marketplaces, cronSecretSet: Boolean(process.env.CRON_SECRET), siteUrl: siteUrl(), collector: COLLECTOR_STATUS, anomalies: ANOMALY_STATUS },
    { headers: NO_STORE },
  );
}

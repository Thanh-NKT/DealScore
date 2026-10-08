import { NextResponse, type NextRequest } from "next/server";
import { adminAuthError, NO_STORE } from "@/lib/admin/api-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { reportError } from "@/lib/observability";
import { detectPriceAnomalies } from "@/lib/anomalies/detect";
import { ANOMALY_SCAN_MAX_HOURS } from "@/lib/anomalies/constants";

export const dynamic = "force-dynamic";

/** Admin "Quét lại": detect price anomalies among the last `hours` of observations (migration 0051). */
export async function POST(request: NextRequest) {
  const denied = adminAuthError(request.headers);
  if (denied) return denied;
  let hours: unknown;
  try {
    hours = (await request.json())?.hours;
  } catch {
    hours = null;
  }
  if (typeof hours !== "number" || !Number.isInteger(hours) || hours < 1 || hours > ANOMALY_SCAN_MAX_HOURS) {
    return NextResponse.json({ error: "bad_request" }, { status: 400, headers: NO_STORE });
  }
  try {
    const inserted = await detectPriceAnomalies(createAdminClient(), { since: new Date(Date.now() - hours * 3_600_000) });
    return NextResponse.json({ inserted }, { headers: NO_STORE });
  } catch (err) {
    reportError(err, { route: "admin.priceAnomalies.scan" });
    return NextResponse.json({ error: "internal" }, { status: 500, headers: NO_STORE });
  }
}

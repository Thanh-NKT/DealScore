import { NextResponse, type NextRequest } from "next/server";
import { acquireJobLock, isAuthorizedCronRequest, releaseJobLock } from "@/lib/cron";
import { createAdminClient } from "@/lib/supabase/admin";
import { evaluateSavedSearches } from "@/lib/saved-search/evaluate";
import { checkDemandFollows } from "@/lib/demand-follow/check";
import { reportError } from "@/lib/observability";

export const maxDuration = 60;
const NO_STORE = { "Cache-Control": "no-store" };

/**
 * pg_cron 'dealscore-discovery-alerts' (0060, 4×/hour): saved searches (P4 E) then demand follows (P4 F). Both
 * only CREATE alert events + deliveries; sending stays in /api/cron/alerts (dispatchDueDeliveries), so retry,
 * idempotency, quiet hours and digests are the watch alerts' own.
 */
export async function POST(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: "Missing CRON_SECRET" }, { status: 500, headers: NO_STORE });
  if (!isAuthorizedCronRequest(request.headers, secret)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401, headers: NO_STORE });
  }
  const admin = createAdminClient();
  const owner = await acquireJobLock(admin, "discovery-alerts");
  if (!owner) return NextResponse.json({ skipped: "locked" }, { headers: NO_STORE });

  const now = new Date();
  const deadline = Date.now() + 50_000;
  try {
    let savedSearches: unknown;
    let demandFollows: unknown;
    try {
      savedSearches = await evaluateSavedSearches({ now, deadline }, admin);
    } catch (err) {
      reportError(err, { job: "discovery-alerts", where: "saved_searches" });
      savedSearches = { error: "failed" };
    }
    try {
      demandFollows = await checkDemandFollows({ now, deadline }, admin);
    } catch (err) {
      reportError(err, { job: "discovery-alerts", where: "demand_follows" });
      demandFollows = { error: "failed" };
    }
    return NextResponse.json({ savedSearches, demandFollows }, { headers: NO_STORE });
  } finally {
    await releaseJobLock(admin, "discovery-alerts", owner);
  }
}

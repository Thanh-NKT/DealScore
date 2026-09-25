import { randomUUID } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { isAuthorizedCronRequest } from "@/lib/cron";
import { createAdminClient } from "@/lib/supabase/admin";
import { evaluateWatches } from "@/lib/alerts/evaluate";
import { dispatchDueDeliveries } from "@/lib/alerts/dispatch";
import { sendPushToUser } from "@/lib/push";
import { reportError } from "@/lib/observability";

export const maxDuration = 60;
const NO_STORE = { "Cache-Control": "no-store" };

export async function POST(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: "Missing CRON_SECRET" }, { status: 500, headers: NO_STORE });
  if (!isAuthorizedCronRequest(request.headers, secret)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401, headers: NO_STORE });
  }

  const admin = createAdminClient();
  const owner = randomUUID();
  const { data: acquired, error } = await admin.rpc("try_acquire_job_lock", {
    p_name: "alerts",
    p_owner: owner,
    p_ttl_seconds: 600,
  });
  if (error) throw new Error(`Failed to acquire lock: ${error.message}`);
  if (!acquired) return NextResponse.json({ skipped: "locked" }, { headers: NO_STORE });

  try {
    const now = new Date();
    const deadline = Date.now() + 50_000;
    const evaluate = await evaluateWatches({ now, deadline }, admin);
    const dispatch = await dispatchDueDeliveries({ now, deadline }, admin, sendPushToUser);
    // Per-item errors are already recorded in the DB — 200. 500 is only for whole-run failures (thrown).
    return NextResponse.json({ evaluate, dispatch }, { headers: NO_STORE });
  } catch (err) {
    reportError(err, { job: "alerts" });
    throw err;
  } finally {
    await admin.rpc("release_job_lock", { p_name: "alerts", p_owner: owner });
  }
}

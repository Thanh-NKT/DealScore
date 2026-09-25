import { randomUUID } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { isAuthorizedCronRequest } from "@/lib/cron";
import { createAdminClient } from "@/lib/supabase/admin";
import { runBacktest } from "@/lib/pricing/backtest-job";
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
    p_name: "backtest",
    p_owner: owner,
    p_ttl_seconds: 600,
  });
  if (error) throw new Error(`Failed to acquire lock: ${error.message}`);
  if (!acquired) return NextResponse.json({ skipped: "locked" }, { headers: NO_STORE });

  try {
    // v0 and v1 side by side: the weekly numbers decide whether v1 stays the default.
    const deadline = Date.now() + 50_000;
    const runs = [];
    for (const version of ["v0", "v1"] as const) {
      const { runId, variants, result, accuracy } = await runBacktest(admin, { deadline, version });
      runs.push({ version, runId, variants, samples: result.samples, accuracy });
    }
    return NextResponse.json({ runs }, { headers: NO_STORE });
  } catch (err) {
    reportError(err, { job: "backtest" });
    throw err;
  } finally {
    await admin.rpc("release_job_lock", { p_name: "backtest", p_owner: owner });
  }
}

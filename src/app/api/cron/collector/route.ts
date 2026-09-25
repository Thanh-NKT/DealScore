import { randomUUID } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { isAuthorizedCronRequest } from "@/lib/cron";
import { createAdminClient } from "@/lib/supabase/admin";
import { runCollector } from "@/lib/collector/run";
import { isShopeeConfigured } from "@/lib/shopee/client";
import { reportError } from "@/lib/observability";

export const maxDuration = 60;
const NO_STORE = { "Cache-Control": "no-store" };

export async function POST(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: "Missing CRON_SECRET" }, { status: 500, headers: NO_STORE });
  if (!isAuthorizedCronRequest(request.headers, secret)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401, headers: NO_STORE });
  }
  // Checked before taking the lock: until the Shopee API exists every hourly call ends here.
  if (!isShopeeConfigured()) return NextResponse.json({ skipped: "not_configured" }, { headers: NO_STORE });

  const admin = createAdminClient();
  const owner = randomUUID();
  const { data: acquired, error } = await admin.rpc("try_acquire_job_lock", {
    p_name: "collector",
    p_owner: owner,
    p_ttl_seconds: 600,
  });
  if (error) throw new Error(`Failed to acquire lock: ${error.message}`);
  if (!acquired) return NextResponse.json({ skipped: "locked" }, { headers: NO_STORE });

  try {
    const result = await runCollector({ now: new Date(), deadline: Date.now() + 50_000 }, admin);
    return NextResponse.json(result, { headers: NO_STORE });
  } catch (err) {
    reportError(err, { job: "collector" });
    throw err;
  } finally {
    await admin.rpc("release_job_lock", { p_name: "collector", p_owner: owner });
  }
}

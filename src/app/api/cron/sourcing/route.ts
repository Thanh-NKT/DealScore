import { randomUUID } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { isAuthorizedCronRequest } from "@/lib/cron";
import { createAdminClient } from "@/lib/supabase/admin";
import { configuredMarketplaces } from "@/lib/marketplaces/sources";
import { runSourcing, supabaseSourcingDeps, type SourcingResult } from "@/lib/sourcing/run";
import { reportError } from "@/lib/observability";

export const maxDuration = 60;
const NO_STORE = { "Cache-Control": "no-store" };

/** Daily automatic sourcing (pg_cron 'kairo-sourcing'), every configured marketplace in turn. */
export async function POST(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: "Missing CRON_SECRET" }, { status: 500, headers: NO_STORE });
  if (!isAuthorizedCronRequest(request.headers, secret)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401, headers: NO_STORE });
  }
  const marketplaces = configuredMarketplaces();
  if (marketplaces.length === 0) return NextResponse.json({ skipped: "not_configured" }, { headers: NO_STORE });

  const admin = createAdminClient();
  const owner = randomUUID();
  const { data: acquired, error } = await admin.rpc("try_acquire_job_lock", { p_name: "sourcing", p_owner: owner, p_ttl_seconds: 600 });
  if (error) throw new Error(`Failed to acquire lock: ${error.message}`);
  if (!acquired) return NextResponse.json({ skipped: "locked" }, { headers: NO_STORE });

  const overallDeadline = Date.now() + 50_000;
  const results: Record<string, SourcingResult | { error: string }> = {};
  try {
    for (const [i, m] of marketplaces.entries()) {
      // Each marketplace gets an equal share of the time still left, so the first cannot starve the rest.
      const deadline = Date.now() + (overallDeadline - Date.now()) / (marketplaces.length - i);
      try {
        results[m] = await runSourcing({ marketplace: m, deadline }, supabaseSourcingDeps(admin, m));
      } catch (err) {
        reportError(err, { job: "sourcing", marketplace: m });
        results[m] = { error: "failed" };
      }
    }
    return NextResponse.json(results, { headers: NO_STORE });
  } finally {
    await admin.rpc("release_job_lock", { p_name: "sourcing", p_owner: owner });
  }
}

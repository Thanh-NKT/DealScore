import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { assessHealth } from "@/lib/health";
import { configuredMarketplaces } from "@/lib/marketplaces/sources";

/**
 * Uptime check (1.10). Public, never says why something failed. 503 only when the DB is
 * unreachable; a late collector returns 200 with status "degraded" (use a keyword check).
 */
export async function GET() {
  let dbOk = true;
  let lastRunFinishedAt: string | null = null;
  try {
    const { data, error } = await createAdminClient()
      .from("collector_runs")
      .select("finished_at")
      .not("finished_at", "is", null)
      .order("finished_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    lastRunFinishedAt = data?.finished_at ?? null;
  } catch (err) {
    console.error("health: DB check failed", err);
    dbOk = false;
  }

  const health = assessHealth({ dbOk, collectorConfigured: configuredMarketplaces().length > 0, lastRunFinishedAt, now: new Date() });
  return NextResponse.json(health, {
    status: health.status === "down" ? 503 : 200,
    headers: { "Cache-Control": "no-store" },
  });
}

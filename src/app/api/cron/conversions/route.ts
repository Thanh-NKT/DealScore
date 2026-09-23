import { randomUUID } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { isAuthorizedCronRequest } from "@/lib/cron";
import { createAdminClient } from "@/lib/supabase/admin";
import { createShopeeAffiliateClient, ShopeeAffiliateError } from "@/lib/affiliate/shopee-client";
import { pullConversions } from "@/lib/affiliate/import";

export const maxDuration = 60;
const NO_STORE = { "Cache-Control": "no-store" };

export async function POST(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: "Missing CRON_SECRET" }, { status: 500, headers: NO_STORE });
  if (!isAuthorizedCronRequest(request.headers, secret)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401, headers: NO_STORE });
  }

  const client = createShopeeAffiliateClient();
  if (!client) return NextResponse.json({ skipped: "not_configured" }, { headers: NO_STORE });

  const admin = createAdminClient();
  const owner = randomUUID();
  const { data: acquired, error } = await admin.rpc("try_acquire_job_lock", {
    p_name: "conversions",
    p_owner: owner,
    p_ttl_seconds: 600,
  });
  if (error) throw new Error(`Failed to acquire lock: ${error.message}`);
  if (!acquired) return NextResponse.json({ skipped: "locked" }, { headers: NO_STORE });

  try {
    const result = await pullConversions({ client, now: new Date(), deadline: Date.now() + 50_000 });
    return NextResponse.json(result, { headers: NO_STORE });
  } catch (err) {
    console.error("cron/conversions:", err instanceof Error ? err.message : err);
    const retryable = err instanceof ShopeeAffiliateError && err.retryable;
    return NextResponse.json({ error: retryable ? "upstream_unavailable" : "internal" }, {
      status: retryable ? 503 : 500,
      headers: NO_STORE,
    });
  } finally {
    await admin.rpc("release_job_lock", { p_name: "conversions", p_owner: owner });
  }
}

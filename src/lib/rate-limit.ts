import crypto from "crypto";
import { createAdminClient } from "@/lib/supabase/admin";

export type LookupOutcome = "resolved" | "ingested" | "rejected" | "error";

export interface RateLimitVerdict {
  allowed: boolean;
  reason?: "ip_hourly" | "user_hourly" | "global_daily";
  retryAfterSeconds?: number;
}

const DEV_SALT = "kairo_lookup_dev_salt";

export function hashIp(ip: string): string {
  const salt = process.env.LOOKUP_IP_SALT;
  // With a public default salt in the repo, IP hashes are reversible by brute force
  // (the IPv4 space is only 2^32). Production must have its own salt.
  if (!salt && process.env.NODE_ENV === "production") {
    throw new Error("Missing LOOKUP_IP_SALT");
  }
  return crypto.createHash("sha256").update(`${ip}_${salt || DEV_SALT}`).digest("hex");
}

/**
 * Client IP, used as the rate-limit key.
 *
 * DEPLOYMENT ASSUMPTION: the platform in front (Vercel) OVERWRITES x-real-ip /
 * x-forwarded-for, so clients cannot spoof them. When self-hosting behind another proxy,
 * configure it to overwrite both headers, otherwise every request picks its own
 * "IP" and the per-IP quota is void.
 */
export function clientIp(headers: Headers): string {
  const realIp = headers.get("x-real-ip")?.trim();
  if (realIp) return realIp;
  const forwarded = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || "unknown";
}

function retryAfter(reason: RateLimitVerdict["reason"]): number {
  // Sliding 1-hour / 1-day window: we don't know exactly when a slot frees up, so return
  // the upper bound to keep clients from retrying in a burst.
  return reason === "global_daily" ? 86_400 : 3_600;
}

/**
 * Start a lookup: check the anti-scraping quota (120/hour/IP) and write a
 * 'pending' row — atomically, in the DB. On DB error THROW, never let it through: a
 * rate limit that silently turns off opens the door to catalog scraping.
 */
export async function beginLookup(params: {
  ipHash: string;
  userId: string | null;
}): Promise<RateLimitVerdict & { requestId: number | null }> {
  const supabase = createAdminClient();
  const { data, error } = await supabase.rpc("lookup_begin", {
    p_ip_hash: params.ipHash,
    // The generated type doesn't know the uuid parameter accepts null.
    p_user_id: params.userId as string,
  });
  if (error) throw new Error(`lookup_begin failed: ${error.message}`);

  const row = data?.[0];
  if (!row) throw new Error("lookup_begin returned no result");
  if (!row.allowed) {
    const reason = row.reason as RateLimitVerdict["reason"];
    return { allowed: false, reason, retryAfterSeconds: retryAfter(reason), requestId: null };
  }
  return { allowed: true, requestId: row.request_id };
}

/**
 * Upgrade a lookup to a new ingest: check the ingest quota (guest 10/hour/IP,
 * user 60/hour, system-wide LOOKUP_DAILY_INGEST_CAP/day). Only call when the URL
 * is NOT yet in the catalog.
 */
export async function beginIngest(requestId: number): Promise<RateLimitVerdict> {
  const supabase = createAdminClient();
  const cap = parseInt(process.env.LOOKUP_DAILY_INGEST_CAP || "2000", 10);
  const { data, error } = await supabase.rpc("lookup_begin_ingest", {
    p_request_id: requestId,
    p_global_cap: Number.isFinite(cap) ? cap : 2000,
  });
  if (error) throw new Error(`lookup_begin_ingest failed: ${error.message}`);

  const row = data?.[0];
  if (!row) throw new Error("lookup_begin_ingest returned no result");
  if (!row.allowed) {
    const reason = row.reason as RateLimitVerdict["reason"];
    return { allowed: false, reason, retryAfterSeconds: retryAfter(reason) };
  }
  return { allowed: true };
}

/** Record the final outcome of a lookup. Errors are only logged — the user already has the result. */
export async function finishLookup(requestId: number, outcome: LookupOutcome): Promise<void> {
  const supabase = createAdminClient();
  const { error } = await supabase
    .from("lookup_requests")
    .update({ outcome })
    .eq("id", requestId);
  if (error) console.error("Could not record lookup_requests outcome:", error.message);
}

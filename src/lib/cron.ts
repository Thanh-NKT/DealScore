import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { isAuthorizedBearer } from "@/lib/bearer-auth";
import { reportError } from "@/lib/observability";

/** true when Authorization is exactly "Bearer ${secret}". Constant-time comparison. */
export function isAuthorizedCronRequest(headers: Headers, secret: string | undefined): boolean {
  return isAuthorizedBearer(headers, secret);
}

/**
 * Take a cron job lock. Returns the owner token, or null when another run holds it. A DB error is
 * reported (reportError) and thrown, so the route fails visibly instead of silently skipping.
 */
export async function acquireJobLock(
  client: SupabaseClient<Database>,
  name: string,
  ttlSeconds = 600,
): Promise<string | null> {
  const owner = randomUUID();
  const { data, error } = await client.rpc("try_acquire_job_lock", { p_name: name, p_owner: owner, p_ttl_seconds: ttlSeconds });
  if (error) {
    const err = new Error(`Failed to acquire lock: ${error.message}`);
    reportError(err, { job: name, where: "acquireJobLock" });
    throw err;
  }
  return data ? owner : null;
}

/** Release a lock taken by acquireJobLock. Never throws: the lock expires on its own (TTL). */
export async function releaseJobLock(client: SupabaseClient<Database>, name: string, owner: string): Promise<void> {
  try {
    const { error } = await client.rpc("release_job_lock", { p_name: name, p_owner: owner });
    if (error) reportError(new Error(`Failed to release lock: ${error.message}`), { job: name, where: "releaseJobLock" });
  } catch (err) {
    reportError(err, { job: name, where: "releaseJobLock" });
  }
}

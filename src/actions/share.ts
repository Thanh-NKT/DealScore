"use server";

import { headers } from "next/headers";
import { getCurrentUser } from "@/lib/auth/session";
import { trackAfter } from "@/lib/analytics/track";
import { SHARE_EVENTS_PER_HOUR } from "@/lib/analytics/events";
import { createAdminClient } from "@/lib/supabase/admin";
import { clientIp, hashIp } from "@/lib/rate-limit";

/**
 * Record that a deal was shared (Phase 2). Anonymous users count too; the product id is validated
 * by the analytics allow-list (a non-UUID is simply dropped).
 *
 * Callable by anyone, so it is throttled: a script cannot inflate metrics_* or grow
 * analytics_events. A throttle failure drops the event (losing one share count is harmless).
 */
export async function recordShare(productId: string, method: "native" | "copy"): Promise<void> {
  const user = await getCurrentUser().catch(() => null);
  try {
    const who = user ? `u:${user.id}` : `ip:${hashIp(clientIp(await headers()))}`;
    const { data: underLimit, error } = await createAdminClient().rpc("rate_hit", {
      p_key: `share:${who}`,
      p_window_seconds: 3600,
      p_limit: SHARE_EVENTS_PER_HOUR,
    });
    if (error) throw new Error(error.message);
    if (underLimit === false) return;
  } catch (err) {
    console.error("recordShare: throttle failed, event dropped:", err instanceof Error ? err.message : err);
    return;
  }
  trackAfter("deal_shared", { userId: user?.id ?? null, props: { product_id: productId, method } });
}

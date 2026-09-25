"use server";

import { getCurrentUser } from "@/lib/auth/session";
import { trackAfter } from "@/lib/analytics/track";

/**
 * Record that a deal was shared (Phase 2). Anonymous users count too; the product id is validated
 * by the analytics allow-list (a non-UUID is simply dropped).
 */
export async function recordShare(productId: string, method: "native" | "copy"): Promise<void> {
  const user = await getCurrentUser().catch(() => null);
  trackAfter("deal_shared", { userId: user?.id ?? null, props: { product_id: productId, method } });
}

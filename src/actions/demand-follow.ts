"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { searchProducts } from "@/lib/search";
import { resolveSearchParams } from "@/lib/search/resolve-params";
import { demandFollowOffer } from "@/lib/demand-follow/offer";
import { DEMAND_FOLLOW_TTL_DAYS } from "@/lib/demand-follow/constants";
import { configuredMarketplaces } from "@/lib/marketplaces/sources";
import { demandDailyCap } from "@/lib/sourcing/demand";
import { trackAfter } from "@/lib/analytics/track";
import { reportError } from "@/lib/observability";

export type FollowResult =
  | { ok: true; id: string; expiresAt: string }
  | { ok: false; error: "unauthenticated" | "not_eligible" | "limit" | "unavailable" };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * "Báo tôi khi có" (roadmap P4 F). Signed-in only, one click = one opt-in. The keyword is NEVER taken from the
 * form: the search is recomputed here (same intent step as /search) and the keyword is demandKeyword()'s output,
 * so only a cleaned keyword (no e-mail / phone / URL) is stored, with ≤ 3 product ids already found.
 */
export async function followDemand(input: { q: string; intent?: boolean }): Promise<FollowResult> {
  const user = await getCurrentUser().catch(() => null);
  if (!user) return { ok: false, error: "unauthenticated" };
  const q = typeof input?.q === "string" ? input.q.trim().slice(0, 200) : "";
  if (!q) return { ok: false, error: "not_eligible" };

  let keyword: string;
  let knownIds: string[];
  try {
    const { params, demandIntent } = await resolveSearchParams({
      q,
      sort: "relevance",
      page: 1,
      intent: input.intent === false ? false : undefined,
    });
    const result = await searchProducts({ ...params, page: 1 });
    const offer = demandFollowOffer({ q, total: result.total, page: 1, intent: demandIntent });
    if (!offer) return { ok: false, error: "not_eligible" };
    keyword = offer.keyword;
    knownIds = result.items.slice(0, 3).map((i) => i.productId);
  } catch (err) {
    reportError(err, { where: "follow_demand_search" });
    return { ok: false, error: "unavailable" };
  }

  const admin = createAdminClient();
  const expiresAt = new Date(Date.now() + DEMAND_FOLLOW_TTL_DAYS * 86_400_000).toISOString();
  const { data, error } = await admin
    .from("demand_follows")
    .upsert(
      {
        user_id: user.id,
        keyword,
        known_product_ids: knownIds,
        status: "waiting",
        expires_at: expiresAt,
        last_checked_at: null,
        found_at: null,
      },
      { onConflict: "user_id,keyword" },
    )
    .select("id, expires_at")
    .single();
  if (error || !data) {
    if (error?.code === "23514") return { ok: false, error: "limit" };
    reportError(new Error(`followDemand upsert failed: ${error?.message}`), { where: "follow_demand_upsert" });
    return { ok: false, error: "unavailable" };
  }

  // One more sourcing request for the keyword — the same call recordSearchDemand makes (keyword only).
  try {
    const marketplaces = configuredMarketplaces();
    const cap = demandDailyCap();
    if (marketplaces.length > 0 && cap > 0) {
      const { error: sErr } = await admin.rpc("request_sourcing_query", { p_value: keyword, p_marketplaces: marketplaces, p_daily_cap: cap });
      if (sErr) console.error("followDemand: request_sourcing_query failed:", sErr.message);
    }
  } catch (err) {
    console.error("followDemand: request_sourcing_query failed:", err instanceof Error ? err.message : err);
  }

  trackAfter("demand_followed", { userId: user.id });
  revalidatePath("/account/searches");
  return { ok: true, id: data.id, expiresAt: data.expires_at };
}

/** Cancel = delete the row (RLS: own rows only). */
export async function unfollowDemand(id: string): Promise<{ ok: boolean }> {
  const user = await getCurrentUser().catch(() => null);
  if (!user || typeof id !== "string" || !UUID_RE.test(id)) return { ok: false };
  const supabase = await createClient();
  const { error } = await supabase.from("demand_follows").delete().eq("id", id).eq("user_id", user.id);
  revalidatePath("/account/searches");
  return { ok: !error };
}

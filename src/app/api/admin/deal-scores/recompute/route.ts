import { NextResponse, type NextRequest } from "next/server";
import { adminAuthError, NO_STORE } from "@/lib/admin/api-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { reportError } from "@/lib/observability";
import { recomputeDealScores } from "@/lib/pricing/recompute-scores";

export const dynamic = "force-dynamic";
const MAX_IDS = 500;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Deal Score is computed in TypeScript: the admin app calls this after catalog RPCs. */
export async function POST(request: NextRequest) {
  const denied = adminAuthError(request.headers);
  if (denied) return denied;
  let ids: unknown;
  try {
    ids = (await request.json())?.variantIds;
  } catch {
    ids = null;
  }
  if (!Array.isArray(ids) || ids.length === 0 || ids.length > MAX_IDS || !ids.every((i) => typeof i === "string" && UUID.test(i))) {
    return NextResponse.json({ error: "bad_request" }, { status: 400, headers: NO_STORE });
  }
  try {
    const variantIds = ids as string[];
    const db = createAdminClient();
    const { scored } = await recomputeDealScores(db, { now: new Date(), variantIds });
    // A variant that lost its last visible offer has no current price: recompute skips it, so drop its old score.
    const { data: priced, error: pricedErr } = await db.from("variant_current_price").select("variant_id").in("variant_id", variantIds);
    if (pricedErr) throw pricedErr;
    const keep = new Set((priced ?? []).map((r) => r.variant_id));
    const stale = variantIds.filter((id) => !keep.has(id));
    if (stale.length) {
      const { error: delErr } = await db.from("variant_deal_scores").delete().in("variant_id", stale);
      if (delErr) throw delErr;
    }
    return NextResponse.json({ recomputed: scored }, { headers: NO_STORE });
  } catch (err) {
    reportError(err, { route: "admin.recompute" });
    return NextResponse.json({ error: "internal" }, { status: 500, headers: NO_STORE });
  }
}

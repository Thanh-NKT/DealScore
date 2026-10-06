import { NextResponse, type NextRequest } from "next/server";
import { adminAuthError, NO_STORE } from "@/lib/admin/api-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { reportError } from "@/lib/observability";
import { recomputeDealScores } from "@/lib/pricing/recompute-scores";

export const dynamic = "force-dynamic";
const MAX_IDS = 500;
/** ~7 KB of UUIDs per .in() list: 500 at once would put ~18 KB in one query string (proxy URL limits). */
const ID_CHUNK = 200;

function chunks<T>(xs: T[]): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += ID_CHUNK) out.push(xs.slice(i, i + ID_CHUNK));
  return out;
}
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
    const variantIds = [...new Set(ids as string[])];
    const db = createAdminClient();
    const { scored } = await recomputeDealScores(db, { now: new Date(), variantIds });
    // A variant that lost its last visible offer has no current price: recompute skips it, so drop its old score.
    const keep = new Set<string>();
    for (const part of chunks(variantIds)) {
      const { data: priced, error: pricedErr } = await db.from("variant_current_price").select("variant_id").in("variant_id", part);
      if (pricedErr) throw pricedErr;
      for (const r of priced ?? []) keep.add(r.variant_id);
    }
    const stale = variantIds.filter((id) => !keep.has(id));
    for (const part of chunks(stale)) {
      const { error: delErr } = await db.from("variant_deal_scores").delete().in("variant_id", part);
      if (delErr) throw delErr;
    }
    return NextResponse.json({ recomputed: scored }, { headers: NO_STORE });
  } catch (err) {
    reportError(err, { route: "admin.recompute" });
    return NextResponse.json({ error: "internal" }, { status: 500, headers: NO_STORE });
  }
}

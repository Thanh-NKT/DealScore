import { NextResponse, type NextRequest } from "next/server";
import { adminAuthError, NO_STORE } from "@/lib/admin/api-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { recomputeDealScores } from "@/lib/pricing/recompute-scores";

export const dynamic = "force-dynamic";
const MAX_IDS = 500;

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
  if (!Array.isArray(ids) || ids.length === 0 || ids.length > MAX_IDS || !ids.every((i) => typeof i === "string")) {
    return NextResponse.json({ error: "bad_request" }, { status: 400, headers: NO_STORE });
  }
  const { scored } = await recomputeDealScores(createAdminClient(), { now: new Date(), variantIds: ids as string[] });
  return NextResponse.json({ recomputed: scored }, { headers: NO_STORE });
}

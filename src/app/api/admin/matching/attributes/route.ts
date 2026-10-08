import { NextResponse, type NextRequest } from "next/server";
import { adminAuthError, NO_STORE } from "@/lib/admin/api-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { reportError } from "@/lib/observability";
import { loadAttributeTables } from "@/lib/matching/attribute-table";

export const dynamic = "force-dynamic";
const MAX_IDS = 50;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Admin /matches "Bảng thuộc tính A/B": ✓ / ✕ / ? per attribute for each candidate (computed on read with
 * the matcher's own helpers). `{ candidateIds: uuid[1..50] }` → `{ items: [{ candidateId, rows }] }`;
 * candidates that are gone or have no suggestion are left out.
 */
export async function POST(request: NextRequest) {
  const denied = adminAuthError(request.headers);
  if (denied) return denied;
  let ids: unknown;
  try {
    ids = (await request.json())?.candidateIds;
  } catch {
    ids = null;
  }
  if (!Array.isArray(ids) || ids.length === 0 || ids.length > MAX_IDS || !ids.every((i) => typeof i === "string" && UUID.test(i))) {
    return NextResponse.json({ error: "bad_request" }, { status: 400, headers: NO_STORE });
  }
  try {
    const items = await loadAttributeTables(createAdminClient(), ids as string[]);
    return NextResponse.json({ items }, { headers: NO_STORE });
  } catch (err) {
    reportError(err, { route: "admin.matching.attributes" });
    return NextResponse.json({ error: "internal" }, { status: 500, headers: NO_STORE });
  }
}

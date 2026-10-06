import type { NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { saveWatchForUser } from "@/lib/watch/queries";
import { gateUser } from "@/lib/auth/session";
import { extForbidden, extJson, extPreflight, extensionOriginAllowed } from "@/lib/extension/http";
import { trackAfter } from "@/lib/analytics/track";

export const dynamic = "force-dynamic";

export function OPTIONS(request: NextRequest) {
  return extPreflight(request);
}

/**
 * POST /api/extension/watch { variantId, targetPrice? } — create or update the signed-in user's
 * Watch from the extension panel, through the same saveWatchForUser() (RLS client) as the website.
 * 401 → the panel asks the user to sign in on DealScore. 403 → the account must accept the current terms
 * or is pending deletion: the same AuthGate as the website, which the panel sends to DealScore.
 */
export async function POST(request: NextRequest) {
  if (!extensionOriginAllowed(request)) return extForbidden(request);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return extJson(request, { error: "bad_request" }, 400);
  }
  const b = (body ?? {}) as { variantId?: unknown; targetPrice?: unknown };

  const supabase = await createClient();
  let gate;
  try {
    gate = await gateUser(supabase);
  } catch (err) {
    console.error("api/extension/watch failed:", err);
    return extJson(request, { error: "internal" }, 500);
  }
  if (gate.kind === "signed_out") return extJson(request, { error: "unauthorized" }, 401);
  if (gate.kind === "blocked") {
    return extJson(request, { error: gate.reason === "consent" ? "consent_required" : "pending_deletion" }, 403);
  }
  const userId = gate.userId;

  const form = new FormData();
  if (typeof b.variantId === "string") form.set("variantId", b.variantId);
  if (typeof b.targetPrice === "number" && Number.isFinite(b.targetPrice)) form.set("targetPrice", String(Math.round(b.targetPrice)));

  try {
    const result = await saveWatchForUser(supabase, userId, form);
    if (result.status === "error") return extJson(request, { error: "invalid", fields: result.errors }, 422);
    if (result.status === "saved" && result.created) {
      trackAfter("watch_created", {
        userId,
        props: { variant_id: result.variantId, condition_count: result.conditionCount },
      });
    }
    return extJson(request, result);
  } catch (err) {
    console.error("api/extension/watch failed:", err);
    return extJson(request, { error: "internal" }, 500);
  }
}

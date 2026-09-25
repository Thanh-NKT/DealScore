import type { NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { validateObservationPayload } from "@/lib/extension/payload";
import { recordContribution } from "@/lib/extension/contribute";
import { extForbidden, extJson, extPreflight, extensionOriginAllowed } from "@/lib/extension/http";
import { clientIp, hashIp } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 32_000;

export function OPTIONS(request: NextRequest) {
  return extPreflight(request);
}

/**
 * POST /api/extension/observations — prices the extension read on a Shopee page, sent only when
 * the user turned sharing on. Stored raw; they reach the price history only once corroborated
 * (src/lib/extension/corroborate.ts). 60 contributions / hour / contributor.
 */
export async function POST(request: NextRequest) {
  if (!extensionOriginAllowed(request)) return extForbidden(request);

  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) return extJson(request, { error: "too_large" }, 413);
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return extJson(request, { error: "bad_request" }, 400);
  }

  const now = new Date();
  const parsed = validateObservationPayload(body, now);
  if (!parsed.ok) return extJson(request, { error: "invalid", field: parsed.error }, 422);

  try {
    // Identity from the session (never from the body); anonymous contributors by salted IP hash.
    const { data: auth } = await (await createClient()).auth.getUser();
    const contributor = auth.user ? `u:${auth.user.id}` : `ip:${hashIp(clientIp(request.headers))}`;

    const admin = createAdminClient();
    const { data: quota, error: qErr } = await admin.rpc("extension_contribution_begin", { p_contributor: contributor });
    if (qErr) throw new Error(`extension_contribution_begin: ${qErr.message}`);
    const verdict = quota?.[0];
    if (!verdict?.allowed) {
      return extJson(request, { error: "rate_limited", retryAfter: verdict?.retry_after_seconds ?? 3600 }, 429);
    }

    const result = await recordContribution(admin, contributor, parsed.value, now);
    return extJson(request, result, result.status === "unknown_item" ? 202 : 200);
  } catch (err) {
    console.error("api/extension/observations failed:", err);
    return extJson(request, { error: "internal" }, 500);
  }
}

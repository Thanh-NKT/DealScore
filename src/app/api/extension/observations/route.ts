import type { NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { validateObservationPayload } from "@/lib/extension/payload";
import { recordContribution } from "@/lib/extension/contribute";
import { extForbidden, extJson, extPreflight, extensionOriginAllowed } from "@/lib/extension/http";
import { clientIp, hashIp, hashNetwork } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 32_000;

export function OPTIONS(request: NextRequest) {
  return extPreflight(request);
}

/**
 * POST /api/extension/observations — prices the extension read on a Shopee page, sent only when
 * the user turned sharing on. Stored raw; they reach the price history only once corroborated
 * (src/lib/extension/corroborate.ts). 60 contributions / hour / contributor.
 * Optional `vouchers` (≤ 20 labels, codes ignored) and `images` (≤ 12 CDN URLs) are validated in
 * payload.ts and saved via saveListingExtras(): vouchers need ≥ 2 reporters before they are shown,
 * images only fill a listing that has none.
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
    // The peer key is the salted hash of the NETWORK (IPv4 /24, IPv6 /64), also for signed-in users:
    // corroboration counts one network as one peer, so the same person with and without the account
    // cookie, or rotating addresses inside their own /64, cannot corroborate themselves.
    const { data: auth } = await (await createClient()).auth.getUser();
    const ip = clientIp(request.headers);
    const peerKey = hashNetwork(ip);
    const contributor = auth.user ? `u:${auth.user.id}` : `ip:${hashIp(ip)}`;

    const admin = createAdminClient();
    const { data: quota, error: qErr } = await admin.rpc("extension_contribution_begin", { p_contributor: contributor });
    if (qErr) throw new Error(`extension_contribution_begin: ${qErr.message}`);
    const verdict = quota?.[0];
    if (!verdict?.allowed) {
      return extJson(request, { error: "rate_limited", retryAfter: verdict?.retry_after_seconds ?? 3600 }, 429);
    }

    const result = await recordContribution(admin, { contributor, peerKey }, parsed.value, now);
    return extJson(request, result, result.status === "unknown_item" ? 202 : 200);
  } catch (err) {
    console.error("api/extension/observations failed:", err);
    return extJson(request, { error: "internal" }, 500);
  }
}

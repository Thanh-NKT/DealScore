import { NextResponse, type NextRequest } from "next/server";
import { adminAuthError, NO_STORE } from "@/lib/admin/api-auth";
import { tiktokConfig } from "@/lib/tiktok/config";
import { buildAuthorizeUrl, oauthStateKey, registerState, signState, STATE_TTL_MS } from "@/lib/tiktok/oauth";
import { createAdminClient } from "@/lib/supabase/admin";
import { siteUrl } from "@/lib/site-url";
import { reportError } from "@/lib/observability";

export const dynamic = "force-dynamic";

/**
 * One-time TikTok authorization link (same as `pnpm tiktok:authorize`). The state is signed with a key
 * derived from ADMIN_API_SECRET and its nonce is registered, so the link works once within 30 minutes.
 */
export async function POST(request: NextRequest) {
  const denied = adminAuthError(request.headers);
  if (denied) return denied;
  const cfg = tiktokConfig(process.env);
  const key = oauthStateKey(process.env);
  if (!cfg || !key) return NextResponse.json({ error: "tiktok_not_configured" }, { status: 409, headers: NO_STORE });
  const now = new Date();
  const state = signState(key, now);
  const admin = createAdminClient();
  try {
    await registerState(admin, state);
  } catch (err) {
    reportError(err, { where: "admin.tiktok.authorize-url" });
    return NextResponse.json({ error: "internal" }, { status: 500, headers: NO_STORE });
  }
  const url = buildAuthorizeUrl(cfg, state);
  // Never log the URL or the state.
  // An audit failure must not block the link.
  try {
    const { error } = await admin.rpc("admin_log", {
      p_action: "tiktok.authorize_link", p_entity: "marketplace", p_entity_id: "tiktok", p_before: null, p_after: null, p_note: "",
    });
    if (error) console.error("admin_log failed:", error.message);
  } catch (err) {
    console.error("admin_log failed:", err instanceof Error ? err.message : "unknown");
  }
  return NextResponse.json(
    { url, redirectUri: `${siteUrl().replace(/\/+$/, "")}/api/tiktok/oauth/callback`, expiresAt: new Date(now.getTime() + STATE_TTL_MS).toISOString() },
    { headers: NO_STORE },
  );
}

import { NextResponse, type NextRequest } from "next/server";
import { adminAuthError, NO_STORE } from "@/lib/admin/api-auth";
import { tiktokConfig } from "@/lib/tiktok/config";
import { buildAuthorizeUrl, signState, STATE_TTL_MS } from "@/lib/tiktok/oauth";
import { createAdminClient } from "@/lib/supabase/admin";
import { siteUrl } from "@/lib/site-url";

export const dynamic = "force-dynamic";

/** One-time TikTok authorization link (same as `pnpm tiktok:authorize`), state signed with CRON_SECRET. */
export async function POST(request: NextRequest) {
  const denied = adminAuthError(request.headers);
  if (denied) return denied;
  const cfg = tiktokConfig(process.env);
  const secret = process.env.CRON_SECRET;
  if (!cfg || !secret) return NextResponse.json({ error: "tiktok_not_configured" }, { status: 409, headers: NO_STORE });
  const now = new Date();
  const url = buildAuthorizeUrl(cfg, signState(secret, now));
  // Never log the URL or the state.
  // An audit failure must not block the link.
  try {
    const { error } = await createAdminClient().rpc("admin_log", {
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

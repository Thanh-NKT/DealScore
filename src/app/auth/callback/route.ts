import { redirect } from "next/navigation";
import { type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { safeNextPath } from "@/lib/auth/redirect";
import { oauthErrorCode } from "@/lib/auth/oauth";
import { redirectAfterLogin } from "@/lib/auth/session";
import { trackAfter } from "@/lib/analytics/track";

export const dynamic = "force-dynamic";

/**
 * Google OAuth return (Phase 2): exchange the PKCE code for a session, then the same AuthGate as
 * password sign-in (consent, soft-deleted accounts). Failures go back to /login with a known code —
 * never the provider's raw message.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const next = safeNextPath(searchParams.get("next"), "/");
  const code = searchParams.get("code");
  const fail = (c: string) => redirect(`/login?error=${c}&next=${encodeURIComponent(next)}`);

  if (!code) fail(oauthErrorCode(searchParams.get("error")));

  const supabase = await createClient();
  const { data, error } = await supabase.auth.exchangeCodeForSession(code!);
  if (error || !data.user) {
    console.error("auth/callback: exchangeCodeForSession failed:", error?.message);
    fail("oauth_failed");
  }

  trackAfter("login_succeeded", { userId: data.user!.id });
  await redirectAfterLogin(supabase, data.user!.id, next);
}

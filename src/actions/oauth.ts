"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { safeNextPath } from "@/lib/auth/redirect";
import { isGoogleAuthEnabled, oauthCallbackUrl } from "@/lib/auth/oauth";

/**
 * Start Google sign-in. The server client stores the PKCE verifier in a cookie on THIS browser,
 * and /auth/callback exchanges the code in the same browser — unlike email links, the OAuth round
 * trip never leaves it, so PKCE is safe here (see decision T4 in the account spec).
 */
export async function signInWithGoogle(form: FormData): Promise<void> {
  const next = safeNextPath(form.get("next") as string | null, "/");
  if (!isGoogleAuthEnabled()) redirect(`/login?error=oauth_failed&next=${encodeURIComponent(next)}`);

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: oauthCallbackUrl(next), queryParams: { prompt: "select_account" } },
  });
  if (error || !data.url) {
    console.error("signInWithGoogle failed:", error?.message);
    redirect(`/login?error=oauth_failed&next=${encodeURIComponent(next)}`);
  }
  redirect(data.url);
}

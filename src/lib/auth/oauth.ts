/**
 * Google sign-in (Phase 2). Off until the Google OAuth client is configured in Supabase
 * (supabase/README.md); NEXT_PUBLIC_GOOGLE_AUTH=1 then shows the button.
 */
import { siteUrl } from "@/lib/site-url";

export function isGoogleAuthEnabled(): boolean {
  return process.env.NEXT_PUBLIC_GOOGLE_AUTH === "1";
}

/** Where Supabase sends the browser back after Google, carrying the PKCE `code`. */
export function oauthCallbackUrl(next: string): string {
  return `${siteUrl()}/auth/callback?next=${encodeURIComponent(next)}`;
}

/**
 * The provider's `error` query param → our error code. Google sends `access_denied` when the user
 * closes or refuses the consent screen; everything else is a failure.
 */
export function oauthErrorCode(providerError: string | null): "oauth_cancelled" | "oauth_failed" {
  return providerError === "access_denied" ? "oauth_cancelled" : "oauth_failed";
}

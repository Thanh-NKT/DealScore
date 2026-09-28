import { redirect } from "next/navigation";
import { type NextRequest } from "next/server";
import { type EmailOtpType } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { mapAuthError } from "@/lib/auth/errors";
import { safeNextPath } from "@/lib/auth/redirect";
import { trackAfter } from "@/lib/analytics/track";
import { redirectAfterLogin } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

const ALLOWED_TYPES: EmailOtpType[] = ["email", "signup", "recovery"];

/** Where to send the user when the link fails: a fresh reset request, or the login page. */
function failureUrl(type: EmailOtpType | null, code: string, next: string): string {
  if (type === "recovery") return `/forgot-password?error=${encodeURIComponent(code)}`;
  return `/login?error=${encodeURIComponent(code)}&next=${encodeURIComponent(next)}`;
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const token_hash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const next = safeNextPath(searchParams.get("next"), "/");

  if (!token_hash || !type || !ALLOWED_TYPES.includes(type)) {
    redirect(failureUrl(type, "link_expired", next));
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.verifyOtp({ token_hash, type });

  if (error || !data.user) {
    // Unknown 4xx on a link almost always means expired or already used.
    const { code } = mapAuthError(error ?? {});
    redirect(failureUrl(type, code === "internal" ? "link_expired" : code, next));
  }

  // Recovery skips the AuthGate: the new password comes first, updatePassword runs the gate after.
  if (type === "recovery") redirect("/reset-password");
  // type email/signup = the address was just confirmed: the account is now usable.
  trackAfter("signup_completed", { userId: data.user.id });

  await redirectAfterLogin(supabase, data.user.id, next);
}

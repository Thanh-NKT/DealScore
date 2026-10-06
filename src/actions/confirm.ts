"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { mapAuthError } from "@/lib/auth/errors";
import { confirmFailureUrl, parseConfirmParams } from "@/lib/auth/confirm";
import { redirectAfterLogin } from "@/lib/auth/session";
import { trackAfter } from "@/lib/analytics/track";

/**
 * The "Xác nhận" button on /auth/confirm. Uses the email token (POST only, so link scanners that
 * open the link with GET cannot burn it). A Server Action: Next checks the Origin, and without
 * JavaScript the redirect is a 303.
 */
export async function confirmEmailLink(form: FormData): Promise<void> {
  const parsed = parseConfirmParams({
    token_hash: form.get("token_hash") as string | null,
    type: form.get("type") as string | null,
    next: form.get("next") as string | null,
  });
  if (!parsed.ok) redirect(confirmFailureUrl(parsed.type, "link_expired", parsed.next));
  const { tokenHash, type, next } = parsed.params;

  const supabase = await createClient();
  const { data, error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type });

  if (error || !data.user) {
    // Unknown 4xx on a link almost always means expired or already used.
    const { code } = mapAuthError(error ?? {});
    redirect(confirmFailureUrl(type, code === "internal" ? "link_expired" : code, next));
  }

  // Recovery skips the AuthGate: the new password comes first, updatePassword runs the gate after.
  if (type === "recovery") redirect("/reset-password");
  // type email/signup = the address was just confirmed: the account is now usable.
  trackAfter("signup_completed", { userId: data.user.id });

  await redirectAfterLogin(supabase, data.user.id, next);
}

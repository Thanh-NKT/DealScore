"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import {
  AUTH_MESSAGES,
  authError,
  isValidEmail,
  mapAuthError,
  normalizeEmail,
  type AuthErrorInfo,
} from "@/lib/auth/errors";
import { PASSWORD_MESSAGES, passwordProblem } from "@/lib/auth/password";
import { safeNextPath } from "@/lib/auth/redirect";
import { redirectAfterLogin } from "@/lib/auth/session";
import { trackAfter } from "@/lib/analytics/track";
import { siteUrl } from "@/lib/site-url";

export type FieldErrors = Partial<Record<"email" | "password" | "confirm", string>>;

/** Never carries the password back to the client. */
export type AuthFormState =
  | { status: "idle" }
  | { status: "error"; error?: AuthErrorInfo; fields?: FieldErrors; email: string; next: string }
  | { status: "check_email"; email: string; next: string };

const EMAIL_MISSING = "Nhập email của bạn.";
const EMAIL_INVALID = "Email chưa đúng định dạng, ví dụ ten@gmail.com.";

function readForm(form: FormData) {
  return {
    email: normalizeEmail(String(form.get("email") ?? "")),
    password: String(form.get("password") ?? ""),
    confirm: String(form.get("confirm") ?? ""),
    next: safeNextPath(form.get("next") as string | null, "/"),
  };
}

function emailProblem(email: string): string | undefined {
  if (!email) return EMAIL_MISSING;
  if (!isValidEmail(email)) return EMAIL_INVALID;
}

function confirmRedirect(next: string): string {
  return `${siteUrl()}/auth/confirm?next=${encodeURIComponent(next)}`;
}

export async function signIn(_prev: AuthFormState, form: FormData): Promise<AuthFormState> {
  const { email, password, next } = readForm(form);

  // Only presence is checked: rules may change, old passwords must still sign in.
  const fields: FieldErrors = {};
  const emailErr = emailProblem(email);
  if (emailErr) fields.email = emailErr;
  if (!password) fields.password = PASSWORD_MESSAGES.empty;
  if (fields.email || fields.password) return { status: "error", fields, email, next };

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error || !data.user) {
    return { status: "error", error: mapAuthError(error ?? {}), email, next };
  }

  trackAfter("login_succeeded", { userId: data.user.id });
  return redirectAfterLogin(supabase, data.user.id, next);
}

export async function signUp(_prev: AuthFormState, form: FormData): Promise<AuthFormState> {
  const { email, password, confirm, next } = readForm(form);

  const fields: FieldErrors = {};
  const emailErr = emailProblem(email);
  if (emailErr) fields.email = emailErr;
  const pwProblem = passwordProblem(password, email);
  if (pwProblem) fields.password = PASSWORD_MESSAGES[pwProblem];
  if (password !== confirm) fields.confirm = AUTH_MESSAGES.password_mismatch;
  if (fields.email || fields.password || fields.confirm) return { status: "error", fields, email, next };

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { emailRedirectTo: confirmRedirect(next) },
  });
  if (error) return { status: "error", error: mapAuthError(error), email, next };

  // Confirmations switched off by mistake: the user is already signed in.
  if (data.session && data.user) return redirectAfterLogin(supabase, data.user.id, next);

  // Same answer whether or not the email already had an account (no enumeration).
  return { status: "check_email", email, next };
}

export async function resendConfirmation(_prev: AuthFormState, form: FormData): Promise<AuthFormState> {
  const { email, next } = readForm(form);
  const emailErr = emailProblem(email);
  if (emailErr) return { status: "error", fields: { email: emailErr }, email, next };

  const supabase = await createClient();
  const { error } = await supabase.auth.resend({
    type: "signup",
    email,
    options: { emailRedirectTo: confirmRedirect(next) },
  });
  if (error) return { status: "error", error: mapAuthError(error), email, next };
  return { status: "check_email", email, next };
}

export async function requestPasswordReset(_prev: AuthFormState, form: FormData): Promise<AuthFormState> {
  const { email } = readForm(form);
  const next = "/";
  const emailErr = emailProblem(email);
  if (emailErr) return { status: "error", fields: { email: emailErr }, email, next };

  const supabase = await createClient();
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: confirmRedirect("/reset-password"),
  });
  if (error) {
    const mapped = mapAuthError(error);
    // Anything else would reveal whether the email has an account.
    if (mapped.code === "rate_limited" || mapped.code === "invalid_email" || mapped.code === "send_failed") {
      return { status: "error", error: mapped, email, next };
    }
  }
  return { status: "check_email", email, next };
}

export async function updatePassword(_prev: AuthFormState, form: FormData): Promise<AuthFormState> {
  const { password, confirm } = readForm(form);

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/forgot-password?error=link_expired");

  const email = user.email ?? "";
  const next = "/account";
  const fields: FieldErrors = {};
  const pwProblem = passwordProblem(password, email);
  if (pwProblem) fields.password = PASSWORD_MESSAGES[pwProblem];
  if (password !== confirm) fields.confirm = AUTH_MESSAGES.password_mismatch;
  if (fields.password || fields.confirm) return { status: "error", fields, email, next };

  const { error } = await supabase.auth.updateUser({ password });
  if (error) {
    // A 401/403 here means the recovery session is gone.
    const expired = error.status === 401 || error.status === 403;
    return { status: "error", error: expired ? authError("link_expired") : mapAuthError(error), email, next };
  }

  return redirectAfterLogin(supabase, user.id, next);
}

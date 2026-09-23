"use server";

import { createClient } from "@/lib/supabase/server";
import {
  isValidEmail,
  mapAuthError,
  normalizeEmail,
  type AuthErrorInfo,
} from "@/lib/auth/errors";
import { safeNextPath } from "@/lib/auth/redirect";
import { redirectAfterLogin } from "@/lib/auth/session";
import { siteUrl } from "@/lib/site-url";

export type LoginState =
  | { status: "idle" }
  | { status: "sent"; email: string; next: string }
  | { status: "error"; error: AuthErrorInfo; email: string; next: string };

export async function requestLoginCode(
  prev: LoginState,
  form: FormData,
): Promise<LoginState> {
  const rawEmail = form.get("email") as string | null;
  const rawNext = form.get("next") as string | null;

  const next = safeNextPath(rawNext, "/");
  const email = normalizeEmail(rawEmail ?? "");

  if (!isValidEmail(email)) {
    return {
      status: "error",
      error: {
        code: "invalid_email",
        message: "Vui lòng nhập địa chỉ email hợp lệ.",
      },
      email,
      next,
    };
  }

  const supabase = await createClient();

  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: {
      shouldCreateUser: true,
      emailRedirectTo: `${siteUrl()}/auth/confirm?next=${encodeURIComponent(next)}`,
    },
  });

  if (error) {
    return {
      status: "error",
      error: mapAuthError(error, "send"),
      email,
      next,
    };
  }

  return {
    status: "sent",
    email,
    next,
  };
}

export async function verifyLoginCode(
  prev: LoginState,
  form: FormData,
): Promise<LoginState> {
  const rawEmail = form.get("email") as string | null;
  const rawToken = form.get("token") as string | null;
  const rawNext = form.get("next") as string | null;

  const email = normalizeEmail(rawEmail ?? "");
  const next = safeNextPath(rawNext, "/");
  const token = (rawToken ?? "").trim();

  // OTP code must be exactly 6 digits
  if (!/^\d{6}$/.test(token)) {
    return {
      status: "error",
      error: {
        code: "otp_invalid",
        message: "Mã xác nhận phải gồm đúng 6 chữ số.",
      },
      email,
      next,
    };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.verifyOtp({
    email,
    token,
    type: "email",
  });

  if (error || !data.user) {
    return {
      status: "error",
      error: mapAuthError(error ?? {}, "verify"),
      email,
      next,
    };
  }

  // Redirect after a successful sign-in (AuthGate)
  // Outside the try: redirect() throws a navigation error.
  return redirectAfterLogin(supabase, data.user.id, next);
}

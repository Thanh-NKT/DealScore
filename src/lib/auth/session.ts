import { redirect } from "next/navigation";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { createClient } from "@/lib/supabase/server";
import { decideAuthGate, safeNextPath } from "@/lib/auth/redirect";

export interface CurrentUser {
  id: string;
  email: string | null;
  consentVersion: string | null;
  marketingOptIn: boolean;
  deletedAt: string | null;
}

/**
 * Current user from the server session (cookies).
 * Returns null when not signed in.
 * Throws if an auth.user exists but its public.users profile cannot be read.
 */
export async function getCurrentUser(): Promise<CurrentUser | null> {
  const supabase = await createClient();

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return null;
  }

  const { data: profile, error: profileError } = await supabase
    .from("users")
    .select("id, email, consent_version, marketing_opt_in, deleted_at")
    .eq("id", user.id)
    .single();

  if (profileError || !profile) {
    throw new Error(
      `Could not load user profile ${user.id}: ${profileError?.message ?? "profile does not exist"}`,
    );
  }

  return {
    id: profile.id,
    email: profile.email,
    consentVersion: profile.consent_version,
    marketingOptIn: profile.marketing_opt_in,
    deletedAt: profile.deleted_at,
  };
}

/**
 * Requires the user to be signed in and pass every AuthGate check.
 * Otherwise redirect()s to the matching gate automatically.
 */
export async function requireUser(opts: {
  path?: string;
  allowPendingDeletion?: boolean;
  allowMissingConsent?: boolean;
} = {}): Promise<CurrentUser> {
  const path = opts.path ?? "/";
  const user = await getCurrentUser();

  const gate = decideAuthGate({
    userId: user?.id ?? null,
    profile: user
      ? {
          consentVersion: user.consentVersion,
          deletedAt: user.deletedAt,
        }
      : null,
    path,
    allowPendingDeletion: opts.allowPendingDeletion,
    allowMissingConsent: opts.allowMissingConsent,
  });

  if (gate.kind === "ok") {
    return user!;
  }

  redirect(gate.to);
}

export type GatedUser =
  | { kind: "ok"; userId: string }
  | { kind: "signed_out" }
  /** Signed in, but the AuthGate would send them to consent or restore first. */
  | { kind: "blocked"; reason: "consent" | "restore" };

/**
 * The AuthGate without a redirect, for API routes and Server Actions that answer with a status
 * or an error instead of a page (the extension, form actions). Same rules as requireUser().
 */
export async function gateUser(supabase: SupabaseClient<Database>): Promise<GatedUser> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { kind: "signed_out" };

  const { data: profile, error } = await supabase
    .from("users")
    .select("consent_version, deleted_at")
    .eq("id", user.id)
    .maybeSingle();
  if (error) throw new Error(`Could not load user profile ${user.id}: ${error.message}`);

  const gate = decideAuthGate({
    userId: user.id,
    profile: profile ? { consentVersion: profile.consent_version, deletedAt: profile.deleted_at } : null,
    path: "/",
  });
  if (gate.kind === "ok") return { kind: "ok", userId: user.id };
  if (gate.kind === "login") return { kind: "signed_out" };
  return { kind: "blocked", reason: gate.kind };
}

/**
 * Route the user after a successful OTP verification.
 * Checks whether the account is pending deletion or needs consent before going to `next`.
 *
 * Uses the SAME client that called verifyOtp: the new session written to cookies in this
 * request is not guaranteed to be visible to another createClient() — the user who just
 * signed in would then be treated as signed out.
 */
export async function redirectAfterLogin(
  supabase: SupabaseClient<Database>,
  userId: string,
  next: string,
): Promise<never> {
  const safeNext = safeNextPath(next, "/");

  const { data: profile, error } = await supabase
    .from("users")
    .select("consent_version, deleted_at")
    .eq("id", userId)
    .maybeSingle();
  if (error) throw new Error(`Could not load user profile ${userId}: ${error.message}`);

  const gate = decideAuthGate({
    userId,
    profile: profile ? { consentVersion: profile.consent_version, deletedAt: profile.deleted_at } : null,
    path: safeNext,
  });

  if (gate.kind === "ok") {
    redirect(safeNext);
  } else {
    redirect(gate.to);
  }
}

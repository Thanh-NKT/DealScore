import { needsConsent } from "@/lib/account/consent";

/**
 * Safe internal path to return to after login.
 * Prevents open redirects. Invalid → returns the fallback.
 */
export function safeNextPath(
  raw: string | null | undefined,
  fallback: string = "/",
): string {
  if (!raw || typeof raw !== "string") {
    return fallback;
  }

  const trimmed = raw.trim();
  if (
    !trimmed.startsWith("/") ||
    trimmed.startsWith("//") ||
    trimmed.startsWith("/\\")
  ) {
    return fallback;
  }

  // Reject control characters (ASCII 0-31 or 127)
  if (/[\x00-\x1F\x7F]/.test(trimmed)) {
    return fallback;
  }

  try {
    const url = new URL(trimmed, "http://dealscore.invalid");
    if (url.origin !== "http://dealscore.invalid") {
      return fallback;
    }

    // Never redirect back into the login or auth flow (loop)
    const pathname = url.pathname;
    if (
      pathname === "/login" ||
      pathname === "/dang-nhap" || // legacy URL, 308-redirects to /login
      pathname === "/register" ||
      pathname === "/forgot-password" ||
      pathname === "/reset-password" ||
      pathname.startsWith("/auth/")
    ) {
      return fallback;
    }

    // URL parsing removes dot segments and turns "\" into "/", so "/.//evil.com" or
    // "/%2e//evil.com" normalize to the protocol-relative "//evil.com". Check the
    // normalized result again, not only the raw input.
    const out = `${pathname}${url.search}${url.hash}`;
    if (out.startsWith("//") || out.startsWith("/\\")) {
      return fallback;
    }
    return out;
  } catch {
    return fallback;
  }
}

export type AuthGate =
  | { kind: "ok" }
  | { kind: "login"; to: string } // /login?next=…
  | { kind: "consent"; to: string } // /account/consent?next=…
  | { kind: "restore"; to: string }; // /account/restore

export function decideAuthGate(input: {
  userId: string | null;
  profile: { consentVersion: string | null; deletedAt: string | null } | null;
  path: string;
  allowPendingDeletion?: boolean;
  allowMissingConsent?: boolean;
}): AuthGate {
  const {
    userId,
    profile,
    path,
    allowPendingDeletion = false,
    allowMissingConsent = false,
  } = input;

  // 1. Not signed in → login
  if (!userId) {
    const safePath = safeNextPath(path, "/");
    return {
      kind: "login",
      to: `/login?next=${encodeURIComponent(safePath)}`,
    };
  }

  // 2. Null profile → infrastructure error (the trigger must always create one)
  if (!profile) {
    throw new Error(`User profile not found for ID: ${userId}`);
  }

  // 3. Pending deletion (deletedAt != null) and not allowed → restore
  if (profile.deletedAt && !allowPendingDeletion) {
    return { kind: "restore", to: "/account/restore" };
  }

  // 4. Needs to accept new/first-time terms and skipping is not allowed → consent
  if (needsConsent(profile.consentVersion) && !allowMissingConsent) {
    const safePath = safeNextPath(path, "/account");
    return {
      kind: "consent",
      to: `/account/consent?next=${encodeURIComponent(safePath)}`,
    };
  }

  // 5. Access granted
  return { kind: "ok" };
}

import type { Metadata } from "next";
import { safeNextPath } from "@/lib/auth/redirect";
import { AuthShell } from "@/components/auth/auth-shell";
import { AUTH_DOC_TITLE, AuthTabs } from "@/components/auth/auth-tabs";
import { isGoogleAuthEnabled } from "@/lib/auth/oauth";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: AUTH_DOC_TITLE.login };

interface LoginPageProps {
  searchParams: Promise<{ next?: string; error?: string }>;
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const { next: rawNext, error: rawError } = await searchParams;
  const next = safeNextPath(rawNext, "/");

  return (
    <AuthShell>
      <AuthTabs initialTab="login" next={next} loginError={rawError} googleEnabled={isGoogleAuthEnabled()} />
    </AuthShell>
  );
}

import type { Metadata } from "next";
import { safeNextPath } from "@/lib/auth/redirect";
import { AuthShell } from "@/components/auth/auth-shell";
import { AUTH_DOC_TITLE, AuthTabs } from "@/components/auth/auth-tabs";
import { isGoogleAuthEnabled } from "@/lib/auth/oauth";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: AUTH_DOC_TITLE.register };

export default async function RegisterPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next: rawNext } = await searchParams;
  const next = safeNextPath(rawNext, "/");

  return (
    <AuthShell>
      <AuthTabs initialTab="register" next={next} googleEnabled={isGoogleAuthEnabled()} />
    </AuthShell>
  );
}

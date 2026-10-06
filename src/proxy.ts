import { type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/proxy";
import { buildCsp, generateNonce } from "@/lib/security/headers";

// Next.js 16: the "proxy" convention (replaces the deprecated "middleware").
export async function proxy(request: NextRequest) {
  // Pages get a per-request nonce CSP. Next reads the nonce from the request's CSP header and
  // puts it on its own scripts. API routes return JSON (and serve the extension cross-origin):
  // they keep the static headers from next.config.ts only.
  const csp = request.nextUrl.pathname.startsWith("/api/")
    ? null
    : buildCsp({
        nonce: generateNonce(),
        dev: process.env.NODE_ENV === "development",
        supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
        sentryDsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
        upgradeInsecure: (process.env.NEXT_PUBLIC_SITE_URL ?? "").startsWith("https://"),
      });
  // Set on the request before updateSession, which forwards the request headers to the render.
  if (csp) request.headers.set("Content-Security-Policy", csp);

  const response = await updateSession(request);
  if (csp) response.headers.set("Content-Security-Policy", csp);
  return response;
}

export const config = {
  matcher: [
    /*
     * Applies to every request except:
     * - _next/static, _next/image
     * - favicon.ico, static image files
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};

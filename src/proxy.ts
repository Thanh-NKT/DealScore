import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/proxy";
import { buildCsp, generateNonce } from "@/lib/security/headers";
import { slugRedirectPath } from "@/lib/product/slug-redirect";
import { createSlugRedirectCache, loadAllSlugRedirects, productSlugCandidate } from "@/lib/product/slug-redirect-proxy";
import { createPublicClient } from "@/lib/supabase/public";

/** /shared/{43-char token} (roadmap P4 J): same format rule as isShareToken / shared_folder_view. */
const SHARED_PATH = /^\/shared\/([^/]*)\/?$/;
const SHARE_TOKEN = /^[A-Za-z0-9_-]{43}$/;

/**
 * Merged products' old slugs (0050 `product_slug_redirects`), per process, refreshed about every 5 minutes.
 * Cookie-less anon client: the table and the catalog are public-read, no session is involved.
 */
const slugRedirects = createSlugRedirectCache({
  load: () => loadAllSlugRedirects(createPublicClient()),
  onError: (err) => console.error("slug redirect cache load failed", err),
});

// Next.js 16: the "proxy" convention (replaces the deprecated "middleware").
export async function proxy(request: NextRequest) {
  // Shared folder links: a malformed / guessed token is a plain 404 before any render or DB call (the page
  // streams under the root loading boundary, so its own notFound() cannot change the status any more).
  const shared = request.nextUrl.pathname.match(SHARED_PATH);
  if (shared && !SHARE_TOKEN.test(shared[1])) {
    return new NextResponse("Not found", {
      status: 404,
      headers: { "X-Robots-Tag": "noindex, nofollow", "Referrer-Policy": "no-referrer", "Cache-Control": "no-store" },
    });
  }

  // A merged product's old URL: a real HTTP 308 before any render (the product page streams under a loading
  // boundary, so its own permanentRedirect can only redirect client-side). Only GET/HEAD on a two-segment path
  // that could be a product; a cache miss falls through to the page, which keeps a per-slug fallback lookup.
  if (request.method === "GET" || request.method === "HEAD") {
    const slug = productSlugCandidate(request.nextUrl.pathname);
    const row = slug ? await slugRedirects.lookup(slug) : null;
    if (row) {
      return NextResponse.redirect(new URL(slugRedirectPath(row, request.nextUrl.searchParams), request.url), 308);
    }
  }

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
  if (shared) {
    // The link is the secret: never indexed, never leaked through Referer, never cached by a shared cache.
    response.headers.set("X-Robots-Tag", "noindex, nofollow");
    response.headers.set("Referrer-Policy", "no-referrer");
    response.headers.set("Cache-Control", "private, no-store");
  }
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

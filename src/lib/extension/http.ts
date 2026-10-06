import { NextResponse } from "next/server";
import { isAllowedExtensionOrigin } from "@/lib/extension/payload";

/**
 * HTTP helpers for /api/extension/*. The extension calls from its service worker with the user's
 * DealScore cookie; only our extension's Origin is accepted, so no web page can use these endpoints
 * with that cookie. The Origin check is CSRF protection, NOT authentication: a script outside a
 * browser can forge it, so request bodies stay untrusted (see src/lib/extension/corroborate.ts).
 */

export function extensionOriginAllowed(request: Request): boolean {
  return isAllowedExtensionOrigin(request.headers.get("origin"), {
    ids: process.env.EXTENSION_IDS,
    production: process.env.NODE_ENV === "production",
  });
}

function corsHeaders(request: Request): Record<string, string> {
  const origin = request.headers.get("origin");
  return {
    "Cache-Control": "no-store",
    Vary: "Origin",
    ...(origin && extensionOriginAllowed(request)
      ? {
          "Access-Control-Allow-Origin": origin,
          "Access-Control-Allow-Credentials": "true",
          "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type",
        }
      : {}),
  };
}

export function extJson(request: Request, body: unknown, status = 200): NextResponse {
  return NextResponse.json(body, { status, headers: corsHeaders(request) });
}

export function extPreflight(request: Request): NextResponse {
  return new NextResponse(null, { status: extensionOriginAllowed(request) ? 204 : 403, headers: corsHeaders(request) });
}

export function extForbidden(request: Request): NextResponse {
  return extJson(request, { error: "forbidden" }, 403);
}

import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import type { Database } from "@/lib/database.types";

/**
 * Refresh the Supabase session on every request and sync cookies.
 * Called from src/proxy.ts.
 */
export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  // IMPORTANT: call getClaims() right after creating the client to refresh the token.
  // Do not add logic between createServerClient and getClaims().
  // getClaims (not getUser): it refreshes an expired session the same way, but verifies the JWT locally
  // against the cached JWKS when the project uses asymmetric signing keys — no Auth round trip on every
  // request. With legacy HS256 keys it falls back to getUser() itself. Pages still call getUser().
  await supabase.auth.getClaims();

  return supabaseResponse;
}

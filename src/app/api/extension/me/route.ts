import type { NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { extForbidden, extJson, extPreflight, extensionOriginAllowed } from "@/lib/extension/http";

export const dynamic = "force-dynamic";

export function OPTIONS(request: NextRequest) {
  return extPreflight(request);
}

/** GET /api/extension/me — only whether the user is signed in on Kairo (no email, no id). */
export async function GET(request: NextRequest) {
  if (!extensionOriginAllowed(request)) return extForbidden(request);
  const { data } = await (await createClient()).auth.getUser();
  return extJson(request, { signedIn: Boolean(data.user) });
}

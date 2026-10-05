import { NextResponse, type NextRequest } from "next/server";
import { adminAuthError, NO_STORE } from "@/lib/admin/api-auth";
import { MARKETPLACES } from "@/lib/marketplaces";
import { getSource } from "@/lib/marketplaces/sources";
import { siteUrl } from "@/lib/site-url";

export const dynamic = "force-dynamic";

/** Which marketplace sources this deployment has (env only lives here). Never returns secret values. */
export async function GET(request: NextRequest) {
  const denied = adminAuthError(request.headers);
  if (denied) return denied;
  const marketplaces = MARKETPLACES.map((m) => {
    const source = getSource(m.id);
    return {
      id: m.id,
      name: m.name,
      configured: source?.isConfigured() ?? false,
      fake: source?.isFake() ?? false,
      affiliateLinks: m.id === "shopee" ? Boolean(process.env.SHOPEE_AFFILIATE_ID) : false,
    };
  });
  return NextResponse.json({ marketplaces, cronSecretSet: Boolean(process.env.CRON_SECRET), siteUrl: siteUrl() }, { headers: NO_STORE });
}

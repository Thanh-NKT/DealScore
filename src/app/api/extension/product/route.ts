import type { NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { loadProductPageData } from "@/lib/product/page-data";
import { buildExtensionSummary, findCatalogVariant } from "@/lib/extension/product";
import { extForbidden, extJson, extPreflight, extensionOriginAllowed } from "@/lib/extension/http";
import { isShopeeItemId } from "@/lib/extension/payload";
import { getMyWatchForVariant } from "@/lib/watch/queries";
import { siteUrl } from "@/lib/site-url";

export const dynamic = "force-dynamic";

export function OPTIONS(request: NextRequest) {
  return extPreflight(request);
}

/**
 * GET /api/extension/product?marketplace=shopee&item=shopId_itemId[&model=name]
 * What DealScore knows about the product on the page the user is viewing, plus their Watch if signed in.
 * Not in the catalog → { found: false } (the panel offers to add it via /share-target).
 */
export async function GET(request: NextRequest) {
  if (!extensionOriginAllowed(request)) return extForbidden(request);
  const sp = request.nextUrl.searchParams;
  const item = sp.get("item");
  if (sp.get("marketplace") !== "shopee" || !isShopeeItemId(item)) return extJson(request, { error: "bad_request" }, 400);
  const model = sp.get("model")?.slice(0, 100) ?? null;

  try {
    const supabase = await createClient();
    const [{ data: auth }, found] = await Promise.all([
      supabase.auth.getUser(),
      findCatalogVariant(supabase, "shopee", item, model),
    ]);
    const signedIn = Boolean(auth.user);
    if (!found) return extJson(request, { found: false, signedIn });

    const data = await loadProductPageData({ productSlug: found.productSlug, variantId: found.variantId });
    if (!data) return extJson(request, { found: false, signedIn });

    const watch = auth.user ? await getMyWatchForVariant(auth.user.id, data.selectedVariantId).catch(() => null) : null;
    return extJson(request, {
      found: true,
      signedIn,
      summary: buildExtensionSummary(data, siteUrl()),
      watch: watch ? { id: watch.id, status: watch.status, targetPrice: watch.config.targetPrice } : null,
    });
  } catch (err) {
    console.error("api/extension/product failed:", err);
    return extJson(request, { error: "internal" }, 500);
  }
}

import type { MetadataRoute } from "next";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { buildSitemap } from "@/lib/seo/sitemap";
import { siteUrl } from "@/lib/site-url";

// Rebuilt at most once an hour: new verified products show up without a deploy.
export const revalidate = 3600;

const PAGE = 1000;

/** 1.7: verified products, categories and brands. Drafts are noindex and never listed. */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  // Public catalog data only: a cookie-less anon client (RLS applies) keeps this route cacheable.
  const supabase = createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );

  const products: Array<{ slug: string; categorySlug: string; updatedAt: string | null }> = [];
  // PostgREST silently truncates at 1000 rows: page through.
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from("products")
      .select("slug, categories ( slug )")
      .eq("status", "verified")
      .not("slug", "is", null)
      .not("category_id", "is", null)
      .order("slug")
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`sitemap: failed to read products: ${error.message}`);
    for (const p of data ?? []) {
      const cat = p.categories as { slug: string } | null;
      if (p.slug && cat?.slug) products.push({ slug: p.slug, categorySlug: cat.slug, updatedAt: null });
    }
    if (!data || data.length < PAGE) break;
  }

  const [catRes, brandRes] = await Promise.all([
    supabase.from("categories").select("slug").order("sort_order"),
    supabase.rpc("product_brands"),
  ]);
  if (catRes.error) throw new Error(`sitemap: failed to read categories: ${catRes.error.message}`);
  if (brandRes.error) throw new Error(`sitemap: failed to read brands: ${brandRes.error.message}`);

  return buildSitemap(
    {
      products,
      categories: catRes.data ?? [],
      brands: (brandRes.data ?? []).map((r) => r.brand).filter((b): b is string => Boolean(b)),
    },
    siteUrl(),
  );
}

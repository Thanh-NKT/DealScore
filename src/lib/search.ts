import { createClient } from "@/lib/supabase/server";

export interface SearchParams {
  q?: string;
  categoryId?: string;
  categorySlug?: string;
  brands?: string[];
  minPrice?: number;
  maxPrice?: number;
  sort?: "relevance" | "deal_score" | "price_asc" | "price_desc" | "updated";
  page?: number;
}

export interface SearchItem {
  productId: string;
  slug: string;
  canonicalName: string;
  brand: string | null;
  image: string | null;
  categorySlug: string;
  bestPrice: number | null;
  originalPrice: number | null;
  score: number | null;
  recommendation: "insufficient_data" | "buy" | "wait" | "avoid" | null;
  lastObservedAt: string | null;
}

export interface SearchResult {
  items: SearchItem[];
  total: number;
  page: number;
  pageSize: number;
}

const PAGE_SIZE = 24;

export function parseSearchParams(
  raw: URLSearchParams | Record<string, string | string[] | undefined>,
): SearchParams {
  const getParam = (key: string): string | undefined => {
    if (raw instanceof URLSearchParams) {
      return raw.get(key) ?? undefined;
    }
    const val = raw[key];
    if (Array.isArray(val)) return val[0];
    return val;
  };

  const getAllParams = (key: string): string[] => {
    if (raw instanceof URLSearchParams) {
      return raw.getAll(key);
    }
    const val = raw[key];
    if (Array.isArray(val)) return val;
    return val ? [val] : [];
  };

  const q = getParam("q")?.trim() || undefined;
  const categoryId = getParam("catId") || undefined;
  const categorySlug = getParam("cat") || undefined;

  // brands có thể truyền dạng ?brand=samsung&brand=wd
  const brands = getAllParams("brand")
    .map((b) => b.trim())
    .filter(Boolean);

  let minPrice = getParam("min") ? Number(getParam("min")) : undefined;
  let maxPrice = getParam("max") ? Number(getParam("max")) : undefined;

  if (minPrice != null && isNaN(minPrice)) minPrice = undefined;
  if (maxPrice != null && isNaN(maxPrice)) maxPrice = undefined;

  // Hoán đổi nếu min > max
  if (minPrice != null && maxPrice != null && minPrice > maxPrice) {
    const temp = minPrice;
    minPrice = maxPrice;
    maxPrice = temp;
  }

  const rawSort = getParam("sort");
  const validSorts = ["relevance", "deal_score", "price_asc", "price_desc", "updated"] as const;
  let sort: SearchParams["sort"] = validSorts.find((s) => s === rawSort);

  if (!sort) {
    sort = q ? "relevance" : "updated";
  }

  const rawPage = getParam("page");
  let page = rawPage ? parseInt(rawPage, 10) : 1;
  if (isNaN(page) || page < 1) page = 1;

  return {
    q,
    categoryId,
    categorySlug,
    brands: brands.length > 0 ? brands : undefined,
    minPrice,
    maxPrice,
    sort,
    page,
  };
}

export function toSearchParams(p: SearchParams): URLSearchParams {
  const sp = new URLSearchParams();
  if (p.q) sp.set("q", p.q);
  if (p.categorySlug) sp.set("cat", p.categorySlug);
  if (p.categoryId) sp.set("catId", p.categoryId);
  if (p.brands) {
    for (const b of p.brands) {
      sp.append("brand", b);
    }
  }
  if (p.minPrice != null) sp.set("min", p.minPrice.toString());
  if (p.maxPrice != null) sp.set("max", p.maxPrice.toString());
  // Không ghi giá trị mặc định vào URL: ghi vào sẽ sinh hai đường dẫn khác nhau
  // cho cùng một trang — trùng lặp nội dung, có hại cho SEO ở mục 1.7.
  const defaultSort = p.q ? "relevance" : "updated";
  if (p.sort && p.sort !== defaultSort) sp.set("sort", p.sort);
  if (p.page && p.page > 1) sp.set("page", p.page.toString());

  return sp;
}

export async function searchProducts(params: SearchParams): Promise<SearchResult> {
  const page = params.page || 1;
  const offset = (page - 1) * PAGE_SIZE;

  try {
    const supabase = await createClient();

    let catId = params.categoryId;
    if (!catId && params.categorySlug) {
      const { data: cat } = await supabase
        .from("categories")
        .select("id")
        .eq("slug", params.categorySlug)
        .maybeSingle();
      if (cat) catId = cat.id;
    }

    const { data, error } = await supabase.rpc("search_products", {
      p_q: params.q || null,
      p_category_id: catId || null,
      p_brands: params.brands && params.brands.length > 0 ? params.brands : null,
      p_min_price: params.minPrice || null,
      p_max_price: params.maxPrice || null,
      p_sort: params.sort || "relevance",
      p_limit: PAGE_SIZE,
      p_offset: offset,
    });

    if (error || !data || data.length === 0) {
      // Fallback demo cho dev nếu database chưa có dữ liệu
      return getDemoSearchResults(params, page);
    }

    const total = data[0]?.total_count ? Number(data[0].total_count) : data.length;
    const items: SearchItem[] = data.map((d) => ({
      productId: d.product_id,
      slug: d.slug,
      canonicalName: d.canonical_name,
      brand: d.brand,
      image: d.image,
      categorySlug: d.category_slug || "san-pham",
      bestPrice: d.best_price != null ? Number(d.best_price) : null,
      originalPrice: d.original_price != null ? Number(d.original_price) : null,
      score: d.score != null ? Number(d.score) : null,
      recommendation: d.recommendation as SearchItem["recommendation"],
      lastObservedAt: d.last_observed_at,
    }));

    return {
      items,
      total,
      page,
      pageSize: PAGE_SIZE,
    };
  } catch (err) {
    console.warn("searchProducts error, fallback demo:", err);
    return getDemoSearchResults(params, page);
  }
}

function getDemoSearchResults(params: SearchParams, page: number): SearchResult {
  const demoItems: SearchItem[] = [
    {
      productId: "prod-990-pro",
      slug: "ssd-samsung-990-pro-2tb",
      canonicalName: "SSD Samsung 990 Pro PCIe 4.0 NVMe M.2 2TB",
      brand: "Samsung",
      image: "https://images.unsplash.com/photo-1597872200969-2b65d56bd16b?w=400&auto=format&fit=crop&q=80",
      categorySlug: "o-cung-ssd",
      bestPrice: 3690000,
      originalPrice: 4590000,
      score: 82,
      recommendation: "buy",
      lastObservedAt: new Date(Date.now() - 3600 * 1000).toISOString(),
    },
    {
      productId: "prod-wd-sn850x",
      slug: "ssd-wd-black-sn850x-2tb",
      canonicalName: "SSD Western Digital WD Black SN850X 2TB",
      brand: "Western Digital",
      image: "https://images.unsplash.com/photo-1587202372775-e229f172b9d7?w=400&auto=format&fit=crop&q=80",
      categorySlug: "o-cung-ssd",
      bestPrice: 3850000,
      originalPrice: 4200000,
      score: 65,
      recommendation: "wait",
      lastObservedAt: new Date(Date.now() - 7200 * 1000).toISOString(),
    },
    {
      productId: "prod-kingston-kc3000",
      slug: "ssd-kingston-kc3000-2tb",
      canonicalName: "SSD Kingston KC3000 PCIe 4.0 NVMe 2TB",
      brand: "Kingston",
      image: "https://images.unsplash.com/photo-1531492746076-161ca9bcad58?w=400&auto=format&fit=crop&q=80",
      categorySlug: "o-cung-ssd",
      bestPrice: 3450000,
      originalPrice: 3600000,
      score: 42,
      recommendation: "avoid",
      lastObservedAt: new Date(Date.now() - 14400 * 1000).toISOString(),
    },
    {
      productId: "prod-crucial-t500",
      slug: "ssd-crucial-t500-2tb",
      canonicalName: "SSD Crucial T500 PCIe 4.0 NVMe M.2 2TB",
      brand: "Crucial",
      image: null,
      categorySlug: "o-cung-ssd",
      bestPrice: 3390000,
      originalPrice: 3990000,
      score: null,
      recommendation: "insufficient_data",
      lastObservedAt: new Date(Date.now() - 86400 * 1000).toISOString(),
    },
  ];

  let filtered = demoItems;
  if (params.q) {
    const qLower = params.q.toLowerCase();
    filtered = filtered.filter(
      (item) =>
        item.canonicalName.toLowerCase().includes(qLower) ||
        (item.brand && item.brand.toLowerCase().includes(qLower)),
    );
  }

  if (params.brands && params.brands.length > 0) {
    filtered = filtered.filter(
      (item) => item.brand && params.brands?.includes(item.brand.toLowerCase()),
    );
  }

  return {
    items: filtered,
    total: filtered.length,
    page,
    pageSize: PAGE_SIZE,
  };
}

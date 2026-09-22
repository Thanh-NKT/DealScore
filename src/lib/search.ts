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
    p_q: params.q ?? undefined,
    p_category_id: catId ?? undefined,
    p_brands: params.brands && params.brands.length > 0 ? params.brands : undefined,
    p_min_price: params.minPrice ?? undefined,
    p_max_price: params.maxPrice ?? undefined,
    p_sort: params.sort || "relevance",
    p_limit: PAGE_SIZE,
    p_offset: offset,
  });

  // KHÔNG nuốt lỗi và KHÔNG trả dữ liệu bịa. Với một sản phẩm tra giá, hiển thị
  // sản phẩm và giá không có thật là phá hỏng đúng thứ duy nhất khiến người
  // dùng tin nó. Lỗi phải nổi lên để trang hiện trạng thái lỗi thật.
  if (error) {
    throw new Error(`Tìm kiếm thất bại: ${error.message}`);
  }

  const rows = data ?? [];

  // Không có kết quả là trạng thái HỢP LỆ (1.1.b AC#6) — trang kết quả sẽ gợi ý
  // bỏ bớt filter và mời dán URL Shopee.
  const total = rows.length > 0 ? Number(rows[0].total_count) : 0;

  const items: SearchItem[] = rows.map((d) => ({
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

  return { items, total, page, pageSize: PAGE_SIZE };
}

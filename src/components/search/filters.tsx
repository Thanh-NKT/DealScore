import Link from "next/link";
import { toSearchParams, type SearchParams } from "@/lib/search";

interface FiltersProps {
  params: SearchParams;
  availableCategories?: Array<{ slug: string; name: string }>;
  availableBrands?: string[];
}

export function Filters({
  params,
  availableCategories = [
    { slug: "o-cung-ssd", name: "Ổ cứng SSD" },
    { slug: "ram-may-tinh", name: "RAM máy tính" },
    { slug: "ban-phim-co", name: "Bàn phím cơ" },
    { slug: "chuot-gaming", name: "Chuột Gaming" },
  ],
  availableBrands = ["Samsung", "Western Digital", "Kingston", "Crucial", "Logitech"],
}: FiltersProps) {
  // Helper tạo link thay đổi params
  const createFilterHref = (patch: Partial<SearchParams>) => {
    const updated: SearchParams = {
      ...params,
      ...patch,
      page: 1, // Đổi filter luôn reset về trang 1
    };
    const sp = toSearchParams(updated);
    return `/tim-kiem?${sp.toString()}`;
  };

  // Helper toggle brand
  const toggleBrandHref = (brand: string) => {
    const current = params.brands ? [...params.brands] : [];
    const brandLower = brand.toLowerCase();
    const existsIndex = current.findIndex((b) => b.toLowerCase() === brandLower);

    if (existsIndex >= 0) {
      current.splice(existsIndex, 1);
    } else {
      current.push(brandLower);
    }

    return createFilterHref({ brands: current });
  };

  return (
    <aside className="w-full space-y-6 md:w-64 shrink-0">
      {/* 1. Lọc theo Danh mục */}
      <div className="space-y-3">
        <h4 className="text-xs font-bold uppercase tracking-wider text-muted">
          Danh mục
        </h4>
        <div className="flex flex-col space-y-1 text-sm">
          <Link
            href={createFilterHref({ categorySlug: undefined, categoryId: undefined })}
            className={`rounded-lg px-2 py-1.5 transition-colors ${
              !params.categorySlug
                ? "bg-foreground text-background font-semibold"
                : "text-foreground hover:bg-black/5 dark:hover:bg-white/5"
            }`}
          >
            Tất cả danh mục
          </Link>
          {availableCategories.map((cat) => {
            const isSelected = params.categorySlug === cat.slug;
            return (
              <Link
                key={cat.slug}
                href={createFilterHref({ categorySlug: cat.slug, categoryId: undefined })}
                className={`rounded-lg px-2 py-1.5 transition-colors ${
                  isSelected
                    ? "bg-foreground text-background font-semibold"
                    : "text-foreground hover:bg-black/5 dark:hover:bg-white/5"
                }`}
              >
                {cat.name}
              </Link>
            );
          })}
        </div>
      </div>

      {/* 2. Lọc theo Thương hiệu (nhiều lựa chọn) */}
      <div className="space-y-3">
        <h4 className="text-xs font-bold uppercase tracking-wider text-muted">
          Thương hiệu
        </h4>
        <div className="flex flex-col space-y-1 text-sm">
          {availableBrands.map((brand) => {
            const isSelected =
              params.brands?.some((b) => b.toLowerCase() === brand.toLowerCase()) ?? false;
            return (
              <Link
                key={brand}
                href={toggleBrandHref(brand)}
                className={`flex items-center justify-between rounded-lg px-2 py-1.5 transition-colors ${
                  isSelected
                    ? "bg-black/10 dark:bg-white/10 font-semibold text-foreground"
                    : "text-foreground hover:bg-black/5 dark:hover:bg-white/5"
                }`}
              >
                <span>{brand}</span>
                {isSelected && <span className="text-xs font-bold">✓</span>}
              </Link>
            );
          })}
        </div>
      </div>

      {/* 3. Lọc theo Khoảng giá */}
      <div className="space-y-3">
        <h4 className="text-xs font-bold uppercase tracking-wider text-muted">
          Khoảng giá (₫)
        </h4>
        <form method="get" action="/tim-kiem" className="space-y-2">
          {params.q && <input type="hidden" name="q" value={params.q} />}
          {params.categorySlug && (
            <input type="hidden" name="cat" value={params.categorySlug} />
          )}
          {params.brands?.map((b) => (
            <input key={b} type="hidden" name="brand" value={b} />
          ))}
          {params.sort && <input type="hidden" name="sort" value={params.sort} />}

          <div className="flex items-center gap-2">
            <input
              type="number"
              name="min"
              defaultValue={params.minPrice ?? ""}
              placeholder="Từ"
              className="w-full rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs text-foreground outline-none"
            />
            <span className="text-xs text-muted">-</span>
            <input
              type="number"
              name="max"
              defaultValue={params.maxPrice ?? ""}
              placeholder="Đến"
              className="w-full rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs text-foreground outline-none"
            />
          </div>
          <button
            type="submit"
            className="w-full rounded-lg border border-foreground bg-foreground/5 py-1.5 text-xs font-semibold text-foreground hover:bg-foreground hover:text-background transition"
          >
            Áp dụng
          </button>
        </form>
      </div>
    </aside>
  );
}

export function ActiveFilterChips({ params }: { params: SearchParams }) {
  const hasActiveFilters =
    Boolean(params.categorySlug) ||
    Boolean(params.brands && params.brands.length > 0) ||
    params.minPrice != null ||
    params.maxPrice != null;

  if (!hasActiveFilters) {
    return null;
  }

  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      <span className="text-muted font-medium">Đang lọc:</span>

      {params.categorySlug && (
        <Link
          href={`/tim-kiem?${toSearchParams({
            ...params,
            categorySlug: undefined,
            page: 1,
          }).toString()}`}
          className="inline-flex items-center gap-1.5 rounded-full border border-border bg-black/5 px-2.5 py-1 dark:bg-white/5 text-foreground hover:border-foreground"
        >
          <span>Danh mục: {params.categorySlug}</span>
          <span className="font-bold">×</span>
        </Link>
      )}

      {params.brands?.map((b) => (
        <Link
          key={b}
          href={`/tim-kiem?${toSearchParams({
            ...params,
            brands: params.brands?.filter((item) => item !== b),
            page: 1,
          }).toString()}`}
          className="inline-flex items-center gap-1.5 rounded-full border border-border bg-black/5 px-2.5 py-1 dark:bg-white/5 text-foreground hover:border-foreground"
        >
          <span>Hãng: {b}</span>
          <span className="font-bold">×</span>
        </Link>
      ))}

      {(params.minPrice != null || params.maxPrice != null) && (
        <Link
          href={`/tim-kiem?${toSearchParams({
            ...params,
            minPrice: undefined,
            maxPrice: undefined,
            page: 1,
          }).toString()}`}
          className="inline-flex items-center gap-1.5 rounded-full border border-border bg-black/5 px-2.5 py-1 dark:bg-white/5 text-foreground hover:border-foreground"
        >
          <span>
            Giá: {params.minPrice?.toLocaleString("vi-VN") ?? "0"} -{" "}
            {params.maxPrice?.toLocaleString("vi-VN") ?? "∞"}
          </span>
          <span className="font-bold">×</span>
        </Link>
      )}

      <Link
        href={`/tim-kiem?${params.q ? `q=${encodeURIComponent(params.q)}` : ""}`}
        className="text-xs font-semibold text-rec-avoid hover:underline ml-2"
      >
        Xóa tất cả
      </Link>
    </div>
  );
}

export function SortSelect({ currentSort }: { currentSort?: string }) {
  const sort = currentSort || "relevance";

  return (
    <form method="get" className="flex items-center gap-2 text-xs">
      <label htmlFor="sort-select" className="text-muted font-medium whitespace-nowrap">
        Sắp xếp:
      </label>
      <select
        id="sort-select"
        name="sort"
        defaultValue={sort}
        // Có JS thì tự submit form khi đổi lựa chọn
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        onChange={(e: any) => e.target.form?.submit()}
        className="rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs text-foreground outline-none font-medium cursor-pointer"
      >
        <option value="relevance">Khớp nhất</option>
        <option value="deal_score">Deal Score cao nhất</option>
        <option value="price_asc">Giá tăng dần</option>
        <option value="price_desc">Giá giảm dần</option>
        <option value="updated">Mới cập nhật</option>
      </select>
      <noscript>
        <button
          type="submit"
          className="rounded-lg border border-border px-2 py-1 text-xs"
        >
          Lọc
        </button>
      </noscript>
    </form>
  );
}

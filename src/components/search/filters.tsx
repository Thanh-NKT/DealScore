import Link from "next/link";
import { MIN_RATINGS, toSearchParams, type AdvancedFilterAvailability, type SearchParams } from "@/lib/search";
import { formatVnd } from "@/lib/format";
import { CheckCircleIcon, CheckIcon, ChevronDownIcon } from "@/components/ui/icons";
import { marketplaceName, type MarketplaceId } from "@/lib/marketplaces";
import { PriceRangeForm } from "./price-range-form";
import { pillClass } from "@/components/ui/pill";
import type { IntentChipKind } from "@/lib/intent/types";
import { capacityLabel } from "@/lib/intent/parse";

interface FiltersProps {
  params: SearchParams;
  availableCategories: Array<{ slug: string; name: string }>;
  availableBrands: string[];
  advanced?: AdvancedFilterAvailability;
  /** Marketplaces with matched offers; the group only shows with ≥ 2 (PRODUCT.md). */
  availableMarketplaces?: MarketplaceId[];
}

const ratingText = (r: number) => r.toFixed(1).replace(".", ",");
const VISIBLE_OPTIONS = 8;

function href(params: SearchParams, patch: Partial<SearchParams>): string {
  const qs = toSearchParams({ ...params, ...patch, page: 1 }).toString();
  return qs ? `/search?${qs}` : "/search";
}

function clearHref(params: SearchParams): string {
  return params.q ? `/search?q=${encodeURIComponent(params.q)}` : "/search";
}

export function activeFilterCount(p: SearchParams): number {
  return (
    (p.categorySlug ? 1 : 0) +
    (p.brands?.length ?? 0) +
    (p.minPrice != null || p.maxPrice != null ? 1 : 0) +
    (p.capacityGb != null ? 1 : 0) +
    (p.minRating != null ? 1 : 0) +
    (p.freeShipping ? 1 : 0) +
    (p.hasVoucher ? 1 : 0) +
    (p.onlyBuy ? 1 : 0) +
    (p.marketplaces?.length ?? 0)
  );
}

function CrossIcon({ className = "size-3" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" aria-hidden="true" className={`shrink-0 ${className}`}>
      <path d="M18 6 6 18M6 6l12 12" />
    </svg>
  );
}

function Option({
  to,
  selected,
  children,
  multi = false,
  tone = "primary",
}: {
  to: string;
  selected: boolean;
  children: React.ReactNode;
  multi?: boolean;
  /** "buy": the "Chỉ hiện Nên mua" row uses the Nên mua green (DESIGN.md). */
  tone?: "primary" | "buy";
}) {
  const on = tone === "buy" ? "font-semibold text-buy" : "font-semibold text-primary";
  const box = tone === "buy" ? "border-buy bg-buy text-canvas" : "border-primary bg-primary text-on-primary";
  return (
    <Link
      href={to}
      scroll={false}
      aria-current={selected && !multi ? "true" : undefined}
      aria-pressed={multi ? selected : undefined}
      className={`-mx-2 flex min-h-10 items-center gap-2.5 rounded-sm px-2 text-body-sm text-ink transition-colors duration-150 ease-out hover:bg-surface-2 ${selected ? on : ""}`}
    >
      {multi ? (
        <span
          aria-hidden="true"
          className={`inline-grid size-4 shrink-0 place-items-center rounded-xs border-[1.5px] ${selected ? box : "border-line-strong bg-surface"}`}
        >
          {selected && <CheckIcon className="size-3" strokeWidth={3} />}
        </span>
      ) : (
        <span
          aria-hidden="true"
          className={`inline-grid size-4 shrink-0 place-items-center rounded-full border-[1.5px] bg-surface ${selected ? "border-primary" : "border-line-strong"}`}
        >
          {selected && <span className="size-2 rounded-full bg-primary" />}
        </span>
      )}
      <span className="min-w-0 flex-1 truncate">{children}</span>
    </Link>
  );
}

function Folded<T>({ items, isSelected, render, noun }: { items: T[]; isSelected: (t: T) => boolean; render: (t: T) => React.ReactNode; noun: string }) {
  const head = items.slice(0, VISIBLE_OPTIONS);
  const rest = items.slice(VISIBLE_OPTIONS);
  const pinned = rest.filter(isSelected);
  const folded = rest.filter((t) => !isSelected(t));
  return (
    <>
      {[...head, ...pinned].map(render)}
      {folded.length > 0 && (
        <details className="group/fold">
          <summary className="flex min-h-10 cursor-pointer list-none items-center gap-1 text-label font-semibold text-primary hover:text-primary-hover [&::-webkit-details-marker]:hidden">
            <span className="group-open/fold:hidden">
              Xem thêm {folded.length} {noun}
            </span>
            <span className="hidden group-open/fold:inline">Thu gọn</span>
            <ChevronDownIcon className="size-3.5 transition-transform duration-150 group-open/fold:rotate-180" />
          </summary>
          <div className="flex flex-col">{folded.map(render)}</div>
        </details>
      )}
    </>
  );
}

const GROUP_HEADING = "mb-2 text-body-sm font-bold text-ink";

function FilterBody({
  params,
  availableCategories,
  availableBrands,
  availableMarketplaces = [],
  idPrefix,
}: FiltersProps & { idPrefix: string }) {
  const selectedBrands = new Set((params.brands ?? []).map((b) => b.toLowerCase()));
  const toggleBrand = (brand: string) => {
    const current = params.brands ?? [];
    const next = selectedBrands.has(brand.toLowerCase())
      ? current.filter((b) => b.toLowerCase() !== brand.toLowerCase())
      : [...current, brand];
    return href(params, { brands: next.length > 0 ? next : undefined });
  };

  const selectedMarkets = new Set(params.marketplaces ?? []);
  const toggleMarket = (id: MarketplaceId) => {
    const next = selectedMarkets.has(id) ? (params.marketplaces ?? []).filter((m) => m !== id) : [...(params.marketplaces ?? []), id];
    return href(params, { marketplaces: next.length > 0 ? next : undefined });
  };

  const priceHidden = Array.from(toSearchParams({ ...params, minPrice: undefined, maxPrice: undefined, page: 1 }).entries());

  return (
    <div className="flex flex-col gap-5 divide-y divide-line [&>section:not(:first-child)]:pt-5">
      <section aria-labelledby={`${idPrefix}-deal`}>
        <h3 id={`${idPrefix}-deal`} className={GROUP_HEADING}>
          Tín hiệu mua sắm
        </h3>
        <Link
          href={href(params, { sort: params.sort === "deal_score" ? undefined : "deal_score" })}
          scroll={false}
          className={`mb-2 flex h-10 items-center gap-2 rounded-inner border px-3 text-body-sm font-semibold transition-colors duration-150 ease-out ${
            params.sort === "deal_score"
              ? "border-buy bg-buy text-canvas"
              : "border-buy/30 bg-buy-soft/70 text-buy hover:bg-buy-soft"
          }`}
        >
          <CheckCircleIcon className="size-4 shrink-0" strokeWidth={2.4} />
          <span>Ưu tiên Deal Score cao</span>
        </Link>
        <div className="flex flex-col">
          <Option to={href(params, { onlyBuy: params.onlyBuy ? undefined : true })} selected={Boolean(params.onlyBuy)} multi tone="buy">
            Chỉ hiện Nên mua
          </Option>
          <Option to={href(params, { hasVoucher: params.hasVoucher ? undefined : true })} selected={Boolean(params.hasVoucher)} multi>
            Có mã giảm giá (Voucher)
          </Option>
          <Option to={href(params, { freeShipping: params.freeShipping ? undefined : true })} selected={Boolean(params.freeShipping)} multi>
            Miễn phí vận chuyển
          </Option>
        </div>
      </section>

      <section aria-labelledby={`${idPrefix}-price`}>
        <h3 id={`${idPrefix}-price`} className={GROUP_HEADING}>
          Khoảng giá
        </h3>
        <PriceRangeForm hidden={priceHidden} min={params.minPrice} max={params.maxPrice} />
      </section>

      {availableCategories.length > 0 && (
        <section aria-labelledby={`${idPrefix}-cat`}>
          <h3 id={`${idPrefix}-cat`} className={GROUP_HEADING}>
            Danh mục
          </h3>
          <div className="flex flex-col">
            <Option to={href(params, { categorySlug: undefined, categoryId: undefined })} selected={!params.categorySlug && !params.categoryId}>
              Tất cả danh mục
            </Option>
            <Folded
              items={availableCategories}
              noun="danh mục"
              isSelected={(c) => params.categorySlug === c.slug}
              render={(c) => (
                <Option key={c.slug} to={href(params, { categorySlug: c.slug, categoryId: undefined })} selected={params.categorySlug === c.slug}>
                  {c.name}
                </Option>
              )}
            />
          </div>
        </section>
      )}

      {availableBrands.length > 0 && (
        <section aria-labelledby={`${idPrefix}-brand`}>
          <h3 id={`${idPrefix}-brand`} className={GROUP_HEADING}>
            Thương hiệu {selectedBrands.size > 0 && <span className="font-normal text-ink-3">({selectedBrands.size})</span>}
          </h3>
          <div className="flex flex-col">
            <Folded
              items={availableBrands}
              noun="thương hiệu"
              isSelected={(b) => selectedBrands.has(b.toLowerCase())}
              render={(b) => (
                <Option key={b} to={toggleBrand(b)} selected={selectedBrands.has(b.toLowerCase())} multi>
                  {b}
                </Option>
              )}
            />
          </div>
        </section>
      )}

      {availableMarketplaces.length >= 2 && (
        <section aria-labelledby={`${idPrefix}-market`}>
          <h3 id={`${idPrefix}-market`} className={GROUP_HEADING}>
            Sàn thương mại
          </h3>
          <div className="flex flex-col">
            {availableMarketplaces.map((m) => (
              <Option key={m} to={toggleMarket(m)} selected={selectedMarkets.has(m)} multi>
                {marketplaceName(m)}
              </Option>
            ))}
          </div>
        </section>
      )}

      <section aria-labelledby={`${idPrefix}-rating`}>
        <h3 id={`${idPrefix}-rating`} className={GROUP_HEADING}>
          Đánh giá gian hàng
        </h3>
        <div className="flex flex-col">
          <Option to={href(params, { minRating: undefined })} selected={params.minRating == null}>
            Mọi mức đánh giá
          </Option>
          {MIN_RATINGS.map((r) => (
            <Option key={r} to={href(params, { minRating: r })} selected={params.minRating === r}>
              Từ {ratingText(r)} ★ trở lên
            </Option>
          ))}
        </div>
      </section>
    </div>
  );
}

const CLEAR_LINK =
  "inline-flex items-center text-label font-semibold text-primary underline-offset-4 hover:text-primary-hover hover:underline cursor-pointer";

export function Filters(props: FiltersProps) {
  const count = activeFilterCount(props.params);
  const clear = count > 0 && (
    <Link href={clearHref(props.params)} scroll={false} className={CLEAR_LINK}>
      Đặt lại
    </Link>
  );
  return (
    <aside id="filters-d" aria-label="Bộ lọc" className="w-full min-w-0">
      <details className="group/filters rounded-lg border border-line bg-surface md:hidden">
        <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 rounded-lg px-4 text-body-sm font-semibold text-ink [&::-webkit-details-marker]:hidden">
          <span>
            Bộ lọc tìm kiếm {count > 0 && <span className="font-normal text-ink-3">({count})</span>}
          </span>
          <ChevronDownIcon className="size-5 text-ink-2 transition-transform duration-150 group-open/filters:rotate-180" />
        </summary>
        <div className="border-t border-line px-4 pt-3 pb-5">
          {clear && <div className="mb-2 flex justify-end">{clear}</div>}
          <FilterBody {...props} idPrefix="filters-m" />
        </div>
      </details>
      <div className="hidden rounded-lg border border-line bg-surface p-5 md:block">
        <div className="mb-4 flex items-center justify-between gap-3 border-b border-line pb-3">
          <h2 className="display text-title font-bold tracking-tight text-ink">Bộ lọc tìm kiếm</h2>
          {clear}
        </div>
        <FilterBody {...props} idPrefix="filters-d" />
      </div>
    </aside>
  );
}

export function ActiveFilterChips({
  params,
  categories = [],
  hide = [],
}: {
  params: SearchParams;
  categories?: Array<{ slug: string; name: string }>;
  /** Conditions already shown as query-intent chips ("Đã hiểu:") — not repeated under "Đang lọc:". */
  hide?: IntentChipKind[];
}) {
  const chips: Array<{ key: string; label: string; to: string }> = [];
  const hidden = new Set(hide);

  if (params.categorySlug && !hidden.has("category")) {
    const name = categories.find((c) => c.slug === params.categorySlug)?.name ?? params.categorySlug;
    chips.push({ key: "cat", label: name, to: href(params, { categorySlug: undefined, categoryId: undefined }) });
  }
  for (const b of hidden.has("brand") ? [] : (params.brands ?? [])) {
    chips.push({ key: `b-${b}`, label: `Hãng: ${b}`, to: href(params, { brands: params.brands?.filter((x) => x !== b) }) });
  }
  if ((params.minPrice != null || params.maxPrice != null) && !hidden.has("price")) {
    const label =
      params.minPrice != null && params.maxPrice != null
        ? `${formatVnd(params.minPrice)} – ${formatVnd(params.maxPrice)}`
        : params.minPrice != null
          ? `Từ ${formatVnd(params.minPrice)}`
          : `Đến ${formatVnd(params.maxPrice)}`;
    chips.push({ key: "price", label: label, to: href(params, { minPrice: undefined, maxPrice: undefined }) });
  }
  // cap has no sidebar control: without this chip it would be an invisible filter.
  if (params.capacityGb != null && !hidden.has("capacity")) {
    chips.push({ key: "cap", label: capacityLabel(params.capacityGb), to: href(params, { capacityGb: undefined }) });
  }
  for (const m of hidden.has("marketplace") ? [] : (params.marketplaces ?? [])) {
    const rest = params.marketplaces?.filter((x) => x !== m);
    chips.push({ key: `m-${m}`, label: marketplaceName(m), to: href(params, { marketplaces: rest?.length ? rest : undefined }) });
  }
  if (params.minRating != null) {
    chips.push({ key: "rating", label: `Từ ${ratingText(params.minRating)} ★`, to: href(params, { minRating: undefined }) });
  }
  if (params.freeShipping && !hidden.has("free_shipping")) chips.push({ key: "freeship", label: "Freeship", to: href(params, { freeShipping: undefined }) });
  if (params.hasVoucher && !hidden.has("voucher")) chips.push({ key: "voucher", label: "Có voucher", to: href(params, { hasVoucher: undefined }) });
  if (params.onlyBuy) chips.push({ key: "buy", label: "Chỉ Nên mua", to: href(params, { onlyBuy: undefined }) });

  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      {/* Quick Category Pills */}
      {categories.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <Link
            href={href(params, { categorySlug: undefined, categoryId: undefined })}
            scroll={false}
            className={pillClass(!params.categorySlug && !params.categoryId)}
          >
            Tất cả
          </Link>
          {categories.slice(0, 7).map((c) => {
            const active = params.categorySlug === c.slug;
            return (
              <Link
                key={c.slug}
                href={href(params, { categorySlug: active ? undefined : c.slug, categoryId: undefined })}
                scroll={false}
                className={pillClass(active)}
              >
                {c.name}
              </Link>
            );
          })}
        </div>
      )}

      {/* Active Filter Chips (only shown when filters are applied) */}
      {chips.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-micro font-semibold text-ink-3">Đang lọc:</span>
          {chips.map((c) => (
            <span
              key={c.key}
              className="inline-flex h-7 max-w-full items-center gap-1.5 rounded-full bg-primary-soft pl-2.5 pr-1 text-micro font-semibold text-primary"
            >
              <span className="min-w-0 truncate">{c.label}</span>
              <Link
                href={c.to}
                scroll={false}
                aria-label={`Bỏ lọc ${c.label}`}
                className="inline-flex size-5 shrink-0 items-center justify-center rounded-full bg-surface text-primary transition-colors hover:bg-primary hover:text-on-primary"
              >
                <CrossIcon className="size-2.5" />
              </Link>
            </span>
          ))}
          <Link href={clearHref(params)} scroll={false} className="ml-1 text-micro font-semibold text-primary hover:underline">
            Xóa hết
          </Link>
        </div>
      )}
    </div>
  );
}

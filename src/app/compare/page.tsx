import type { Metadata } from "next";
import Link from "next/link";
import { loadProductPageData, type ProductPageData } from "@/lib/product/page-data";
import { buildComparison } from "@/lib/compare/build";
import { searchProducts, type SearchItem } from "@/lib/search";
import { formatVnd } from "@/lib/format";
import { CompareView } from "@/components/compare/compare-view";
import { SearchBox } from "@/components/search/search-box";
import { ProductImage } from "@/components/ui/product-image";
import { ScoreRing, VerdictTag } from "@/components/product/verdict-tag";
import { InfoIcon } from "@/components/ui/icons";
import { DiscoveryEmpty } from "@/components/discovery/discovery-shell";

interface PageProps {
  searchParams: Promise<{ a?: string; b?: string; va?: string; vb?: string; q?: string }>;
}

export const dynamic = "force-dynamic";

// Any pair of products is a URL: none of them should be indexed.
export const metadata: Metadata = {
  title: "So sánh sản phẩm | Kairo",
  robots: { index: false, follow: true },
};

const clean = (s: string | undefined) => s?.trim().slice(0, 200) || undefined;

async function load(slug: string | undefined, variantId: string | undefined): Promise<ProductPageData | null | "error"> {
  if (!slug) return null;
  try {
    return await loadProductPageData({ productSlug: slug, variantId });
  } catch (err) {
    console.error("compare: loadProductPageData failed", err);
    return "error";
  }
}

function pickHref(keep: { a?: string; b?: string }, picked: string): string {
  const q = new URLSearchParams();
  if (keep.a) {
    q.set("a", keep.a);
    q.set("b", picked);
  } else {
    q.set("a", picked);
    if (keep.b) q.set("b", keep.b);
  }
  return `/compare?${q.toString()}`;
}

/** No-JS picker results: each row opens the comparison with that product. */
function PickList({ items, keep, exclude }: { items: SearchItem[]; keep: { a?: string; b?: string }; exclude?: string }) {
  const rows = items.filter((i) => i.slug !== exclude);
  if (rows.length === 0) {
    return <p className="text-[14px] text-ink-2">Không tìm thấy sản phẩm nào khớp. Thử tên ngắn hơn hoặc tên hãng.</p>;
  }
  return (
    <ul className="divide-y divide-line overflow-hidden rounded-lg border border-line bg-surface">
      {rows.map((i) => (
        <li key={i.productId}>
          <Link href={pickHref(keep, i.slug)} className="flex min-h-16 items-center gap-3.5 px-4 py-3 transition-colors duration-150 ease-out hover:bg-surface-2">
            <ProductImage src={i.image} className="size-12 shrink-0 rounded-md bg-surface-2! p-1" iconClassName="size-5" />
            <span className="min-w-0 flex-1">
              <span className="line-clamp-2 text-[14px] font-semibold text-ink [overflow-wrap:anywhere]">{i.canonicalName}</span>
              <span className="num text-[18px] font-extrabold text-ink">{i.bestPrice != null ? formatVnd(i.bestPrice) : "Chưa có giá"}</span>
            </span>
            <span className="inline-flex min-h-10 shrink-0 items-center rounded-md border border-line-strong bg-surface px-4 text-[14px] font-semibold text-ink">Chọn</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

function ChosenLabel({ data, position }: { data: ProductPageData; position: "A" | "B" }) {
  const h = data.pricing.headline;
  const price = data.pricing.cheapest?.price ?? null;
  const verdict = h ? (h.score != null ? h.recommendation : "insufficient_data") : null;
  return (
    <div className="flex items-center gap-4 rounded-lg border border-line bg-surface p-4">
      <ProductImage src={data.product.image} className="size-16 shrink-0 rounded-md bg-surface-2! p-1.5" iconClassName="size-6" />
      <div className="min-w-0 flex-1 space-y-1">
        <p className="text-[12px] font-semibold text-ink-3">Sản phẩm {position} đã chọn</p>
        <p className="line-clamp-2 text-[14px] font-semibold text-ink [overflow-wrap:anywhere]">{data.product.canonicalName}</p>
        <div className="flex flex-wrap items-center gap-2">
          <span className="num text-[18px] font-extrabold">{price != null ? formatVnd(price) : "—"}</span>
          <VerdictTag recommendation={verdict} />
          <ScoreRing score={h?.score} recommendation={verdict} size="sm" />
        </div>
      </div>
    </div>
  );
}

/**
 * Product comparison (Phase 2). /compare?a=&b= compares; with one side missing it asks for it with
 * the search box (autocomplete with JS, a GET result list without).
 */
export default async function ComparePage({ searchParams }: PageProps) {
  const sp = await searchParams;
  const aSlug = clean(sp.a);
  const bSlug = clean(sp.b);
  const q = clean(sp.q);

  const [a, b] = await Promise.all([load(aSlug, clean(sp.va)), load(bSlug, clean(sp.vb))]);

  const heading = (
    <header className="max-w-[68ch] space-y-2">
      <h1 className="display text-[40px] leading-[1.1] font-extrabold text-ink max-sm:text-[30px]">So sánh hai sản phẩm</h1>
      <p className="text-[16px] leading-relaxed text-ink-2">
        Đặt hai sản phẩm cạnh nhau: giá hôm nay, Deal Score, mức so với lịch sử giá và thông số.
      </p>
    </header>
  );

  if (a === "error" || b === "error") {
    return (
      <main className="mx-auto w-full max-w-7xl flex-1 space-y-6 px-4 py-8 sm:px-6 sm:py-12">
        {heading}
        <DiscoveryEmpty title="Chưa tải được dữ liệu" body="Có lỗi khi đọc giá. Hãy thử lại sau ít phút." action={{ href: `/compare?${new URLSearchParams(Object.entries(sp).filter(([, v]) => v) as [string, string][])}`, text: "Thử lại" }} />
      </main>
    );
  }

  if (a && b && a.product.id !== b.product.id) {
    return (
      <main className="mx-auto w-full max-w-7xl flex-1 space-y-6 px-4 py-8 sm:px-6 sm:py-12">
        <h1 className="display text-[40px] leading-[1.1] font-extrabold text-ink max-sm:text-[30px]">So sánh</h1>
        <CompareView comparison={buildComparison(a, b)} />
      </main>
    );
  }

  // Picking: keep whichever side is valid, ask for the other.
  const keep = { a: a ? a.product.slug : undefined, b: !a && b ? b.product.slug : undefined };
  const kept = a ?? b;
  const results = q ? await searchProducts({ q, sort: "relevance" }).catch((err) => {
    console.error("compare: searchProducts failed", err);
    return null;
  }) : null;

  return (
    <main className="mx-auto w-full max-w-7xl flex-1 space-y-6 px-4 py-8 sm:px-6 sm:py-12 [&>*]:max-w-3xl">
      {heading}

      {(aSlug && !a) || (bSlug && !b) ? (
        <p className="flex items-start gap-2.5 rounded-md bg-surface-2 p-3.5 text-[14px] text-ink">
          <InfoIcon className="mt-0.5 size-[18px] shrink-0 text-ink-2" />
          Không tìm thấy một trong hai sản phẩm trong link. Hãy chọn lại bên dưới.
        </p>
      ) : null}
      {a && b && a.product.id === b.product.id && (
        <p className="flex items-start gap-2.5 rounded-md bg-surface-2 p-3.5 text-[14px] text-ink">
          <InfoIcon className="mt-0.5 size-[18px] shrink-0 text-ink-2" />
          Hai bên đang là cùng một sản phẩm. Hãy chọn một sản phẩm khác để so sánh.
        </p>
      )}

      {kept && <ChosenLabel data={kept} position={keep.a ? "A" : "B"} />}

      <section aria-labelledby="pick-heading" className="space-y-3">
        <h2 id="pick-heading" className="display text-[22px] font-bold text-ink max-sm:text-[18px]">
          {kept ? "Chọn sản phẩm để so sánh cùng" : "Chọn sản phẩm đầu tiên"}
        </h2>
        <SearchBox initialQuery={q ?? ""} compare={keep} />
        {q && (results ? <PickList items={results.items} keep={keep} exclude={kept?.product.slug} /> : (
          <p className="text-[14px] text-ink-2">Chưa tìm được lúc này. Hãy thử lại.</p>
        ))}
        {!kept && !q && (
          <p className="text-[13px] leading-[1.45] text-ink-3">Mẹo: trên trang sản phẩm, bấm “So sánh” để bắt đầu từ sản phẩm đang xem.</p>
        )}
      </section>
    </main>
  );
}

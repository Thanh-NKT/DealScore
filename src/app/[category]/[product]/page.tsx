import { notFound } from "next/navigation";
import Link from "next/link";
import { loadProductPageData } from "@/lib/product-page-data";
import { buildChartSeries } from "@/lib/chart-series";
import { PriceSummary } from "@/components/product/price-summary";
import { VariantPicker } from "@/components/product/variant-picker";
import { DealScoreBadge } from "@/components/product/deal-score-badge";
import { DealReasons } from "@/components/product/deal-reasons";
import { FakeSaleNotice } from "@/components/product/fake-sale-notice";
import { DraftProductNotice } from "@/components/product/draft-product-notice";
import { PriceChart } from "@/components/product/price-chart";
import { StatsRow } from "@/components/product/stats-row";
import { OfferList } from "@/components/product/offer-list";
import { getCurrentUser } from "@/lib/auth/session";
import { getMyWatchForVariant } from "@/lib/watch/queries";
import { WatchButton } from "@/components/watch/watch-button";

interface PageProps {
  params: Promise<{ category: string; product: string }>;
  searchParams: Promise<{ variant?: string; range?: string }>;
}

export const dynamic = "force-dynamic";

export default async function ProductPage({ params, searchParams }: PageProps) {
  const { product: productSlug } = await params;
  const { variant, range: rawRange } = await searchParams;

  let range: 7 | 30 | 90 = 30;
  if (rawRange === "7") range = 7;
  else if (rawRange === "90") range = 90;

  const data = await loadProductPageData({
    productSlug,
    variantId: variant,
  });

  if (!data) {
    notFound();
  }

  const { product, variants, selectedVariantId, pricing, dailyPrices } = data;

  const user = await getCurrentUser();
  // getMyWatchForVariant ném khi lỗi DB. Trang sản phẩm công khai không được sập vì phần Watch:
  // lỗi thì coi như chưa có Watch.
  const existingWatch = user
    ? await getMyWatchForVariant(user.id, selectedVariantId).catch((err) => {
        console.error("getMyWatchForVariant thất bại", err);
        return null;
      })
    : null;

  const currentVariant = variants.find((v) => v.id === selectedVariantId);
  const currentPath = `/${product.categorySlug}/${product.slug}?variant=${selectedVariantId}&range=${range}`;

  // Chart series theo range (chỉ cắt chart, không ảnh hưởng Deal Score)
  const chartSeries = buildChartSeries(dailyPrices, range);

  return (
    <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-8 sm:py-12">
      {/* Breadcrumb danh mục */}
      <nav aria-label="Đường dẫn trang" className="mb-6 flex items-center gap-2 text-xs text-muted">
        <Link href="/" className="hover:text-foreground">
          Trang chủ
        </Link>
        <span>/</span>
        <Link href={`/tim-kiem?cat=${product.categorySlug}`} className="hover:text-foreground">
          {product.categoryName}
        </Link>
        <span>/</span>
        <span className="truncate text-foreground font-medium">
          {product.canonicalName}
        </span>
      </nav>

      <article className="space-y-8">
        {/* Header thông tin sản phẩm */}
        <header className="flex flex-col gap-6 md:flex-row md:items-start md:justify-between">
          <div className="space-y-2 flex-1">
            {product.brand && (
              <p className="text-xs font-semibold uppercase tracking-wider text-muted">
                {product.brand}
              </p>
            )}
            <h1 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
              {product.canonicalName}
            </h1>
            {product.model && (
              <p className="text-xs text-muted">Model: {product.model}</p>
            )}
          </div>

          {product.image && (
            <div className="relative h-32 w-32 shrink-0 overflow-hidden rounded-2xl border border-border bg-black/5 dark:bg-white/5 sm:h-40 sm:w-40">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={product.image}
                alt={product.canonicalName}
                className="h-full w-full object-cover"
              />
            </div>
          )}
        </header>

        {/* Bộ chọn phiên bản Variant (nếu có > 1) */}
        <VariantPicker
          variants={variants}
          selectedId={selectedVariantId}
          range={range}
        />

        {/* Khối giá hiện tại & nút theo dõi giá */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <PriceSummary
            cheapest={pricing.cheapest ?? pricing.lastKnown}
            offerCount={pricing.offers.length}
            updatedAt={pricing.updatedAt}
            isStale={pricing.isStale}
          />
          <div className="flex items-center gap-3">
            <WatchButton
              isLoggedIn={Boolean(user)}
              productName={product.canonicalName}
              variantKey={currentVariant?.variantKey ?? ""}
              variantId={selectedVariantId}
              currentPrice={
                pricing.cheapest?.price ?? pricing.lastKnown?.price ?? null
              }
              existingWatch={existingWatch}
              currentPath={currentPath}
            />
          </div>
        </div>

        {/* Hết hàng ở mọi người bán: không chấm điểm (1.2.e) */}
        {pricing.allOutOfStock && (
          <p className="rounded-2xl border border-border p-4 text-sm text-muted">
            Tạm hết hàng ở mọi người bán đang theo dõi.
          </p>
        )}

        {/* Deal Score đầu trang + Lý do */}
        {pricing.headline && (
          <section className="space-y-4 rounded-2xl border border-border bg-black/[0.01] p-6 dark:bg-white/[0.01]">
            <DealScoreBadge result={pricing.headline} />
            <DealReasons reasons={pricing.headline.reasons} />
          </section>
        )}

        {/* Cảnh báo Fake Sale (chỉ hiện khi có) */}
        <FakeSaleNotice message={pricing.fakeSaleMessage} />

        {/* Thông báo sản phẩm draft do ingest (nếu có) */}
        <DraftProductNotice isDraft={product.status === "draft"} />

        {/* Biểu đồ giá SVG chuẩn server */}
        <PriceChart
          series={chartSeries}
          range={range}
          variantId={selectedVariantId}
          rows={dailyPrices}
        />

        {/* 4 chỉ số thống kê (Đáy / Trung vị / Đỉnh / Bắt đầu theo dõi) */}
        {(pricing.stats.dayCount > 0 || pricing.trackingSince) && (
          <StatsRow
            stats={pricing.stats}
            trackingSince={pricing.trackingSince}
          />
        )}

        {/* Danh sách người bán (Offer list) */}
        <OfferList offers={pricing.offers} />
      </article>
    </main>
  );
}

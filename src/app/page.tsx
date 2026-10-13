import Link from "next/link";
import {
  SearchIcon,
  TrendUpIcon,
  BellIcon,
  CheckCircleIcon,
  CheckIcon,
  HourglassIcon,
  OctagonMinusIcon,
  DottedQuestionIcon,
} from "@/components/ui/icons";
import { HeroSampleCard } from "@/components/home/hero-sample-card";
import { HeroSearchForm } from "@/components/home/hero-search-form";
import { CategoryGrid } from "@/components/home/category-grid";
import { HomeProductTabs } from "@/components/home/home-product-tabs";
import { HomeRadarPanel } from "@/components/home/home-radar-panel";
import { getFilterFacets, searchProducts } from "@/lib/search";
import { loadRadar, loadTrending } from "@/lib/discovery";
import { getCurrentUser } from "@/lib/auth/session";
import { buttonClass } from "@/components/ui/button";
import { MarketplaceMark } from "@/components/product/marketplace-mark";

export const dynamic = "force-dynamic";

const STEPS = [
  {
    icon: SearchIcon,
    title: "Tìm tên hoặc dán link sản phẩm",
    body: "Gom các nơi bán cùng một mẫu sản phẩm về một trang duy nhất để tiện so sánh.",
  },
  {
    icon: TrendUpIcon,
    title: "Đọc Deal Score & lịch sử giá",
    body: "Chấm điểm 0–100 theo vị trí của giá hiện tại trong 90 ngày và khoảng cách tới mức thấp nhất, có tính xu hướng giá gần đây.",
  },
  {
    icon: BellIcon,
    title: "Đặt giá mong muốn",
    body: "Nhận thông báo qua email hoặc trình duyệt khi giá xuống tới mức bạn muốn.",
  },
];

// Mirrors classify() in src/lib/pricing/deal-score.ts. `basis` is the zone's share of the 0–100 scale.
const SIGNALS = [
  {
    icon: OctagonMinusIcon,
    label: "Chưa nên mua",
    range: "0–49",
    body: "Giá đang cao so với lịch sử, hoặc cao hơn trung vị trên 5%.",
    tone: "text-avoid",
    solid: "bg-avoid",
    basis: "basis-[49%]",
  },
  {
    icon: HourglassIcon,
    label: "Có thể chờ",
    range: "50–74",
    body: "Giá ổn nhưng chưa phải vùng tốt. Đặt giá mong muốn rồi chờ thêm.",
    tone: "text-wait",
    solid: "bg-wait",
    basis: "basis-[25%]",
  },
  {
    icon: CheckCircleIcon,
    label: "Nên mua",
    range: "75–100",
    body: "Điểm từ 75 và giá không cao hơn mức trung vị đã ghi nhận.",
    tone: "text-buy",
    solid: "bg-buy",
    basis: "basis-[26%]",
  },
];

const PROMISES = ["Giá các sàn đặt cạnh nhau", "Lịch sử giá theo từng phân loại", "Không ai trả tiền để được xếp hạng"];

export default async function Home() {
  const [featuredRes, recentRes, watchedRes, radarRes, facetsRes, userRes] = await Promise.allSettled([
    searchProducts({ sort: "deal_score", page: 1 }),
    searchProducts({ sort: "updated", page: 1 }),
    loadTrending("watched"),
    loadRadar({ page: 1 }),
    getFilterFacets(),
    // Same memoised read as SiteHeader: one Auth round trip per request, not two.
    getCurrentUser(),
  ]);

  if (featuredRes.status === "rejected") console.error("home: featured searchProducts failed", featuredRes.reason);
  if (recentRes.status === "rejected") console.error("home: searchProducts failed", recentRes.reason);
  if (watchedRes.status === "rejected") console.error("home: loadTrending failed", watchedRes.reason);
  if (radarRes.status === "rejected") console.error("home: loadRadar failed", radarRes.reason);
  if (facetsRes.status === "rejected") console.error("home: getFilterFacets failed", facetsRes.reason);

  const recentProducts = recentRes.status === "fulfilled" ? recentRes.value.items : [];
  const featuredProducts =
    featuredRes.status === "fulfilled" && featuredRes.value.items.length > 0
      ? featuredRes.value.items
      : recentProducts;
  const watchedProducts = watchedRes.status === "fulfilled" ? watchedRes.value : [];
  const radarItems = radarRes.status === "fulfilled" ? radarRes.value.items : [];
  const categories = facetsRes.status === "fulfilled" ? facetsRes.value.categories : [];
  const categoryNames = Object.fromEntries(categories.map((c) => [c.slug, c.name]));
  const signedIn = userRes.status === "fulfilled" && userRes.value !== null;

  return (
    <main className="w-full flex-1">
      {/* 1. Hero: the two questions DealScore answers, the search, one sample face-off */}
      <section aria-labelledby="home-title" className="relative overflow-hidden border-b border-line">
        <div aria-hidden="true" className="bg-iris-wash pointer-events-none absolute inset-0" />
        <div
          aria-hidden="true"
          className="bg-ledger pointer-events-none absolute inset-0 [mask-image:radial-gradient(ellipse_75%_70%_at_20%_25%,black,transparent_75%)]"
        />
        <div className="relative mx-auto grid max-w-[1440px] grid-cols-1 items-center gap-14 px-4 pb-16 pt-10 sm:px-6 lg:grid-cols-[minmax(0,1.12fr)_minmax(0,0.88fr)] lg:gap-16 lg:px-14 lg:pb-24 lg:pt-16">
          <div className="flex min-w-0 flex-col gap-8">
            <div className="flex flex-col gap-6">
              <span className="inline-flex w-fit max-w-full items-center gap-2.5 rounded-full border border-line bg-surface/90 py-1.5 pl-1.5 pr-4 text-label font-medium text-ink-2 shadow-xs backdrop-blur">
                <span aria-hidden="true" className="flex shrink-0 items-center -space-x-1">
                  <MarketplaceMark marketplace="shopee" size="sm" className="ring-2 ring-surface" />
                  <MarketplaceMark marketplace="tiktok" size="sm" className="ring-2 ring-surface" />
                </span>
                <span className="truncate">
                  So giá Shopee &amp; TikTok Shop<span className="max-sm:hidden"> · không thuộc về sàn nào</span>
                </span>
              </span>
              <h1
                id="home-title"
                className="display text-h1-sm font-bold leading-[1.02] text-ink min-[420px]:text-price-md sm:text-hero 2xl:text-display"
              >
                Sàn nào rẻ hơn?
                <br />
                <span className="text-primary">Lúc nào</span> nên mua?
              </h1>
              <p className="max-w-[580px] text-body leading-[1.65] text-ink-2 sm:text-title sm:leading-[1.6]">
                DealScore gom mọi nơi bán cùng một mẫu, đặt giá các sàn cạnh nhau, đọc lịch sử giá thật — rồi trả lời có
                giải thích: <strong className="font-semibold text-ink">mua ngay hay chờ thêm</strong>.
              </p>
            </div>

            <HeroSearchForm />

            <ul className="flex flex-wrap gap-x-6 gap-y-2.5 text-body-sm text-ink-2">
              {PROMISES.map((p) => (
                <li key={p} className="flex items-center gap-2">
                  <span aria-hidden="true" className="flex size-5 shrink-0 items-center justify-center rounded-full bg-primary-soft text-primary">
                    <CheckIcon className="size-3" strokeWidth={3} />
                  </span>
                  {p}
                </li>
              ))}
            </ul>
          </div>

          <div className="min-w-0 lg:pl-2">
            <HeroSampleCard />
          </div>
        </div>
      </section>

      {/* 2. The Deal Score scale — one number, four answers. Zones are proportional to the engine's thresholds. */}
      <section aria-labelledby="signals-title" className="scope-night relative overflow-hidden bg-night text-night-ink">
        <div aria-hidden="true" className="pointer-events-none absolute -right-40 -top-40 size-[520px] rounded-full bg-primary/25 blur-3xl" />
        <div className="relative mx-auto max-w-[1440px] px-4 py-16 sm:px-6 lg:px-14 lg:py-24">
          <div className="mb-12 flex flex-wrap items-end justify-between gap-6">
            <div className="flex max-w-3xl flex-col gap-3">
              <span className="eyebrow text-night-ink-3">Deal Score · 0 đến 100</span>
              <h2 id="signals-title" className="display text-h2-sm font-bold leading-[1.08] sm:text-h1">
                Một con số, bốn câu trả lời. <span className="text-night-ink-3">Không câu nào được tài trợ.</span>
              </h2>
            </div>
            <Link
              href="/deal-score"
              className="inline-flex min-h-11 items-center rounded-full bg-night-ink px-5 text-label font-semibold text-night transition-opacity hover:opacity-90"
            >
              Xem độ chính xác Deal Score →
            </Link>
          </div>

          <div aria-hidden="true" className="mb-3 flex h-3 gap-1 overflow-hidden rounded-full max-lg:hidden">
            {SIGNALS.map((s) => (
              <span key={s.label} className={`${s.solid} ${s.basis}`} />
            ))}
          </div>
          <div className="grid grid-cols-1 gap-x-1 gap-y-4 lg:grid-cols-[49fr_25fr_26fr]">
            {SIGNALS.map((s) => {
              const Icon = s.icon;
              return (
                <div key={s.label} className="flex gap-4 rounded-tile border border-night-line/70 bg-night-2/60 p-5 lg:flex-col lg:border-0 lg:bg-transparent lg:p-0 lg:pr-8">
                  <span aria-hidden="true" className={`w-1.5 shrink-0 rounded-full ${s.solid} lg:hidden`} />
                  <div className="flex flex-col gap-2">
                    <span className="num text-micro font-semibold text-night-ink-3">{s.range} điểm</span>
                    <span className="flex items-center gap-2 text-h4 font-bold text-night-ink">
                      <Icon className={`size-5 ${s.tone}`} strokeWidth={2.2} />
                      {s.label}
                    </span>
                    <p className="max-w-[40ch] text-body-sm leading-relaxed text-night-ink-2">{s.body}</p>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="mt-12 flex flex-col gap-3 rounded-tile border border-dashed border-night-line px-5 py-4 sm:flex-row sm:items-center sm:gap-5">
            <span className="flex shrink-0 items-center gap-2 text-control font-semibold text-night-ink-2">
              <DottedQuestionIcon className="size-5" strokeWidth={2.2} />
              Chưa đủ dữ liệu
            </span>
            <p className="text-body-sm leading-relaxed text-night-ink-3">
              Dưới 14 ngày hoặc 10 lần ghi nhận giá: DealScore không đoán, và cũng không chấm điểm cho đẹp.
            </p>
          </div>
        </div>
      </section>

      <div className="mx-auto w-full max-w-[1440px] space-y-20 px-4 py-16 sm:px-6 lg:px-14 lg:py-24">
        {/* 3. Categories */}
        <CategoryGrid categories={categories} />

        {/* 4. Product discovery tabs */}
        {(featuredProducts.length > 0 || recentProducts.length > 0 || watchedProducts.length > 0 || radarItems.length > 0) && (
          <HomeProductTabs
            featuredProducts={featuredProducts}
            recentProducts={recentProducts}
            watchedProducts={watchedProducts}
            radarProducts={radarItems}
            categoryNames={categoryNames}
          />
        )}

        {/* 5. Real drops */}
        <HomeRadarPanel items={radarItems} categoryNames={categoryNames} />

        {/* 6. How it works: three steps in a row, joined by a line, and the one action */}
        <section
          aria-labelledby="steps-title"
          className="relative overflow-hidden rounded-hero border border-primary/15 bg-primary-soft/60 px-6 py-8 sm:px-10 sm:py-12"
        >
          <div
            aria-hidden="true"
            className="bg-ledger pointer-events-none absolute inset-0 [mask-image:radial-gradient(ellipse_60%_80%_at_100%_0%,black,transparent_70%)]"
          />
          <div className="relative mb-10 flex flex-wrap items-end justify-between gap-6">
            <div className="flex max-w-xl flex-col gap-2">
              <span className="eyebrow text-ink-3">Cách dùng</span>
              <h2 id="steps-title" className="display text-h2-sm font-bold leading-tight text-ink sm:text-h2">
                Mua thông minh trong 3 bước
              </h2>
            </div>
            <Link href={signedIn ? "/account/watch" : "/register"} className={buttonClass({ size: "lg" })}>
              <BellIcon className="size-4.5" strokeWidth={2} />
              <span>{signedIn ? "Xem sản phẩm đang theo dõi" : "Tạo tài khoản theo dõi giá"}</span>
            </Link>
          </div>

          <ol className="relative grid grid-cols-1 gap-8 md:grid-cols-3 md:gap-0">
            {STEPS.map((step, i) => {
              const Icon = step.icon;
              return (
                <li key={step.title} className="flex flex-col gap-4 md:pr-10">
                  <div className="flex items-center gap-4">
                    <span className="num flex size-11 shrink-0 items-center justify-center rounded-full bg-primary text-title font-bold text-on-primary shadow-glow">
                      {i + 1}
                    </span>
                    {i < STEPS.length - 1 && <span aria-hidden="true" className="hidden h-px flex-1 bg-primary/30 md:block" />}
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <span className="flex items-center gap-2 text-title font-semibold leading-snug text-ink">
                      <Icon className="size-[18px] shrink-0 text-primary" strokeWidth={2.2} />
                      {step.title}
                    </span>
                    <p className="max-w-[40ch] text-body-sm leading-relaxed text-ink-2">{step.body}</p>
                  </div>
                </li>
              );
            })}
          </ol>
        </section>
      </div>
    </main>
  );
}

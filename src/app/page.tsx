import Link from "next/link";
import {
  SearchIcon,
  TrendUpIcon,
  BellIcon,
  CompareIcon,
  CheckCircleIcon,
  HourglassIcon,
  OctagonMinusIcon,
} from "@/components/ui/icons";
import { HeroSampleCard } from "@/components/home/hero-sample-card";
import { HeroSearchForm } from "@/components/home/hero-search-form";
import { CategoryGrid } from "@/components/home/category-grid";
import { HomeProductTabs } from "@/components/home/home-product-tabs";
import { HomeRadarPanel } from "@/components/home/home-radar-panel";
import { getFilterFacets, searchProducts } from "@/lib/search";
import { loadRadar, loadTrending } from "@/lib/discovery";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const STEPS = [
  {
    icon: SearchIcon,
    title: "Tìm tên hoặc dán link Shopee",
    body: "Gom các nơi bán cùng một mẫu sản phẩm về một trang duy nhất để tiện so sánh.",
  },
  {
    icon: TrendUpIcon,
    title: "Kiểm tra Deal Score & lịch sử giá",
    body: "Chấm điểm 0–100 từ vị trí giá lịch sử, khoảng cách tới đáy 90 ngày và độ lệch so với trung vị 30 ngày.",
  },
  {
    icon: BellIcon,
    title: "Đặt mức giá mục tiêu",
    body: "Nhận thông báo qua trình duyệt hoặc email ngay khi giá giảm chạm mức bạn mong muốn.",
  },
];

export default async function Home() {
  const supabase = await createClient();
  const [featuredRes, recentRes, watchedRes, radarRes, facetsRes, userRes] = await Promise.allSettled([
    searchProducts({ sort: "deal_score", page: 1 }),
    searchProducts({ sort: "updated", page: 1 }),
    loadTrending("watched"),
    loadRadar({ page: 1 }),
    getFilterFacets(),
    supabase.auth.getUser(),
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
  const signedIn = userRes.status === "fulfilled" && Boolean(userRes.value.data.user);

  return (
    <main className="mx-auto w-full max-w-[1440px] flex-1 space-y-16 px-4 py-10 sm:px-6 lg:px-14 lg:py-16">
      {/* 1. Hero Section */}
      <section aria-labelledby="home-title" className="grid items-center gap-10 lg:grid-cols-[1.2fr_0.8fr] lg:gap-14">
        <div className="flex flex-col gap-7">
          <div className="space-y-5">
            <h1
              id="home-title"
              className="display text-[40px] font-extrabold leading-[1.18] tracking-tight text-ink lg:text-[62px]"
            >
              <span className="text-ink-2">Đừng chỉ tìm giá rẻ.</span>
              <span className="mt-1.5 block">
                Tìm{" "}
                <span className="inline-block rounded-[14px] border border-primary/15 bg-accent px-3.5 py-0.5 text-on-accent shadow-xs">
                  đúng lúc
                </span>{" "}
                <span className="text-gradient-primary">để mua.</span>
              </span>
            </h1>
            <p className="max-w-[560px] text-[16px] leading-[1.65] text-ink-2 sm:text-[18px]">
              Xem <strong className="font-semibold text-ink">lịch sử giá thực tế</strong>,{" "}
              <strong className="font-semibold text-primary">Deal Score có giải thích</strong> và biết nên{" "}
              <strong className="font-semibold text-wait">mua ngay hay chờ thêm</strong> — cho mọi thứ bạn mua online, từ nồi chiên đến kem chống nắng.
            </p>
          </div>

          <HeroSearchForm />

          <div className="flex flex-wrap gap-6 pt-1 text-[14px] font-medium text-ink-2">
            <div className="flex items-center gap-2.5">
              <span className="flex size-8 items-center justify-center rounded-[8px] bg-primary-soft text-primary">
                <TrendUpIcon className="size-[18px]" strokeWidth={2} />
              </span>
              <span>Lịch sử giá thực tế</span>
            </div>
            <div className="flex items-center gap-2.5">
              <span className="flex size-8 items-center justify-center rounded-[8px] bg-primary-soft text-primary">
                <CompareIcon className="size-[18px]" strokeWidth={2} />
              </span>
              <span>So giá giữa các nơi bán</span>
            </div>
            <div className="flex items-center gap-2.5">
              <span className="flex size-8 items-center justify-center rounded-[8px] bg-wait-soft text-wait">
                <BellIcon className="size-[18px]" strokeWidth={2} />
              </span>
              <span>Báo khi chạm giá mục tiêu</span>
            </div>
          </div>
        </div>

        {/* Right column: Sample illustration card */}
        <HeroSampleCard />
      </section>

      {/* 2. Category grid ("Hôm nay bạn cần gì?") */}
      <CategoryGrid categories={categories} />

      {/* 3. Interactive Product Discovery Tabs ("Khám phá giá tốt hôm nay") */}
      {(featuredProducts.length > 0 || recentProducts.length > 0 || watchedProducts.length > 0 || radarItems.length > 0) && (
        <HomeProductTabs
          featuredProducts={featuredProducts}
          recentProducts={recentProducts}
          watchedProducts={watchedProducts}
          radarProducts={radarItems}
          categoryNames={categoryNames}
        />
      )}

      {/* 4. Bottom Grid: "Giảm giá thật" (Night panel) + "Mua thông minh trong 3 bước" (Surface panel) */}
      <section aria-label="Khám phá và hướng dẫn" className="grid grid-cols-1 items-stretch gap-6 lg:grid-cols-[1.35fr_0.65fr]">
        {/* Left: Giảm giá thật (Interactive Night panel) */}
        <HomeRadarPanel items={radarItems} categoryNames={categoryNames} />

        {/* Right: Mua thông minh trong 3 bước */}
        <aside
          aria-label="Mua thông minh trong 3 bước"
          className="flex flex-col justify-between gap-6 rounded-[20px] border border-line bg-surface p-6 sm:p-8"
        >
          <div className="space-y-5">
            <div className="space-y-1">
              <h2 className="display text-[26px] font-bold leading-[1.2] tracking-tight text-ink sm:text-[28px]">
                Mua thông minh <span className="text-gradient-warm">trong 3 bước</span>
              </h2>
              <p className="text-[14px] text-ink-3">
                Quy trình kiểm tra giá tự động trước khi bạn bấm thanh toán
              </p>
            </div>

            <div className="flex flex-col gap-4">
              {STEPS.map((step, i) => {
                const Icon = step.icon;
                return (
                  <div
                    key={step.title}
                    className="flex items-start gap-3.5 rounded-[12px] border border-line/70 bg-surface-2/40 p-3.5"
                  >
                    <span
                      className="flex size-10 shrink-0 items-center justify-center rounded-[12px] bg-primary-soft text-primary"
                      aria-hidden="true"
                    >
                      <Icon className="size-5" strokeWidth={2} />
                    </span>
                    <div className="flex min-w-0 flex-col gap-0.5">
                      <div className="flex items-center gap-2">
                        <span className="num rounded-md bg-wait-soft px-2 py-0.5 text-[11px] font-bold text-wait">
                          Bước {i + 1}
                        </span>
                        <span className="text-[15px] font-bold leading-[1.35] text-ink">{step.title}</span>
                      </div>
                      <span className="text-[13px] leading-relaxed text-ink-2">{step.body}</span>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Quick visual legend of Verdict badges */}
            <div className="rounded-[12px] border border-line bg-surface p-3.5">
              <p className="mb-2.5 text-[12px] font-semibold text-ink-3">
                3 tín hiệu khuyến nghị từ Deal Score:
              </p>
              <div className="grid grid-cols-3 gap-2">
                <div className="flex items-center gap-1.5 rounded-[8px] border border-buy/30 bg-buy-soft px-2.5 py-1.5 text-[12px] font-semibold text-buy">
                  <CheckCircleIcon className="size-3.5 shrink-0" strokeWidth={2.2} />
                  <span className="truncate">Nên mua</span>
                </div>
                <div className="flex items-center gap-1.5 rounded-[8px] border border-wait/30 bg-wait-soft px-2.5 py-1.5 text-[12px] font-semibold text-wait">
                  <HourglassIcon className="size-3.5 shrink-0" strokeWidth={2.2} />
                  <span className="truncate">Có thể chờ</span>
                </div>
                <div className="flex items-center gap-1.5 rounded-[8px] border border-avoid/30 bg-avoid-soft px-2.5 py-1.5 text-[12px] font-semibold text-avoid">
                  <OctagonMinusIcon className="size-3.5 shrink-0" strokeWidth={2.2} />
                  <span className="truncate">Chờ giảm</span>
                </div>
              </div>
            </div>
          </div>

          <Link
            href={signedIn ? "/account/watch" : "/register"}
            className="flex min-h-[48px] items-center justify-center gap-2 rounded-[12px] bg-primary px-6 text-[15px] font-bold text-on-primary transition-colors duration-150 ease-out hover:bg-primary-hover"
          >
            <BellIcon className="size-4.5" strokeWidth={2} />
            <span>{signedIn ? "Xem sản phẩm đang theo dõi" : "Tạo tài khoản theo dõi giá"}</span>
          </Link>
        </aside>
      </section>
    </main>
  );
}

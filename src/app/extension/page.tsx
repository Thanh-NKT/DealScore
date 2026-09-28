import Link from "next/link";
import { MonitorIcon } from "@/components/ui/icons";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Tiện ích Chrome Kairo · Mua thông minh trên Shopee",
  description:
    "Tiện ích Kairo tự động hiện Deal Score, lịch sử giá 90 ngày và so sánh nơi bán khác ngay khi bạn duyệt Shopee.",
};

export default function ExtensionPage() {
  return (
    <div className="flex w-full flex-col bg-canvas pb-24 pt-6">
      <div className="mx-auto w-full max-w-[1440px] px-4 sm:px-8 lg:px-14">
        {/* Breadcrumb */}
        <nav aria-label="Đường dẫn" className="flex items-center gap-2 pb-6 text-[13px] text-ink-3">
          <Link href="/" className="hover:text-ink">
            Trang chủ
          </Link>
          <span aria-hidden="true">/</span>
          <span className="font-semibold text-ink">Tiện ích Chrome</span>
        </nav>

        {/* Hero Banner */}
        <div className="flex flex-col items-center gap-6 rounded-lg border border-line bg-surface p-8 text-center shadow-sm sm:p-12">
          <div className="flex size-16 items-center justify-center rounded-lg bg-night text-accent">
            <MonitorIcon className="size-8" />
          </div>

          <div className="flex max-w-[680px] flex-col gap-3">
            <h1 className="font-[family-name:var(--font-display)] text-[32px] font-extrabold leading-[1.15] tracking-[-0.02em] text-ink sm:text-[44px]">
              Biết ngay thời điểm mua tốt nhất ngay trên sàn
            </h1>
            <p className="text-[16px] leading-[1.6] text-ink-2 sm:text-[18px]">
              Tiện ích Kairo tự động ghi nhận giá, tính Deal Score và so sánh với các nơi bán khác khi bạn đang xem bất kỳ sản phẩm nào.
            </p>
          </div>

          <div className="flex flex-wrap items-center justify-center gap-3">
            <a
              href="https://chromewebstore.google.com"
              target="_blank"
              rel="noopener noreferrer"
              className="flex h-[52px] items-center gap-2.5 rounded-xl bg-primary px-6 text-[16px] font-bold text-on-primary transition-colors hover:bg-primary-hover"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <circle cx="12" cy="12" r="10" />
                <circle cx="12" cy="12" r="4" />
                <line x1="21.17" y1="8" x2="12" y2="8" />
                <line x1="3.95" y1="6.06" x2="8.54" y2="14" />
                <line x1="10.88" y1="21.94" x2="15.46" y2="14" />
              </svg>
              <span>Thêm vào Chrome — Miễn phí</span>
            </a>
            <Link
              href="/search"
              className="flex h-[52px] items-center gap-2 rounded-xl border border-line-strong bg-surface px-6 text-[15px] font-semibold text-ink transition-colors hover:bg-surface-2"
            >
              <span>Dùng trên web</span>
            </Link>
          </div>

          <div className="flex flex-wrap items-center justify-center gap-6 pt-2 text-[13px] text-ink-3">
            <span>✓ Không cần đăng ký tài khoản</span>
            <span>✓ Không thu thập lịch sử duyệt web</span>
            <span>✓ Tự động cập nhật dữ liệu</span>
          </div>
        </div>

        {/* Section: Mockup UI Previews matching Extension.html */}
        <div className="mt-14 flex flex-col items-center gap-8">
          <div className="text-center">
            <h2 className="font-[family-name:var(--font-display)] text-[28px] font-bold tracking-[-0.02em] text-ink">
              Giao diện tiện ích khi bạn mở Shopee
            </h2>
            <p className="mt-1 text-[15px] text-ink-3">
              Hai trạng thái hiển thị rõ ràng, giúp bạn đưa ra quyết định mua sắm sáng suốt.
            </p>
          </div>

          <div className="flex w-full flex-wrap items-start justify-center gap-8 lg:gap-12">
            {/* Popup 1: Sufficient Data */}
            <div className="flex flex-col gap-3">
              <span className="text-[13px] font-bold text-ink-3">
                Popup: đã đủ dữ liệu
              </span>
              <div className="w-[360px] overflow-hidden rounded-[20px] border border-line bg-surface shadow-sm">
                {/* Header */}
                <div className="flex items-center gap-2.5 bg-night px-4 py-3 text-night-ink">
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-accent">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--ink)" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M3 17l6-6 4 4 8-8M15 7h6v6" />
                    </svg>
                  </span>
                  <span className="flex-1 font-[family-name:var(--font-display)] text-[18px] font-extrabold tracking-[-0.02em]">
                    Kairo
                  </span>
                  <span className="rounded-full border border-night-line bg-night-2 px-2.5 py-1 text-[12px] font-semibold text-night-ink-2">
                    Trên Shopee
                  </span>
                </div>

                {/* Content */}
                <div className="flex flex-col gap-3.5 p-4">
                  {/* Product snippet */}
                  <div className="flex items-center gap-3">
                    <span className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-tint-peach">
                      <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="var(--ink)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <path d="M4 10h16v6a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4zM2 10h20M9 6c0-1 1-2 3-2s3 1 3 2" />
                      </svg>
                    </span>
                    <div className="flex flex-col gap-0.5">
                      <span className="line-clamp-1 text-[14px] font-bold leading-tight text-ink">
                        Nồi chiên không dầu Philips HD9252 4.1L
                      </span>
                      <span className="text-[12px] text-ink-3">
                        Đã nhận diện cùng mẫu
                      </span>
                    </div>
                  </div>

                  {/* Price & Deal Score */}
                  <div className="flex items-center justify-between gap-3 rounded-xl bg-canvas p-3.5">
                    <div className="flex flex-col gap-0.5">
                      <span className="text-[12px] text-ink-3">Giá hiện tại</span>
                      <span className="font-[family-name:var(--font-display)] text-[24px] font-extrabold tracking-[-0.02em] text-ink">
                        1.690.000đ
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="relative flex size-[54px] shrink-0 items-center justify-center">
                        <svg width="54" height="54" viewBox="0 0 60 60" aria-hidden="true" className="absolute left-0 top-0">
                          <circle cx="30" cy="30" r="25" fill="none" stroke="var(--line)" strokeWidth="6" />
                          <circle cx="30" cy="30" r="25" fill="none" stroke="var(--buy)" strokeWidth="6" strokeLinecap="round" strokeDasharray="144.5 157.1" transform="rotate(-90 30 30)" />
                        </svg>
                        <span className="font-[family-name:var(--font-display)] text-[20px] font-extrabold tracking-[-0.02em] text-ink">
                          92
                        </span>
                      </div>
                      <div className="flex flex-col">
                        <span className="text-[13px] font-bold text-buy">Nên mua</span>
                        <span className="text-[12px] text-ink-3">Deal Score</span>
                      </div>
                    </div>
                  </div>

                  {/* Recommendation Tag */}
                  <div className="flex items-start gap-2.5 rounded-xl border border-buy bg-buy-soft p-3 text-buy">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="mt-0.5 shrink-0">
                      <path d="M20 6 9 17l-5-5" />
                    </svg>
                    <div className="flex flex-col gap-0.5">
                      <span className="text-[14px] font-bold">Nên mua</span>
                      <span className="text-[12px] leading-tight text-ink">
                        Gần mức thấp nhất 90 ngày hệ thống ghi nhận
                      </span>
                    </div>
                  </div>

                  {/* Stats Tiles */}
                  <div className="grid grid-cols-2 gap-2.5">
                    <div className="flex flex-col gap-0.5 rounded-xl border border-line p-2.5">
                      <span className="text-[12px] text-ink-3">Thấp nhất 90 ngày</span>
                      <span className="font-[family-name:var(--font-display)] text-[16px] font-bold text-ink">
                        1.650.000đ
                      </span>
                    </div>
                    <div className="flex flex-col gap-0.5 rounded-xl border border-line p-2.5">
                      <span className="text-[12px] text-ink-3">Trung vị 90 ngày</span>
                      <span className="font-[family-name:var(--font-display)] text-[16px] font-bold text-ink">
                        1.930.000đ
                      </span>
                    </div>
                  </div>

                  {/* Sparkline */}
                  <svg width="100%" height="48" viewBox="0 0 360 56" preserveAspectRatio="none" role="img" aria-label="Lịch sử giá" className="w-full">
                    <path d="M0 22 L25 16 L50 24 L75 14 L100 20 L125 12 L150 18 L175 16 L200 48 L215 20 L240 14 L265 22 L290 18 L315 30 L340 42 L354 46" fill="none" stroke="var(--ink-2)" strokeWidth="2" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
                    <circle cx="354" cy="46" r="4" fill="var(--primary)" />
                  </svg>

                  {/* Other Sellers */}
                  <div className="flex flex-col gap-2">
                    <span className="text-[12px] font-bold text-ink-2">Nơi khác đang bán</span>
                    <div className="flex items-center justify-between gap-2 text-[13px]">
                      <span className="flex items-center gap-2">
                        <span className="rounded-md border border-line bg-surface-2 px-2 py-0.5 text-[12px] font-semibold text-ink-2">
                          Shopee
                        </span>
                        <span>Trang bạn đang xem</span>
                      </span>
                      <span className="font-bold text-ink">1.690.000đ</span>
                    </div>
                    <div className="flex items-center justify-between gap-2 text-[13px]">
                      <span className="flex items-center gap-2">
                        <span className="rounded-md border border-line bg-surface-2 px-2 py-0.5 text-[12px] font-semibold text-ink-2">
                          TikTok Shop
                        </span>
                        <span>Philips Việt Nam</span>
                      </span>
                      <span className="font-semibold text-ink-2">1.749.000đ</span>
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex flex-col gap-2 pt-2">
                    <button
                      type="button"
                      className="flex h-11 items-center justify-center gap-2 rounded-xl bg-accent text-[14px] font-bold text-ink"
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.94 1.94 0 0 0 3.4 0" />
                      </svg>
                      <span>Theo dõi giá</span>
                    </button>
                    <div className="grid grid-cols-2 gap-2">
                      <span className="flex h-10 items-center justify-center rounded-xl border border-line-strong text-[13px] font-semibold text-ink">
                        Xem lịch sử giá
                      </span>
                      <span className="flex h-10 items-center justify-center rounded-xl border border-line-strong text-[13px] font-semibold text-ink">
                        So sánh giá
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Popup 2: Insufficient Data */}
            <div className="flex flex-col gap-3">
              <span className="text-[13px] font-bold text-ink-3">
                Popup: chưa đủ dữ liệu
              </span>
              <div className="w-[360px] overflow-hidden rounded-[20px] border border-line bg-surface shadow-sm">
                {/* Header */}
                <div className="flex items-center gap-2.5 bg-night px-4 py-3 text-night-ink">
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-accent">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--ink)" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M3 17l6-6 4 4 8-8M15 7h6v6" />
                    </svg>
                  </span>
                  <span className="flex-1 font-[family-name:var(--font-display)] text-[18px] font-extrabold tracking-[-0.02em]">
                    Kairo
                  </span>
                  <span className="rounded-full border border-night-line bg-night-2 px-2.5 py-1 text-[12px] font-semibold text-night-ink-2">
                    Trên Shopee
                  </span>
                </div>

                {/* Content */}
                <div className="flex flex-col gap-3.5 p-4">
                  {/* Product snippet */}
                  <div className="flex items-center gap-3">
                    <span className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-tint-sky">
                      <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="var(--ink)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <rect x="3" y="4" width="18" height="12" rx="2" />
                        <path d="M8 20h8M12 16v4" />
                      </svg>
                    </span>
                    <div className="flex flex-col gap-0.5">
                      <span className="line-clamp-1 text-[14px] font-bold leading-tight text-ink">
                        Màn hình Dell S2425H 24 inch
                      </span>
                      <span className="text-[12px] text-ink-3">
                        Đã nhận diện cùng mẫu
                      </span>
                    </div>
                  </div>

                  {/* Price & Deal Score */}
                  <div className="flex items-center justify-between gap-3 rounded-xl bg-canvas p-3.5">
                    <div className="flex flex-col gap-0.5">
                      <span className="text-[12px] text-ink-3">Giá hiện tại</span>
                      <span className="font-[family-name:var(--font-display)] text-[24px] font-extrabold tracking-[-0.02em] text-ink">
                        2.790.000đ
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="relative flex size-[54px] shrink-0 items-center justify-center">
                        <svg width="54" height="54" viewBox="0 0 60 60" aria-hidden="true" className="absolute left-0 top-0">
                          <circle cx="30" cy="30" r="25" fill="none" stroke="var(--ink-3)" strokeWidth="2" strokeDasharray="4 4" />
                        </svg>
                        <span className="font-[family-name:var(--font-display)] text-[20px] font-extrabold text-ink-3">
                          —
                        </span>
                      </div>
                      <div className="flex flex-col">
                        <span className="text-[13px] font-bold text-ink-3">Chưa đủ</span>
                        <span className="text-[12px] text-ink-3">dữ liệu</span>
                      </div>
                    </div>
                  </div>

                  {/* Recommendation Tag */}
                  <div className="flex items-start gap-2.5 rounded-xl border border-dashed border-ink-3 bg-surface-2 p-3 text-ink-3">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="mt-0.5 shrink-0">
                      <circle cx="12" cy="12" r="9" />
                      <path d="M12 7v5l3 2" />
                    </svg>
                    <div className="flex flex-col gap-0.5">
                      <span className="text-[14px] font-bold text-ink">Chưa đủ dữ liệu</span>
                      <span className="text-[12px] leading-tight text-ink-2">
                        Mới ghi nhận 6/14 ngày. Kairo sẽ chấm điểm khi đủ lịch sử giá.
                      </span>
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex flex-col gap-2 pt-2">
                    <button
                      type="button"
                      className="flex h-11 items-center justify-center gap-2 rounded-xl bg-accent text-[14px] font-bold text-ink"
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.94 1.94 0 0 0 3.4 0" />
                      </svg>
                      <span>Theo dõi giá</span>
                    </button>
                    <span className="text-center text-[12px] text-ink-3">
                      Dữ liệu hệ thống ghi nhận, cập nhật 12 phút trước
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

import Link from "next/link";
import { Wordmark } from "./logo-mark";
import { MarketplaceMark } from "@/components/product/marketplace-mark";

const COLUMNS: Array<{ title: string; links: Array<{ href: string; label: string }> }> = [
  {
    title: "Khám phá",
    links: [
      { href: "/search", label: "Tìm kiếm sản phẩm" },
      { href: "/radar", label: "Giảm giá thật" },
      { href: "/trending", label: "Xu hướng" },
      { href: "/compare", label: "So sánh hai sản phẩm" },
      { href: "/extension", label: "Tiện ích trình duyệt" },
    ],
  },
  {
    title: "Minh bạch",
    links: [
      { href: "/deal-score", label: "Độ chính xác Deal Score" },
      { href: "/terms#affiliate", label: "Công bố tiếp thị liên kết" },
    ],
  },
  {
    title: "Pháp lý",
    links: [
      { href: "/privacy", label: "Chính sách bảo mật" },
      { href: "/terms", label: "Điều khoản" },
    ],
  },
];

// The verdict scale, as the footer's signature: the same three zones the engine uses.
const SCALE = [
  { label: "Chưa nên mua", range: "0–49", tone: "bg-avoid", grow: "basis-1/2" },
  { label: "Có thể chờ", range: "50–74", tone: "bg-wait", grow: "basis-1/4" },
  { label: "Nên mua", range: "75–100", tone: "bg-buy", grow: "basis-1/4" },
];

export function SiteFooter() {
  return (
    <footer className="scope-night mt-auto bg-night text-night-ink-2">
      <div className="mx-auto max-w-[1440px] px-4 pb-10 pt-14 sm:px-6 lg:px-14 lg:pt-20">
        <div className="grid gap-12 lg:grid-cols-[1.2fr_1fr] lg:gap-20">
          <div className="flex flex-col gap-7">
            <p className="display max-w-[16ch] text-h2 font-bold leading-[1.02] text-night-ink sm:text-h1">
              Mua đúng lúc. <span className="text-night-ink-3">Không mua vội.</span>
            </p>
            <p className="flex flex-wrap items-center gap-x-3 gap-y-2 text-body-sm text-night-ink-2">
              <span className="eyebrow text-night-ink-3">So giá giữa</span>
              <span className="inline-flex items-center gap-2 font-semibold text-night-ink">
                <MarketplaceMark marketplace="shopee" />
                Shopee
              </span>
              <span aria-hidden="true" className="text-night-ink-3">⇄</span>
              <span className="inline-flex items-center gap-2 font-semibold text-night-ink">
                <MarketplaceMark marketplace="tiktok" />
                TikTok Shop
              </span>
            </p>
            <div className="flex max-w-lg flex-col gap-2">
              <div aria-hidden="true" className="flex h-1.5 gap-1 overflow-hidden rounded-full">
                {SCALE.map((s) => (
                  <span key={s.label} className={`${s.grow} ${s.tone}`} />
                ))}
              </div>
              <div className="flex gap-1 text-micro text-night-ink-3">
                {SCALE.map((s) => (
                  <span key={s.label} className={`${s.grow} min-w-0 truncate last:text-right`}>
                    <span className="num font-semibold text-night-ink-2">{s.range}</span> {s.label}
                  </span>
                ))}
              </div>
            </div>
          </div>

          <nav aria-label="Chân trang" className="grid grid-cols-2 gap-8 sm:grid-cols-3">
            {COLUMNS.map((col) => (
              <div key={col.title} className="flex flex-col gap-4">
                <span className="eyebrow text-night-ink-3">{col.title}</span>
                <ul className="flex flex-col gap-2.5">
                  {col.links.map((l) => (
                    <li key={l.href}>
                      <Link href={l.href} className="text-body-sm text-night-ink-2 underline-offset-4 transition-colors hover:text-night-ink hover:underline">
                        {l.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </nav>
        </div>

        <div className="mt-14 grid gap-6 border-t border-night-line/70 pt-8 lg:grid-cols-[auto_1fr] lg:items-center lg:gap-14">
          <Link href="/" aria-label="DealScore — Trang chủ" className="w-fit rounded-inner">
            <Wordmark tone="night" />
          </Link>
          <p className="max-w-3xl text-label leading-relaxed text-night-ink-3 lg:justify-self-end lg:text-right">
            Nếu bạn mua qua liên kết, DealScore có thể nhận hoa hồng. Điều này không làm thay đổi giá bạn trả. Hoa hồng tiếp thị không nằm trong phép tính Deal Score.
          </p>
        </div>
      </div>
      <div className="border-t border-night-line/50">
        <div className="mx-auto flex max-w-[1440px] flex-wrap items-center justify-between gap-3 px-4 py-4 text-micro text-night-ink-3 sm:px-6 lg:px-14">
          <span>© {new Date().getFullYear()} DealScore</span>
          <span className="eyebrow inline-flex items-center gap-2">
            <span aria-hidden="true" className="size-1.5 rounded-full bg-night-ink-3" />
            Không thuộc về sàn nào
          </span>
        </div>
      </div>
    </footer>
  );
}

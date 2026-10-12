import Link from "next/link";
import { ScoreRing, VerdictTag } from "@/components/product/verdict-tag";
import { MarketplaceMark } from "@/components/product/marketplace-mark";

interface HeroSampleCardProps {
  href?: string;
}

// Illustration only (labelled as such): one product, its best price on each marketplace, its 90 days.
const LINE = "M0 30 L25 27 L50 33 L75 22 L100 27 L125 20 L150 40 L170 27 L200 22 L225 30 L250 25 L275 36 L300 48 L325 55 L350 57";
const SIDES = [
  { marketplace: "shopee", name: "Shopee", price: "395.000đ", sellers: 4, width: 96, best: true },
  { marketplace: "tiktok", name: "TikTok Shop", price: "412.000đ", sellers: 3, width: 100, best: false },
] as const;

/**
 * Hero illustration — the face-off: the same product's best price on Shopee and on TikTok Shop, side
 * by side across a neutral centre line, then where today's price sits in its 90 days and the verdict.
 */
export function HeroSampleCard({ href = "/search?q=kem+ch%E1%BB%91ng+n%E1%BA%AFng+Anessa" }: HeroSampleCardProps) {
  return (
    <div className="relative">
      {/* Two cards stacked behind: one product, many sellers. */}
      <span aria-hidden="true" className="absolute inset-x-10 -bottom-5 top-10 rounded-hero border border-line bg-surface/45 max-sm:hidden" />
      <span aria-hidden="true" className="absolute inset-x-5 -bottom-2.5 top-5 rounded-hero border border-line bg-surface/75 max-sm:hidden" />

      <Link
        href={href}
        className="group relative flex flex-col overflow-hidden rounded-hero border border-line bg-surface text-ink shadow-lift transition-transform duration-300 ease-out hover:-translate-y-1"
      >
        <div className="flex items-center justify-between gap-3 border-b border-line px-6 py-3">
          <span className="eyebrow flex items-center gap-2 text-ink-3">
            <span aria-hidden="true" className="size-1.5 rounded-full bg-primary" />
            Ví dụ minh họa
          </span>
          <span className="text-micro text-ink-3">Số liệu mẫu</span>
        </div>

        <div className="flex items-start justify-between gap-4 px-6 pb-5 pt-5">
          <div className="flex min-w-0 flex-col gap-1.5">
            <span className="text-label text-ink-3">Mỹ phẩm · Đã gom 7 nơi bán cùng mẫu</span>
            <span className="display text-h4 font-bold leading-snug">Kem chống nắng Anessa Perfect UV Milk 60ml</span>
          </div>
          <div className="flex shrink-0 flex-col items-center gap-1">
            <ScoreRing score={86} recommendation="buy" size="md" />
            <span className="eyebrow text-ink-3">Deal Score</span>
          </div>
        </div>

        {/* The face-off */}
        <div className="relative grid grid-cols-2 border-y border-line">
          {SIDES.map((s, i) => (
            <div key={s.marketplace} className={`flex min-w-0 flex-col gap-3 py-5 ${i === 0 ? "bg-primary-soft/50 pl-5 pr-7 sm:pl-6 sm:pr-8" : "pl-7 pr-5 sm:pl-8 sm:pr-6"}`}>
              <span className="flex items-center gap-2 text-label font-semibold text-ink">
                <MarketplaceMark marketplace={s.marketplace} />
                <span className="truncate">{s.name}</span>
              </span>
              <span className="flex flex-col gap-1">
                <span className={`num text-h3 font-bold leading-none tracking-tight ${s.best ? "text-ink" : "text-ink-2"}`}>{s.price}</span>
                <span className="text-micro text-ink-3">{s.sellers} người bán còn hàng</span>
              </span>
              <span aria-hidden="true" className="h-1.5 w-full overflow-hidden rounded-full bg-surface-2">
                <span className={`bar-grow block h-full origin-left rounded-full ${s.best ? "bg-primary" : "bg-line-strong/50"}`} style={{ width: `${s.width}%` }} />
              </span>
              {s.best ? (
                <span className="inline-flex w-fit items-center rounded-full bg-primary px-2.5 py-0.5 text-micro font-semibold text-on-primary">
                  Rẻ hơn 17.000đ
                </span>
              ) : (
                <span className="num text-micro font-medium text-ink-3">+17.000đ</span>
              )}
            </div>
          ))}
          <span aria-hidden="true" className="absolute inset-y-0 left-1/2 w-px bg-line" />
          <span
            aria-hidden="true"
            className="display absolute left-1/2 top-1/2 flex size-10 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-line bg-surface text-label font-bold text-ink-2 shadow-sm"
          >
            VS
          </span>
        </div>

        <div className="flex flex-col gap-4 p-5 sm:p-6">
          <div className="relative h-[64px] w-full overflow-hidden rounded-tile bg-surface-2/70">
            <svg width="100%" height="64" viewBox="0 0 350 64" preserveAspectRatio="none" role="img" aria-label="Biểu đồ giá 90 ngày, đang giảm về gần mức thấp nhất">
              <defs>
                <linearGradient id="hero-fill" x1="0" x2="0" y1="0" y2="1">
                  <stop offset="0%" stopColor="var(--primary)" stopOpacity="0.22" />
                  <stop offset="100%" stopColor="var(--primary)" stopOpacity="0" />
                </linearGradient>
              </defs>
              <path d={`${LINE} L350 64 L0 64 Z`} fill="url(#hero-fill)" />
              <path d={LINE} pathLength={1} fill="none" stroke="var(--primary)" strokeWidth="2" strokeLinejoin="round" vectorEffect="non-scaling-stroke" className="draw-line" />
            </svg>
            <span className="absolute right-1.5 top-[51px] size-2.5 rounded-full bg-surface ring-[3px] ring-primary" aria-hidden="true" />
            <span className="eyebrow absolute left-3 top-2 text-ink-3">90 ngày</span>
            <span className="num absolute right-3 top-2 text-micro font-semibold text-ink-2">Thấp nhất 389.000đ</span>
          </div>

          <VerdictTag recommendation="buy" size="lg" note="Gần đáy 90 ngày, thấp hơn 24% so với trung vị 30 ngày." />
        </div>
      </Link>
    </div>
  );
}

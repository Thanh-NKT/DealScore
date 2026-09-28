import Link from "next/link";
import { CheckIcon } from "@/components/ui/icons";

interface HeroSampleCardProps {
  href?: string;
}

export function HeroSampleCard({ href = "/search?q=kem+ch%E1%BB%91ng+n%E1%BA%AFng+Anessa" }: HeroSampleCardProps) {
  return (
    <Link
      href={href}
      className="flex flex-col gap-5 rounded-lg border border-line bg-surface p-7 text-ink transition-colors duration-150 ease-out hover:border-line-strong"
    >
      <div className="flex items-center justify-between gap-3">
        <span className="rounded-sm border border-line bg-surface-2 px-2.5 py-1 text-micro font-semibold text-ink-2">
          Ví dụ minh họa
        </span>
        <span className="text-micro text-ink-3">Số liệu mẫu, không phải giá thật</span>
      </div>

      <div className="flex items-center gap-4">
        <div className="flex size-[76px] shrink-0 items-center justify-center rounded-md bg-wait-soft">
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="var(--ink)" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M8 3h8l-1 4H9zM9 7h6l1 12a2 2 0 0 1-2 2h-4a2 2 0 0 1-2-2z" />
          </svg>
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-label font-semibold text-ink-3">Mỹ phẩm · Đã gom 7 nơi bán cùng mẫu</span>
          <span className="text-title font-semibold leading-[1.35] text-ink">
            Kem chống nắng Anessa Perfect UV Milk 60ml
          </span>
        </div>
      </div>

      <div className="flex items-end justify-between gap-4">
        <div className="flex flex-col gap-1">
          <span className="text-label text-ink-3">Giá tốt nhất hiện tại</span>
          <span className="num display text-stat font-extrabold leading-[1.1] tracking-tight">395.000đ</span>
          <span className="flex items-center gap-1.5 text-label text-ink-3">
            <s className="text-ink-3">520.000đ</s>
            <span className="num rounded-sm bg-buy-soft px-1.5 py-0.5 text-micro font-bold text-buy">−24%</span>
            <span>· Shopee</span>
          </span>
        </div>

        <div className="relative flex size-[88px] shrink-0 items-center justify-center">
          <svg width="88" height="88" viewBox="0 0 96 96" aria-hidden="true" className="absolute left-0 top-0 size-full">
            <circle cx="48" cy="48" r="40" fill="none" stroke="var(--surface-2)" strokeWidth="8.5" />
            <circle
              cx="48"
              cy="48"
              r="40"
              fill="none"
              stroke="var(--buy)"
              strokeWidth="8.5"
              strokeLinecap="round"
              strokeDasharray="216 252"
              transform="rotate(-90 48 48)"
            />
          </svg>
          <div className="flex flex-col items-center">
            <span className="num display text-h1-sm font-extrabold leading-none tracking-tight">86</span>
            <span className="mt-0.5 text-nano font-semibold text-ink-3">Deal Score</span>
          </div>
          <span
            aria-hidden="true"
            className="absolute bottom-0.5 right-0.5 flex size-6 items-center justify-center rounded-full bg-buy text-canvas ring-2 ring-surface"
          >
            <CheckIcon className="size-3.5" strokeWidth={3} />
          </span>
        </div>
      </div>

      <div className="h-[80px] w-full overflow-hidden rounded-sm bg-surface-2/40 px-2 pt-2">
        <svg width="100%" height="72" viewBox="0 0 400 72" preserveAspectRatio="none" aria-label="Biểu đồ giá 90 ngày, đang giảm về gần mức thấp nhất" role="img">
          <path d="M0 24 L30 20 L60 28 L90 18 L120 22 L150 16 L180 42 L200 24 L230 18 L260 26 L290 22 L320 32 L350 48 L375 54 L400 56 L400 72 L0 72 Z" fill="var(--buy-soft)" />
          <path d="M0 24 L30 20 L60 28 L90 18 L120 22 L150 16 L180 42 L200 24 L230 18 L260 26 L290 22 L320 32 L350 48 L375 54 L400 56" fill="none" stroke="var(--buy)" strokeWidth="2.5" strokeLinejoin="round" />
          <circle cx="395" cy="56" r="4.5" fill="var(--primary)" />
        </svg>
      </div>

      <div className="flex items-center gap-3 rounded-md border border-buy/25 bg-buy-soft p-3 sm:px-4 text-buy">
        <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-buy text-canvas">
          <CheckIcon className="size-4" strokeWidth={3} />
        </span>
        <div className="flex flex-col gap-0.5">
          <span className="text-control font-bold">Nên mua · 86 điểm</span>
          <span className="text-label text-ink-2">Gần đáy 90 ngày, thấp hơn 24% so với trung vị 30 ngày.</span>
        </div>
      </div>
    </Link>
  );
}

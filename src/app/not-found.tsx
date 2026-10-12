import type { Metadata } from "next";
import { ButtonLink } from "@/components/ui/button";
import { ScoreRing, VerdictTag } from "@/components/product/verdict-tag";

export const metadata: Metadata = {
  title: "Không tìm thấy trang | DealScore",
  robots: { index: false },
};

/** 404 for notFound() and unmatched routes: what happened + the two ways forward. */
export default function NotFound() {
  return (
    <main className="flex w-full flex-1 items-center bg-ledger">
      <div className="mx-auto w-full max-w-[1440px] px-4 py-16 sm:px-6 lg:px-14">
        <div className="mx-auto flex w-full max-w-[620px] flex-col gap-6 rounded-hero border border-line bg-surface p-8 shadow-lift max-sm:p-5">
          <div className="flex items-center justify-between gap-4 border-b border-line pb-6">
            <div className="flex flex-col gap-2">
              <span className="eyebrow text-ink-3">Lỗi 404</span>
              <span className="display text-display font-semibold leading-none tracking-tighter text-ink max-sm:text-h1">404</span>
            </div>
            <div className="flex flex-col items-center gap-2">
              <ScoreRing score={null} recommendation={null} size="lg" />
              <VerdictTag recommendation={null} />
            </div>
          </div>
          <div className="flex flex-col gap-2">
            <h1 className="display text-h3 font-semibold text-ink">Không tìm thấy trang này</h1>
            <p className="text-body-sm leading-relaxed text-ink-2">
              Đường dẫn có thể đã cũ, hoặc sản phẩm đã được gộp vào một trang khác. Bạn có thể tìm lại theo tên, hoặc dán link
              sản phẩm ở trang chủ.
            </p>
          </div>
          <div className="flex flex-wrap gap-2.5">
            <ButtonLink href="/search">Tìm sản phẩm</ButtonLink>
            <ButtonLink href="/" variant="secondary">
              Về trang chủ
            </ButtonLink>
          </div>
        </div>
      </div>
    </main>
  );
}

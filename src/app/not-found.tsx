import type { Metadata } from "next";
import { SearchIcon } from "@/components/ui/icons";
import { ButtonLink } from "@/components/ui/button";

export const metadata: Metadata = {
  title: "Không tìm thấy trang | DealScore",
  robots: { index: false },
};

/** 404 for notFound() and unmatched routes: what happened + the two ways forward. */
export default function NotFound() {
  return (
    <main className="mx-auto flex w-full max-w-[1440px] flex-1 items-center justify-center px-4 py-16 sm:px-6 lg:px-14">
      <div className="flex w-full max-w-[560px] flex-col gap-4 rounded-lg border border-line bg-surface p-7 max-sm:p-5">
        <span className="grid size-10 place-items-center rounded-md bg-surface-2 text-ink">
          <SearchIcon className="size-5" />
        </span>
        <h1 className="display text-h3 font-bold text-ink">Không tìm thấy trang này</h1>
        <p className="text-body-sm leading-relaxed text-ink-2">
          Đường dẫn có thể đã cũ, hoặc sản phẩm đã được gộp vào một trang khác. Bạn có thể tìm lại theo tên, hoặc dán link
          sản phẩm Shopee ở trang chủ.
        </p>
        <div className="flex flex-wrap gap-2.5 pt-1">
          <ButtonLink href="/search">Tìm sản phẩm</ButtonLink>
          <ButtonLink href="/" variant="secondary">
            Về trang chủ
          </ButtonLink>
        </div>
      </div>
    </main>
  );
}

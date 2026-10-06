import Link from "next/link";

export function SiteFooter() {
  return (
    <footer className="mt-auto border-t border-line bg-surface px-4 py-8 sm:px-6 lg:px-14">
      <div className="mx-auto flex max-w-[1440px] flex-wrap items-center justify-between gap-6 sm:gap-10">
        <div className="flex flex-col gap-2">
          <span className="display text-title font-bold tracking-tight text-ink">Kairo</span>
          <p className="max-w-[75ch] text-label leading-[1.45] text-ink-3">
            Nếu bạn mua qua liên kết, DealScore có thể nhận hoa hồng. Điều này không làm thay đổi giá bạn trả. Hoa hồng tiếp thị không nằm trong phép tính Deal Score.
          </p>
        </div>
        <nav aria-label="Chân trang" className="flex flex-wrap gap-5 text-label font-medium text-ink-2">
          <Link href="/privacy" className="hover:text-ink transition-colors">
            Chính sách bảo mật
          </Link>
          <Link href="/terms" className="hover:text-ink transition-colors">
            Điều khoản
          </Link>
          <Link href="/terms#affiliate" className="hover:text-ink transition-colors">
            Công bố tiếp thị liên kết
          </Link>
        </nav>
      </div>
    </footer>
  );
}

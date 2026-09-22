import Link from "next/link";
import { UrlLookupForm } from "@/components/lookup/url-lookup-form";

interface EmptyStateProps {
  query?: string;
  hasFilters?: boolean;
}

export function EmptyState({ query, hasFilters = false }: EmptyStateProps) {
  if (query) {
    return (
      <div className="rounded-2xl border border-border bg-black/[0.01] p-8 text-center dark:bg-white/[0.01] space-y-6 max-w-lg mx-auto">
        <div className="space-y-2">
          <div className="text-3xl" aria-hidden="true">
            🔍
          </div>
          <h3 className="text-lg font-bold text-foreground">
            Không tìm thấy sản phẩm nào cho &ldquo;{query}&rdquo;
          </h3>
          <p className="text-xs text-muted leading-relaxed">
            Hãy thử kiểm tra lại từ khóa hoặc xóa bớt các bộ lọc đang chọn. Nếu bạn đã có link sản phẩm từ Shopee, hãy dán trực tiếp vào bên dưới:
          </p>
        </div>

        <div className="border-t border-border pt-6">
          <UrlLookupForm />
        </div>
      </div>
    );
  }

  if (hasFilters) {
    return (
      <div className="rounded-2xl border border-border bg-black/[0.01] p-8 text-center dark:bg-white/[0.01] space-y-4">
        <div className="text-3xl" aria-hidden="true">
          🏷️
        </div>
        <h3 className="text-lg font-bold text-foreground">
          Không có sản phẩm nào khớp bộ lọc
        </h3>
        <p className="text-xs text-muted">
          Khoảng giá hoặc các thương hiệu bạn chọn quá hẹp.
        </p>
        <div>
          <Link
            href="/tim-kiem"
            className="inline-flex items-center rounded-xl bg-foreground px-4 py-2 text-xs font-semibold text-background hover:opacity-90"
          >
            Xóa tất cả bộ lọc
          </Link>
        </div>
      </div>
    );
  }

  return null;
}

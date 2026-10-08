import Link from "next/link";
import { UrlLookupForm } from "@/components/lookup/url-lookup-form";
import { AlertIcon, InfoIcon } from "@/components/ui/icons";
import { buttonClass } from "@/components/ui/button";

export type EmptyKind =
  /** The catalog has nothing matching the words. */
  | "no_results"
  /** Something matched the words, but the filters removed all of it. */
  | "too_strict"
  /** The search itself failed (database/network). */
  | "load_error"
  /** A marketplace data source is down, so results may be missing. */
  | "source_unavailable"
  /** ?page= is past the last page (old link, results shrank). */
  | "page_out_of_range";

interface EmptyStateProps {
  kind: EmptyKind;
  query?: string;
  /** Same search without any filter. */
  clearFiltersHref?: string;
  /** Same search, page 1. */
  firstPageHref?: string;
  /** The current URL, to retry. */
  retryHref?: string;
  /** Marketplace name for source_unavailable. */
  source?: string;
  /** Same search without "Chỉ hiện Nên mua" — set only while that filter is on. */
  onlyBuyOffHref?: string;
}

const PRIMARY = buttonClass({ size: "md" });
const SECONDARY = buttonClass({ variant: "secondary", size: "md" });

function quoted(q: string): string {
  const t = q.trim();
  return `“${t.length > 60 ? `${t.slice(0, 60)}…` : t}”`;
}

/**
 * Empty results matching Search.html mockup:
 * Calm, dashed border, rounded-20px card, clear message and primary reset action.
 */
function OnlyBuyHint({ href }: { href: string }) {
  return (
    <p className="mt-3 flex max-w-[52ch] items-start gap-2 text-left text-body-sm leading-relaxed text-ink-2">
      <InfoIcon className="mt-1 size-4 shrink-0 text-ink-2" />
      <span>
        Thử{" "}
        <Link href={href} scroll={false} className="font-semibold text-primary underline-offset-4 hover:underline">
          tắt “Chỉ hiện Nên mua”
        </Link>{" "}
        — có thể có sản phẩm tốt đang ở mức Có thể chờ.
      </span>
    </p>
  );
}

export function EmptyState({
  kind,
  query,
  clearFiltersHref = "/search",
  firstPageHref = "/search",
  retryHref = "/search",
  source,
  onlyBuyOffHref,
}: EmptyStateProps) {
  const q = query?.trim();

  if (kind === "load_error" || kind === "source_unavailable") {
    return (
      <div role="alert" className="rounded-lg border border-line bg-surface p-7 max-sm:p-5">
        <div className="flex max-w-[62ch] items-start gap-3.5">
          <span className="grid size-10 shrink-0 place-items-center rounded-md bg-surface-2 text-ink">
            <AlertIcon className="size-5" />
          </span>
          <div className="min-w-0">
            <h2 className="display text-h3 font-bold text-balance text-ink [overflow-wrap:anywhere] max-sm:text-title">
              {kind === "load_error" ? "Chưa tải được kết quả tìm kiếm" : `Dữ liệu từ ${source ?? "sàn"} đang tạm gián đoạn`}
            </h2>
            <p className="mt-1.5 text-body leading-relaxed text-ink-2">
              {kind === "load_error"
                ? "Kết nối tới hệ thống đang gặp trục trặc, không phải do từ khóa của bạn. Thử lại sau giây lát."
                : `DealScore tạm thời không cập nhật được giá từ ${source ?? "sàn này"}, nên kết quả có thể thiếu hoặc giá chưa mới. Thử lại sau ít phút.`}
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              <a href={retryHref} className={PRIMARY}>
                Thử lại
              </a>
              <Link href="/" className={SECONDARY}>
                Về trang chủ
              </Link>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (kind === "page_out_of_range") {
    return (
      <div className="flex flex-col items-center rounded-lg border border-dashed border-line-strong bg-surface p-8 sm:p-16 text-center">
        <h2 className="display text-h3 font-bold text-ink max-sm:text-title">Trang này không còn kết quả</h2>
        <p className="mt-1.5 text-body leading-relaxed text-ink-2">Số kết quả đã ít đi so với lúc đường dẫn này được tạo.</p>
        <Link href={firstPageHref} className={`${PRIMARY} mt-5`}>
          Về trang đầu
        </Link>
      </div>
    );
  }

  if (kind === "too_strict") {
    return (
      <div className="flex flex-col items-center rounded-lg border border-dashed border-line-strong bg-surface p-8 sm:p-16 text-center">
        <h2 className="display text-h3 font-bold text-balance text-ink [overflow-wrap:anywhere] max-sm:text-title">
          Chưa có sản phẩm khớp bộ lọc
        </h2>
        {onlyBuyOffHref && <OnlyBuyHint href={onlyBuyOffHref} />}
        <p className="mt-1.5 max-w-[46ch] text-body leading-relaxed text-ink-2">
          {q ? `Không có sản phẩm nào cho ${quoted(q)} khớp với các bộ lọc đang chọn.` : "Thử bỏ bớt thương hiệu."}
        </p>
        <Link href={clearFiltersHref} className={`${SECONDARY} mt-5`}>
          Xóa lọc
        </Link>
      </div>
    );
  }

  // no_results
  return (
    <div className="space-y-6 rounded-lg border border-dashed border-line-strong bg-surface p-7 sm:p-8 [&>*]:max-w-[62ch]">
      <div>
        <h2 className="display text-h3 font-bold text-ink max-sm:text-title [overflow-wrap:anywhere]">
          {q ? `Chưa có sản phẩm nào cho ${quoted(q)}` : "Chưa có sản phẩm nào"}
        </h2>
        {onlyBuyOffHref && <OnlyBuyHint href={onlyBuyOffHref} />}
        <p className="mt-1.5 text-body leading-relaxed text-ink-2">
          DealScore chỉ tìm trong những sản phẩm hệ thống đã theo dõi, nên có thể sản phẩm bạn cần chưa có ở đây.
        </p>
        <ul className="mt-3 space-y-1.5 text-body-sm text-ink-2">
          <li className="flex gap-2">
            <InfoIcon className="mt-1 size-4 shrink-0 text-ink-2" />
            Thử từ ngắn hơn: tên hãng hoặc model (ví dụ “Anessa”, “Lock&amp;Lock 5,2L”).
          </li>
          <li className="flex gap-2">
            <InfoIcon className="mt-1 size-4 shrink-0 text-ink-2" />
            Gõ không dấu cũng được, nhưng kiểm tra lại chính tả.
          </li>
        </ul>
      </div>
      <div className="border-t border-line pt-6">
        <p className="mb-3 text-body-sm font-semibold text-ink">Có link sản phẩm Shopee? Dán vào đây để DealScore bắt đầu theo dõi:</p>
        <UrlLookupForm />
      </div>
    </div>
  );
}

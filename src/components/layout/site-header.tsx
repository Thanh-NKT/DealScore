import Link from "next/link";
import { unstable_rethrow } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { BellIcon, MonitorIcon } from "@/components/ui/icons";
import { AccountMenu, HeaderNav } from "./header-nav";
import { Wordmark } from "./logo-mark";
import { MarketplaceMark } from "@/components/product/marketplace-mark";
import { ThemeToggle } from "./theme-toggle";

const ICON_BTN =
  "relative flex size-10 items-center justify-center rounded-full text-ink-2 transition-colors duration-150 ease-out hover:bg-surface-2 hover:text-ink max-[440px]:size-9";

/**
 * Sticky site header: a thin midnight "neutral ground" line (the marketplaces DealScore compares, side by
 * side, and who it answers to), then logo, primary nav and actions on frosted paper.
 * Below 1024px the nav drops to its own scrollable row so nothing overlaps at 375px.
 */
export async function SiteHeader() {
  let user: Awaited<ReturnType<typeof getCurrentUser>> = null;
  try {
    user = await getCurrentUser();
  } catch (err) {
    // Let Next's own control-flow errors (dynamic usage during prerender, redirects) through.
    unstable_rethrow(err);
    console.error("SiteHeader: getCurrentUser failed", err);
  }

  return (
    <header className="sticky top-0 z-40 w-full shrink-0">
      <div className="bg-night text-night-ink-2 max-[640px]:hidden">
        <div className="mx-auto flex h-9 max-w-[1440px] items-center justify-between gap-6 px-4 sm:px-6 lg:px-14">
          <p className="flex min-w-0 items-center gap-3 text-micro">
            <span className="flex shrink-0 items-center gap-1.5 font-semibold text-night-ink">
              <MarketplaceMark marketplace="shopee" size="sm" />
              Shopee
              <span aria-hidden="true" className="px-0.5 text-night-ink-3">⇄</span>
              <MarketplaceMark marketplace="tiktok" size="sm" />
              TikTok Shop
            </span>
            <span aria-hidden="true" className="h-3 w-px shrink-0 bg-night-line" />
            <span className="truncate">
              Không thuộc về sàn nào — Deal Score chỉ dựa trên lịch sử giá, không ai trả tiền để được xếp hạng.
            </span>
          </p>
          <Link href="/deal-score" className="shrink-0 text-micro font-semibold text-night-ink-2 underline-offset-4 transition-colors hover:text-night-ink hover:underline max-[900px]:hidden">
            Cách chấm điểm →
          </Link>
        </div>
      </div>

      <div className="border-b border-line bg-surface/85 backdrop-blur-xl backdrop-saturate-150">
        <div className="mx-auto flex h-16 max-w-[1440px] items-center justify-between gap-4 px-4 sm:px-6 lg:px-14 max-[1023px]:h-auto max-[1023px]:flex-wrap max-[1023px]:gap-y-0 max-[1023px]:pt-3 max-[440px]:gap-x-3">
          <div className="flex min-w-0 items-center gap-3 self-stretch sm:gap-8 max-[1023px]:contents">
            <Link href="/" aria-label="DealScore — Trang chủ" className="flex shrink-0 items-center rounded-inner">
              <Wordmark />
            </Link>
            <div className="min-w-0 self-center max-[1023px]:order-last max-[1023px]:-mx-4 max-[1023px]:mt-3 max-[1023px]:w-[calc(100%+2rem)] max-[1023px]:overflow-x-auto max-[1023px]:border-t max-[1023px]:border-line max-[1023px]:px-3 max-[1023px]:py-1.5 max-[1023px]:[scrollbar-width:none]">
              <HeaderNav signedIn={Boolean(user)} />
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-1.5 max-[440px]:gap-0.5">
            <Link
              href="/extension"
              className="mr-1 flex h-10 items-center gap-2 rounded-full border border-line px-4 text-body-sm font-semibold text-ink transition-colors duration-150 ease-out hover:border-primary/40 hover:text-primary max-xl:mr-0 max-xl:w-10 max-xl:justify-center max-xl:border-transparent max-xl:px-0 max-xl:text-ink-2 max-xl:hover:bg-surface-2 max-[680px]:hidden"
            >
              <MonitorIcon className="size-[18px]" />
              {/* Icon-only below 1280px: the wordmark + nav need the room (label kept for screen readers). */}
              <span className="max-xl:sr-only">Cài tiện ích</span>
            </Link>

            <ThemeToggle />

            <Link href="/account/notifications" aria-label="Thông báo" className={ICON_BTN}>
              {/* No unread dot: there is no unread-notification data yet, and a permanent dot is a false signal. */}
              <BellIcon className="size-[19px]" />
            </Link>

            {user ? (
              <AccountMenu email={user.email ?? null} />
            ) : (
              <Link
                href="/login"
                className="ml-1 flex h-10 items-center justify-center rounded-full bg-primary px-5 text-body-sm font-semibold text-on-primary transition-colors duration-150 ease-out hover:bg-primary-hover max-[440px]:ml-0.5 max-[440px]:h-9 max-[440px]:px-3.5 max-[440px]:text-label"
              >
                Đăng nhập
              </Link>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}

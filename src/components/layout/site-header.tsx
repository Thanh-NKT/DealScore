import Link from "next/link";
import { unstable_rethrow } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { BellIcon, MonitorIcon, TrendUpIcon } from "@/components/ui/icons";
import { AccountMenu, HeaderNav } from "./header-nav";
import { ThemeToggle } from "./theme-toggle";

/**
 * Sticky site header matching UI mockup (72px, solid white, 1440px max width, 56px gutters on desktop).
 * Contains logo, primary nav, extension button, notification bell, and account/login.
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
    <header className="sticky top-0 z-40 w-full shrink-0 border-b border-line bg-surface">
      {/* Phones: logo + actions on the first row, the nav on its own scrollable row, so nothing overlaps at 375px. */}
      <div className="mx-auto flex h-[72px] max-w-[1440px] items-center justify-between gap-4 px-4 sm:px-6 lg:px-14 max-[760px]:h-auto max-[760px]:flex-wrap max-[760px]:gap-y-1 max-[760px]:pt-3">
        <div className="flex min-w-0 items-center gap-3 sm:gap-7 max-[760px]:contents">
          <Link href="/" aria-label="Kairo — Trang chủ" className="flex shrink-0 items-center gap-2.5 text-ink">
            <span aria-hidden="true" className="inline-flex size-9 shrink-0 items-center justify-center rounded-md bg-primary text-on-primary shadow-2xs">
              <TrendUpIcon className="size-5" strokeWidth={2.4} />
            </span>
            <span className="display text-h3 font-bold tracking-tight">Kairo</span>
          </Link>
          <div className="min-w-0 max-[760px]:order-last max-[760px]:-mx-4 max-[760px]:w-[calc(100%+2rem)] max-[760px]:overflow-x-auto max-[760px]:px-2.5 max-[760px]:pb-1.5 max-[760px]:[scrollbar-width:none]">
          <HeaderNav signedIn={Boolean(user)} />
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2.5">
          <Link
            href="/extension"
            className="flex h-11 items-center gap-2 rounded-md border border-line bg-surface-2/60 px-3.5 text-body-sm font-semibold text-ink transition-colors duration-150 ease-out hover:border-primary/40 hover:bg-surface-2 max-[680px]:hidden"
          >
            <MonitorIcon className="size-[18px] text-primary" />
            <span>Cài tiện ích</span>
          </Link>

          <ThemeToggle />

          <Link
            href="/account/notifications"
            aria-label="Thông báo"
            className="relative flex size-11 items-center justify-center rounded-md border border-line bg-surface-2/60 text-ink transition-colors duration-150 ease-out hover:border-primary/40 hover:bg-surface-2"
          >
            {/* No unread dot: there is no unread-notification data yet, and a permanent dot is a false signal. */}
            <BellIcon className="size-5" />
          </Link>

          {user ? (
            <AccountMenu email={user.email ?? null} />
          ) : (
            <Link
              href="/login"
              className="flex h-11 items-center justify-center rounded-md px-4 text-body-sm font-semibold text-ink transition-colors duration-150 ease-out hover:bg-surface-2"
            >
              Đăng nhập
            </Link>
          )}
        </div>
      </div>
    </header>
  );
}

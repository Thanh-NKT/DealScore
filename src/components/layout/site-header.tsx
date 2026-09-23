import Link from "next/link";
import { getCurrentUser } from "@/lib/auth/session";
import { signOut } from "@/actions/account";

export async function SiteHeader() {
  const user = await getCurrentUser();

  return (
    <header className="sticky top-0 z-40 w-full border-b border-border bg-background/80 backdrop-blur-md">
      <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-4 sm:px-6">
        {/* Logo & Brand */}
        <div className="flex items-center gap-6">
          <Link
            href="/"
            className="flex items-center gap-2 text-foreground font-black tracking-wider text-base"
          >
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-foreground text-background font-black text-xs">
              K
            </span>
            <span>KAIRO</span>
          </Link>

          <nav className="hidden sm:flex items-center gap-4 text-xs font-medium text-muted">
            <Link
              href="/search"
              className="transition-colors hover:text-foreground"
            >
              Tìm kiếm
            </Link>
            <Link
              href="/account/watch"
              className="transition-colors hover:text-foreground"
            >
              Watch của tôi
            </Link>
          </nav>
        </div>

        {/* Auth / Account */}
        <div className="flex items-center gap-3">
          {user ? (
            <div className="flex items-center gap-3">
              <Link
                href="/account/watch"
                className="inline-flex sm:hidden text-xs text-muted hover:text-foreground"
              >
                Watch
              </Link>
              <Link
                href="/account"
                className="flex items-center gap-2 rounded-full border border-border bg-black/[0.02] px-3 py-1 text-xs font-medium text-foreground hover:bg-black/5 dark:bg-white/[0.02] dark:hover:bg-white/5"
              >
                <span className="h-2 w-2 rounded-full bg-emerald-500"></span>
                <span className="max-w-[120px] truncate sm:max-w-[180px]">
                  {user.email ?? "Tài khoản"}
                </span>
              </Link>
              <form action={signOut} className="hidden sm:inline-block">
                <button
                  type="submit"
                  className="text-xs text-muted hover:text-foreground px-1"
                >
                  Đăng xuất
                </button>
              </form>
            </div>
          ) : (
            <Link
              href="/login"
              className="inline-flex items-center justify-center rounded-lg bg-foreground px-3 py-1.5 text-xs font-semibold text-background transition-opacity hover:opacity-90"
            >
              Đăng nhập
            </Link>
          )}
        </div>
      </div>
    </header>
  );
}

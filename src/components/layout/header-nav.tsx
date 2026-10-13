"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "@/actions/account";
import { ChevronDownIcon } from "@/components/ui/icons";

// Phones: the nav sits on its own scrollable row under the logo, so full labels fit; desktop: inline.
const NAV_LINK =
  "relative inline-flex min-h-10 shrink-0 items-center gap-2 rounded-full px-3.5 text-body-sm transition-colors duration-150 ease-out";

/** Primary navigation. The current section is marked (aria-current) with a soft iris pill. */
export function HeaderNav({ signedIn }: { signedIn: boolean }) {
  const path = usePathname() ?? "/";
  const links = [
    { href: "/search", label: "Tìm kiếm", active: path.startsWith("/search") },
    { href: "/radar", label: "Giảm giá thật", active: path.startsWith("/radar") },
    { href: "/trending", label: "Xu hướng", active: path.startsWith("/trending") },
    { href: "/compare", label: "So sánh", active: path.startsWith("/compare") },
    { href: "/account/watch", label: "Đang theo dõi", active: path.startsWith("/account/watch") },
  ];

  // Phones: the nav row scrolls sideways, so bring the current section into view (otherwise "So sánh" /
  // "Đang theo dõi" sit cut off at the right edge). Only the row scrolls, never the page.
  const navRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const scroller = navRef.current?.parentElement;
    const current = navRef.current?.querySelector<HTMLElement>('[aria-current="page"]');
    if (!scroller || scroller.scrollWidth <= scroller.clientWidth) return;
    if (!current) {
      scroller.scrollLeft = 0;
      return;
    }
    const s = scroller.getBoundingClientRect();
    const c = current.getBoundingClientRect();
    scroller.scrollLeft += c.left - s.left - (s.width - c.width) / 2;
  }, [path]);

  return (
    <nav ref={navRef} aria-label="Điều hướng chính" className="flex items-center gap-0.5 max-[1023px]:w-max">
      {links.map(({ href, label, active }) => (
        <Link
          key={href}
          href={href}
          aria-current={active ? "page" : undefined}
          className={`${NAV_LINK} ${active ? "bg-primary-soft font-semibold text-primary" : "font-medium text-ink-2 hover:bg-surface-2 hover:text-ink"}`}
        >
          <span className="whitespace-nowrap">{label}</span>
        </Link>
      ))}
    </nav>
  );
}

// Pages that already are the sign-in form: a "Đăng nhập" button there only points back at itself.
const AUTH_PAGES = ["/login", "/register", "/forgot-password", "/reset-password", "/auth/"];

/** Signed-out header action; hidden on the auth pages themselves. */
export function LoginLink({ className }: { className: string }) {
  const path = usePathname() ?? "/";
  if (AUTH_PAGES.some((p) => path === p || (p.endsWith("/") && path.startsWith(p)))) return null;
  return (
    <Link href="/login" className={className}>
      Đăng nhập
    </Link>
  );
}

/**
 * Account menu. Long emails are truncated (full address in the menu and the title); on very narrow
 * screens only the initial shows. Closes on navigation, Esc, and a click outside, and returns focus.
 */
export function AccountMenu({ email }: { email: string | null }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const path = usePathname();
  const label = email?.trim() || "Tài khoản";
  const initial = label.charAt(0).toUpperCase();

  // Close when the route changes (the header persists across client navigations).
  const [lastPath, setLastPath] = useState(path);
  if (path !== lastPath) {
    setLastPath(path);
    if (open) setOpen(false);
  }

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const item = "flex min-h-11 w-full items-center rounded-inner px-3 text-left text-control text-ink hover:bg-surface-2";

  return (
    <div ref={wrapRef} className="relative">
      <button
        ref={buttonRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        title={label}
        className="ml-1 inline-flex min-h-10 max-w-[11rem] items-center 2xl:max-w-[14rem] gap-2 rounded-full border border-line bg-surface pl-1 pr-2.5 text-body-sm font-medium text-ink transition-colors duration-150 ease-out hover:border-primary/40 max-[640px]:max-w-[9rem]"
      >
        <span aria-hidden="true" className="inline-flex size-7 shrink-0 items-center justify-center rounded-full bg-primary text-label font-bold text-on-primary">
          {initial}
        </span>
        <span className="min-w-0 truncate max-xl:sr-only">{label}</span>
        <ChevronDownIcon className={`size-4 shrink-0 text-ink-3 transition-transform duration-150 ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div role="menu" aria-label="Tài khoản" className="absolute right-0 top-[calc(100%+6px)] z-50 w-64 max-w-[calc(100vw-2rem)] overflow-hidden rounded-tile border border-line bg-surface p-1.5 shadow-lift">
          <p className="mb-1 border-b border-line px-3 pb-2.5 pt-1.5 text-label text-ink-3">
            Đăng nhập với
            <span className="block truncate text-body-sm font-medium text-ink" title={label}>
              {label}
            </span>
          </p>
          <Link role="menuitem" href="/account" className={item}>
            Tài khoản
          </Link>
          <Link role="menuitem" href="/account/watch" className={item}>
            Sản phẩm đang theo dõi
          </Link>
          <Link role="menuitem" href="/account/searches" className={item}>
            Tìm kiếm đã lưu
          </Link>
          <Link role="menuitem" href="/account/notifications" className={item}>
            Cài đặt thông báo
          </Link>
          <Link role="menuitem" href="/account/preferences" className={item}>
            Sở thích mua sắm
          </Link>
          <form action={signOut} className="mt-1 border-t border-line pt-1">
            <button role="menuitem" type="submit" className={item}>
              Đăng xuất
            </button>
          </form>
        </div>
      )}
    </div>
  );
}

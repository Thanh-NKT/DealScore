"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "@/actions/account";
import { ChevronDownIcon } from "@/components/ui/icons";

// Phones: the nav sits on its own scrollable row under the logo, so full labels fit; desktop: inline.
const NAV_LINK =
  "inline-flex h-11 shrink-0 items-center gap-1.5 rounded-md px-3.5 text-body-sm transition-colors duration-150 ease-out max-[760px]:h-10 max-[760px]:px-3";

/** Primary navigation matching UI mockup. The current section is marked (aria-current) with surface-2. */
export function HeaderNav({ signedIn }: { signedIn: boolean }) {
  const path = usePathname() ?? "/";
  const links = [
    { href: "/search", label: "Tìm kiếm", active: path.startsWith("/search") },
    { href: "/radar", label: "Giảm giá thật", active: path.startsWith("/radar") },
    { href: "/trending", label: "Xu hướng", active: path.startsWith("/trending") },
    { href: "/account/watch", label: "Đang theo dõi", active: path.startsWith("/account/watch") },
  ];
  return (
    <nav aria-label="Điều hướng chính" className="flex items-center gap-1 max-[760px]:w-max">
      {links.map(({ href, label, active }) => (
        <Link
          key={href}
          href={href}
          aria-current={active ? "page" : undefined}
          className={`${NAV_LINK} ${active ? "bg-surface-2 font-semibold text-ink" : "font-medium text-ink-2 hover:bg-surface-2 hover:text-ink"}`}
        >
          <span className="whitespace-nowrap">{label}</span>
        </Link>
      ))}
    </nav>
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

  const item = "flex min-h-11 w-full items-center px-3 text-left text-control text-ink hover:bg-surface-2";

  return (
    <div ref={wrapRef} className="relative">
      <button
        ref={buttonRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        title={label}
        className="inline-flex min-h-11 max-w-[14rem] items-center gap-2 rounded-full border border-line bg-surface pl-1.5 pr-2.5 text-body-sm font-medium text-ink transition-colors duration-150 ease-out hover:border-line-strong max-[640px]:max-w-[9rem]"
      >
        <span aria-hidden="true" className="inline-flex size-7 shrink-0 items-center justify-center rounded-full bg-accent text-label font-bold text-on-accent">
          {initial}
        </span>
        <span className="min-w-0 truncate max-[400px]:sr-only">{label}</span>
        <ChevronDownIcon className={`size-4 shrink-0 text-ink-3 transition-transform duration-150 ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div role="menu" aria-label="Tài khoản" className="absolute right-0 top-[calc(100%+6px)] z-50 w-64 max-w-[calc(100vw-2rem)] overflow-hidden rounded-md border border-line bg-surface py-1 shadow-lift">
          <p className="border-b border-line px-3 py-2 text-label text-ink-3">
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
          <form action={signOut} className="border-t border-line">
            <button role="menuitem" type="submit" className={item}>
              Đăng xuất
            </button>
          </form>
        </div>
      )}
    </div>
  );
}

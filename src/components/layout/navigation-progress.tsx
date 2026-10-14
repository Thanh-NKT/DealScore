"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";

/** A navigation that never lands (redirect back, error) must not leave the bar up. */
const GIVE_UP_MS = 10_000;

/**
 * Thin iris bar at the top of the window while a clicked in-app link loads. Routes have no
 * loading.tsx: the current page stays until the next one is ready (a skeleton shown in between
 * stays ≥ 300ms and reads as a white flash), so this bar is the only "clicked" feedback. It shows
 * only after a short delay (`nav-progress` in globals.css), so fast navigations show nothing.
 */
export function NavigationProgress() {
  const pathname = usePathname();
  const search = useSearchParams().toString();
  const url = search ? `${pathname}?${search}` : pathname;
  const urlRef = useRef(url);
  // The URL the click left from: the bar is up while that is still the current URL.
  const [pendingFrom, setPendingFrom] = useState<string | null>(null);

  useEffect(() => {
    urlRef.current = url;
  }, [url]);

  useEffect(() => {
    let giveUp: ReturnType<typeof setTimeout> | undefined;
    const onClick = (e: MouseEvent) => {
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as Element | null)?.closest?.("a[href]");
      if (!(a instanceof HTMLAnchorElement) || (a.target && a.target !== "_self") || a.hasAttribute("download")) return;
      const next = new URL(a.href, window.location.href);
      if (next.origin !== window.location.origin) return;
      // Same page (or only a #hash): nothing loads.
      if (next.pathname === window.location.pathname && next.search === window.location.search) return;
      setPendingFrom(urlRef.current);
      clearTimeout(giveUp);
      giveUp = setTimeout(() => setPendingFrom(null), GIVE_UP_MS);
    };
    // Capture phase: next/link calls preventDefault, which says nothing about whether a navigation starts.
    window.addEventListener("click", onClick, true);
    return () => {
      window.removeEventListener("click", onClick, true);
      clearTimeout(giveUp);
    };
  }, []);

  if (pendingFrom === null || pendingFrom !== url) return null;
  return <div aria-hidden="true" className="nav-progress pointer-events-none fixed inset-x-0 top-0 z-50 h-0.5 bg-primary" />;
}

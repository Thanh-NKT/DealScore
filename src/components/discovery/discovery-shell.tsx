import Link from "next/link";
import type { ReactNode, SVGProps } from "react";
import { InfoIcon } from "@/components/ui/icons";

/**
 * Shared frame for the discovery lists (/radar, /trending): the answer first (title + one plain
 * sentence on how the list is built), then filters, then the list. Server Component, works without JS.
 */
export function DiscoveryShell({
  title,
  lead,
  controls,
  children,
  footnote,
}: {
  title: string;
  lead: ReactNode;
  controls?: ReactNode;
  children: ReactNode;
  footnote?: ReactNode;
}) {
  return (
    <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-8 sm:px-6 sm:py-12">
      <header className="max-w-[68ch] space-y-3">
        <h1 className="display text-[30px] font-extrabold leading-[1.1] text-ink text-balance sm:text-[40px]">{title}</h1>
        <p className="text-[16px] leading-relaxed text-ink-2 text-pretty">{lead}</p>
      </header>
      {controls && <div className="mt-7 space-y-3">{controls}</div>}
      <div className="mt-7 space-y-6">{children}</div>
      {footnote && (
        <p className="mt-12 max-w-[75ch] border-t border-line pt-5 text-[13px] leading-[1.45] text-ink-3">{footnote}</p>
      )}
    </main>
  );
}

const PILL_TONE = {
  light: {
    base: "border-line bg-surface text-ink-2 hover:border-primary/40 hover:text-primary",
    active: "border-primary bg-primary font-bold text-on-primary shadow-xs",
  },
  night: {
    base: "border-night-line text-night-ink hover:bg-night-2",
    active: "border-accent bg-accent font-semibold text-on-accent",
  },
} as const;

/**
 * Category filter as a strip of pill links. The current one is marked with aria-current and, on a
 * light page, uses the applied-filter chip (primary); inside a night panel it is the lime pill.
 * Phones scroll the strip sideways; wider screens wrap it.
 */
export function CategoryStrip({
  categories,
  current,
  hrefFor,
  tone = "light",
}: {
  categories: Array<{ slug: string; name: string }>;
  current: string | undefined;
  hrefFor: (slug: string | undefined) => string;
  tone?: "light" | "night";
}) {
  if (categories.length === 0) return null;
  const items = [{ slug: undefined as string | undefined, name: "Tất cả" }, ...categories];
  const t = PILL_TONE[tone];
  return (
    <nav aria-label="Lọc theo danh mục" className="-mx-4 overflow-x-auto px-4 py-1 [scrollbar-width:thin] sm:mx-0 sm:overflow-visible sm:px-0">
      <ul className="flex w-max gap-2 sm:w-auto sm:flex-wrap">
        {items.map((c) => {
          const active = c.slug === current;
          return (
            <li key={c.slug ?? "all"}>
              <Link
                href={hrefFor(c.slug)}
                aria-current={active ? "page" : undefined}
                className={`inline-flex min-h-10 items-center whitespace-nowrap rounded-full border px-4 text-[14px] font-medium transition-colors duration-150 ease-out ${
                  active ? t.active : t.base
                }`}
              >
                {c.name}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/** Segmented control (surface-2 track, primary active segment), as links so it works without JS. */
export function SegmentedLinks({
  label,
  options,
}: {
  label: string;
  options: Array<{ href: string; text: string; active: boolean }>;
}) {
  return (
    <nav aria-label={label}>
      <ul className="inline-flex max-w-full gap-1 rounded-[12px] border border-line bg-surface-2 p-1">
        {options.map((o) => (
          <li key={o.href} className="min-w-0">
            <Link
              href={o.href}
              aria-current={o.active ? "page" : undefined}
              className={`inline-flex min-h-10 items-center justify-center rounded-[8px] px-4 text-[14px] transition-colors duration-150 ease-out max-[400px]:px-3 ${
                o.active ? "bg-primary font-bold text-on-primary shadow-xs" : "font-medium text-ink-2 hover:bg-surface/70 hover:text-ink"
              }`}
            >
              {o.text}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

function Chevron({ dir, ...p }: SVGProps<SVGSVGElement> & { dir: "left" | "right" }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" aria-hidden {...p}>
      <path d={dir === "left" ? "m15 6-6 6 6 6" : "m9 6 6 6-6 6"} />
    </svg>
  );
}

const PAGE_LINK =
  "inline-flex min-h-11 items-center gap-1.5 rounded-md border border-line-strong bg-surface px-4 text-[14px] font-semibold text-ink transition-colors duration-150 ease-out hover:bg-surface-2";

export function Pager({ page, totalPages, hrefFor }: { page: number; totalPages: number; hrefFor: (p: number) => string }) {
  if (totalPages <= 1) return null;
  return (
    <nav aria-label="Phân trang" className="flex flex-wrap items-center justify-center gap-3 pt-2">
      {page > 1 && (
        <Link href={hrefFor(page - 1)} className={PAGE_LINK}>
          <Chevron dir="left" className="size-4" />
          Trang trước
        </Link>
      )}
      <span className="text-[13px] text-ink-3">
        Trang <span className="num text-[16px] font-bold text-ink">{page}</span> / <span className="num text-[16px]">{totalPages}</span>
      </span>
      {page < totalPages && (
        <Link href={hrefFor(page + 1)} className={PAGE_LINK}>
          Trang sau
          <Chevron dir="right" className="size-4" />
        </Link>
      )}
    </nav>
  );
}

/**
 * Empty / error state: dashed frame (DESIGN.md: dashed = nothing to show yet), says what is missing
 * and offers one next step as the primary action. `tone="night"` when it sits inside a night panel.
 */
export function DiscoveryEmpty({
  title,
  body,
  action,
  tone = "light",
}: {
  title: string;
  body: ReactNode;
  action?: { href: string; text: string };
  tone?: "light" | "night";
}) {
  const night = tone === "night";
  return (
    <div
      className={`flex items-start gap-3.5 rounded-lg border border-dashed p-5 sm:p-6 ${
        night ? "border-night-line text-night-ink" : "border-line-strong bg-surface text-ink"
      }`}
    >
      <InfoIcon className={`mt-0.5 size-6 shrink-0 ${night ? "text-night-ink-2" : "text-ink-2"}`} />
      <div className="min-w-0">
        <h2 className="display text-[18px] font-bold leading-[1.3] sm:text-[22px]">{title}</h2>
        <p className={`mt-1.5 max-w-[68ch] text-[16px] leading-relaxed ${night ? "text-night-ink-2" : "text-ink-2"}`}>{body}</p>
        {action && (
          <Link
            href={action.href}
            className="mt-4 inline-flex min-h-11 items-center rounded-md bg-primary px-5 text-[16px] font-semibold text-on-primary transition-colors duration-150 ease-out hover:bg-primary-hover"
          >
            {action.text}
          </Link>
        )}
      </div>
    </div>
  );
}

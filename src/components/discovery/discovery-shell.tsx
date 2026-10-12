import Link from "next/link";
import type { ReactNode, SVGProps } from "react";
import { InfoIcon } from "@/components/ui/icons";
import { buttonClass } from "@/components/ui/button";
import { pillClass } from "@/components/ui/pill";
import { segmentClass, segmentTrack } from "@/components/ui/segmented";

/**
 * Shared frame for the discovery lists (/radar, /trending): the answer first (title + one plain
 * sentence on how the list is built), then filters, then the list. Server Component, works without JS.
 */
export function DiscoveryShell({
  eyebrow,
  title,
  lead,
  controls,
  children,
  footnote,
}: {
  /** Small mono label above the title, e.g. "Radar giảm giá". */
  eyebrow?: ReactNode;
  title: string;
  lead: ReactNode;
  controls?: ReactNode;
  children: ReactNode;
  footnote?: ReactNode;
}) {
  return (
    <main className="w-full flex-1">
      <header className="relative overflow-hidden border-b border-line">
        <div
          aria-hidden="true"
          className="bg-ledger pointer-events-none absolute inset-0 [mask-image:radial-gradient(ellipse_70%_90%_at_20%_0%,black,transparent_80%)]"
        />
        <div className="relative mx-auto max-w-[1440px] px-4 py-10 sm:px-6 sm:py-14 lg:px-14">
          <div className="flex max-w-[68ch] flex-col gap-3">
            {eyebrow && <span className="eyebrow flex items-center gap-1.5 text-ink-3">{eyebrow}</span>}
            <h1 className="display text-h1-sm font-semibold leading-[1.06] text-ink text-balance sm:text-h1">{title}</h1>
            <p className="text-body leading-relaxed text-ink-2 text-pretty sm:text-title sm:leading-relaxed">{lead}</p>
          </div>
          {controls && <div className="mt-7 space-y-3">{controls}</div>}
        </div>
      </header>
      <div className="mx-auto max-w-[1440px] px-4 py-8 sm:px-6 sm:py-10 lg:px-14">
        <div className="space-y-6">{children}</div>
        {footnote && (
          <p className="mt-12 max-w-[75ch] border-t border-dashed border-line-strong/50 pt-5 text-label leading-[1.5] text-ink-3">{footnote}</p>
        )}
      </div>
    </main>
  );
}

/**
 * Category filter as a strip of pill links. The current one is marked with aria-current and, on a
 * light page, uses the applied-filter chip (primary); inside a night panel it is the paper pill.
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
                className={pillClass(active, { tone })}
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
      <ul className={segmentTrack()}>
        {options.map((o) => (
          <li key={o.href} className="min-w-0">
            <Link
              href={o.href}
              aria-current={o.active ? "page" : undefined}
              className={segmentClass(o.active, { size: "md", className: "max-[400px]:px-3" })}
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
  "inline-flex min-h-11 items-center gap-1.5 rounded-full border border-line-strong/50 bg-surface px-5 text-body-sm font-semibold text-ink transition-colors duration-150 ease-out hover:border-primary hover:text-primary";

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
      <span className="text-label text-ink-3">
        Trang <span className="num text-body font-bold text-ink">{page}</span> / <span className="num text-body">{totalPages}</span>
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
      className={`flex items-start gap-3.5 rounded-lg border border-dashed p-5 sm:p-7 ${
        night ? "border-night-line text-night-ink" : "border-line-strong bg-surface text-ink"
      }`}
    >
      <InfoIcon className={`mt-0.5 size-6 shrink-0 ${night ? "text-night-ink-2" : "text-ink-2"}`} />
      <div className="min-w-0">
        <h2 className="display text-title font-semibold leading-[1.3] sm:text-h3">{title}</h2>
        <p className={`mt-1.5 max-w-[68ch] text-body leading-relaxed ${night ? "text-night-ink-2" : "text-ink-2"}`}>{body}</p>
        {action && (
          <Link
            href={action.href}
            className={buttonClass({ size: "md", className: "mt-4" })}
          >
            {action.text}
          </Link>
        )}
      </div>
    </div>
  );
}

import Link from "next/link";

interface CategoryGridProps {
  categories?: Array<{ name: string; slug: string }>;
}

const DEFAULT_CATS = [
  { name: "Gia dụng", slug: "gia-dung", path: "M4 10h16v6a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4zM2 10h20M9 6c0-1 1-2 3-2s3 1 3 2", tint: "var(--tint-peach)" },
  { name: "Mỹ phẩm", slug: "my-pham", path: "M10 2h4v4h-4zM9 6h6l1 3v11a2 2 0 0 1-2 2h-4a2 2 0 0 1-2-2V9z", tint: "var(--tint-lilac)" },
  { name: "Thời trang", slug: "thoi-trang", path: "M20.4 6.6 16 4a4 4 0 0 1-8 0L3.6 6.6a1 1 0 0 0-.4 1.3l1.3 2.6a1 1 0 0 0 1.2.5L8 10v10h8V10l2.3 1a1 1 0 0 0 1.2-.5l1.3-2.6a1 1 0 0 0-.4-1.3z", tint: "var(--tint-butter)" },
  { name: "Mẹ & bé", slug: "me-va-be", path: "M9 2h6M10 2v3L8 8v12a2 2 0 0 0 2 2h4a2 2 0 0 0 2-2V8l-2-3V2M8 12h8", tint: "var(--tint-sky)" },
  { name: "Thực phẩm", slug: "thuc-pham", path: "M5 8h14l-1.5 12a2 2 0 0 1-2 2h-7a2 2 0 0 1-2-2zM8 8V5a4 4 0 0 1 8 0v3", tint: "var(--tint-mint)" },
  { name: "Điện tử", slug: "dien-tu", path: "M3 18v-6a9 9 0 0 1 18 0v6M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3zM3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z", tint: "var(--tint-violet)" },
  { name: "Nhà cửa", slug: "nha-cua", path: "M3 10l9-7 9 7v10a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z", tint: "var(--accent-soft)" },
  { name: "Thể thao", slug: "the-thao", path: "M12 2a10 10 0 1 0 0 20a10 10 0 1 0 0-20zM2 12h20M12 2a15 15 0 0 1 0 20M12 2a15 15 0 0 0 0 20", tint: "var(--buy-soft)" },
];

export function CategoryGrid({ categories }: CategoryGridProps) {
  const cats = DEFAULT_CATS.map((def) => {
    const match = categories?.find((c) => c.slug === def.slug || c.name.toLowerCase() === def.name.toLowerCase());
    return {
      ...def,
      slug: match ? match.slug : def.slug,
      name: match ? match.name : def.name,
    };
  });

  return (
    <section aria-labelledby="cats-title" className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div className="flex flex-col gap-2">
          <span className="eyebrow text-ink-3">Danh mục</span>
          <h2 id="cats-title" className="display text-h2-sm font-bold leading-tight text-ink sm:text-h2">
            Hôm nay bạn cần gì?
          </h2>
        </div>
        <Link href="/search" className="text-label font-semibold text-primary underline decoration-primary/30 underline-offset-4 hover:decoration-primary">
          Tất cả danh mục →
        </Link>
      </div>
      <div className="grid grid-cols-4 gap-2 sm:gap-3 lg:grid-cols-8">
        {cats.map((c) => (
          <Link
            key={c.slug}
            href={`/search?cat=${c.slug}`}
            style={{ backgroundColor: c.tint }}
            className="group relative flex flex-col items-center gap-2 overflow-hidden rounded-tile px-1.5 py-3 text-center text-ink ring-1 ring-ink/5 transition-[box-shadow,transform] duration-200 ease-out hover:-translate-y-0.5 hover:shadow-lift hover:ring-primary/30 sm:min-h-[132px] sm:items-stretch sm:justify-between sm:gap-6 sm:p-4 sm:text-left"
          >
            {/* The category's icon, drawn large and faint in the corner, then small and crisp in a paper chip. */}
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="var(--ink)"
              strokeWidth="1.2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
              className="pointer-events-none absolute -right-4 -top-4 size-24 opacity-[0.07] transition-transform duration-500 ease-out group-hover:-rotate-6 group-hover:scale-110 max-sm:hidden"
            >
              <path d={c.path} />
            </svg>
            <span className="flex size-11 items-center justify-center rounded-full bg-surface/85 shadow-xs transition-transform duration-300 ease-out group-hover:scale-105">
              <svg
                width="21"
                height="21"
                viewBox="0 0 24 24"
                fill="none"
                stroke="var(--ink)"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d={c.path} />
              </svg>
            </span>
            <span className="relative flex items-center justify-center gap-1 text-label font-semibold leading-tight text-ink sm:justify-between sm:text-control">
              {c.name}
              <span aria-hidden="true" className="text-ink-2 transition-transform duration-150 group-hover:translate-x-0.5 group-hover:text-primary max-sm:hidden">→</span>
            </span>
          </Link>
        ))}
      </div>
    </section>
  );
}

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";
import { loadProductPageData } from "@/lib/product/page-data";
import { toSeoProduct } from "@/lib/seo/product";
import { formatVnd } from "@/lib/format";
import type { Recommendation } from "@/lib/pricing/deal-score";

export const alt = "Giá hôm nay và lịch sử giá trên Kairo";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

// Colors from globals.css (light theme) — the image has no CSS variables.
const C = {
  label: "#F3F0E8",
  raised: "#FBFAF6",
  hairline: "#D5CFC1",
  ink: "#1C1B19",
  ink3: "#645F54",
  primary: "#4B2E83",
};

const VERDICT: Record<Recommendation, { text: string; fg: string; bg: string }> = {
  buy: { text: "Nên mua", fg: "#1D6A42", bg: "#E1EFE5" },
  wait: { text: "Có thể chờ", fg: "#845600", bg: "#F5EBD3" },
  avoid: { text: "Chưa nên mua", fg: "#A0261C", bg: "#F6E0DC" },
  insufficient_data: { text: "Chưa đủ dữ liệu", fg: "#5B574F", bg: "#E8E4DA" },
};

/**
 * Be Vietnam Pro ships as Latin, Latin-ext (đ) and Vietnamese (ổ, ứ…) subsets; the bundled default
 * font has no Vietnamese glyphs. Satori uses ONE font per family + weight, so each subset gets its
 * own family name and FONT_STACK chains them as glyph fallbacks.
 */
const SUBSETS = [
  { file: "latin", family: "Be Vietnam Pro" },
  { file: "latin-ext", family: "Be Vietnam Pro Latin Ext" },
  { file: "vietnamese", family: "Be Vietnam Pro Vietnamese" },
] as const;
const FONT_STACK = SUBSETS.map((s) => `"${s.family}"`).join(", ");
const WEIGHTS = [400, 700] as const;

async function fonts() {
  const dir = join(process.cwd(), "node_modules/@fontsource/be-vietnam-pro/files");
  const entries = WEIGHTS.flatMap((weight) => SUBSETS.map((subset) => ({ weight, subset })));
  return Promise.all(
    entries.map(async ({ weight, subset }) => ({
      name: subset.family,
      data: await readFile(join(dir, `be-vietnam-pro-${subset.file}-${weight}-normal.woff`)),
      weight,
      style: "normal" as const,
    })),
  );
}

export default async function Image({ params }: { params: Promise<{ category: string; product: string }> }) {
  const { product: slug } = await params;
  // A broken OG image must not fail the share preview: log it and fall back to the generic card.
  const data = await loadProductPageData({ productSlug: slug }).catch((err) => {
    console.error("opengraph-image: loadProductPageData failed", err);
    return null;
  });
  const seo = data ? toSeoProduct(data) : null;

  const prices = (seo?.variants ?? []).filter((v) => v.inStock && v.price != null).map((v) => v.price as number);
  const low = prices.length > 0 ? Math.min(...prices) : null;
  const verdict = seo?.recommendation ? VERDICT[seo.recommendation] : null;

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          background: C.label,
          padding: 64,
          fontFamily: FONT_STACK,
          color: C.ink,
        }}
      >
        <div style={{ display: "flex", fontSize: 32, fontWeight: 700, color: C.primary }}>Kairo</div>

        <div
          style={{
            display: "flex",
            flexDirection: "column",
            background: C.raised,
            border: `2px solid ${C.hairline}`,
            borderRadius: 8,
            padding: 48,
            gap: 20,
          }}
        >
          {seo?.brand && <div style={{ display: "flex", fontSize: 28, color: C.ink3 }}>{seo.brand}</div>}
          <div style={{ display: "flex", fontSize: 56, fontWeight: 700, lineHeight: 1.15, maxHeight: 136, overflow: "hidden" }}>
            {seo?.canonicalName ?? "Giá hôm nay và lịch sử giá"}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 24 }}>
            <div style={{ display: "flex", fontSize: 64, fontWeight: 700 }}>
              {low != null ? formatVnd(low) : "Chưa có giá"}
            </div>
            {verdict && (
              <div
                style={{
                  display: "flex",
                  fontSize: 32,
                  fontWeight: 700,
                  color: verdict.fg,
                  background: verdict.bg,
                  borderRadius: 4,
                  padding: "8px 20px",
                }}
              >
                {verdict.text}
              </div>
            )}
          </div>
        </div>

        <div style={{ display: "flex", fontSize: 26, color: C.ink3 }}>
          Lịch sử giá theo variant · Deal Score có giải thích · Báo khi giảm giá
        </div>
      </div>
    ),
    { ...size, fonts: await fonts() },
  );
}

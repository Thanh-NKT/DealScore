import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";
import { loadOgProduct } from "@/lib/product/og-data";
import { formatVnd } from "@/lib/format";
import type { Recommendation } from "@/lib/pricing/deal-score";

export const alt = "Giá hôm nay và lịch sử giá trên Kairo";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

// Colors from globals.css (light theme) — the image has no CSS variables.
const C = {
  canvas: "#F5F4EF",
  surface: "#FFFFFF",
  line: "#E4E2DA",
  ink: "#15161A",
  ink3: "#62656D",
  primary: "#4330E6",
};

const VERDICT: Record<Recommendation, { text: string; fg: string; bg: string }> = {
  buy: { text: "Nên mua", fg: "#0B7A48", bg: "#E3F4EA" },
  wait: { text: "Có thể chờ", fg: "#9A5B00", bg: "#FFF3C9" },
  avoid: { text: "Chưa nên mua", fg: "#B42318", bg: "#FDE7E4" },
  insufficient_data: { text: "Chưa đủ dữ liệu", fg: "#62656D", bg: "#EFEEE8" },
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
  // One cached public read (name, lowest price, cached verdict) instead of the whole product page load:
  // share previews and crawlers hit this route in bursts. A broken OG image must not fail the share
  // preview: log it and fall back to the generic card.
  const seo = await loadOgProduct(slug).catch((err) => {
    console.error("opengraph-image: loadOgProduct failed", err);
    return null;
  });
  const low = seo?.lowPrice ?? null;
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
          background: C.canvas,
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
            background: C.surface,
            border: `2px solid ${C.line}`,
            borderRadius: 20,
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
                  borderRadius: 999,
                  padding: "8px 24px",
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

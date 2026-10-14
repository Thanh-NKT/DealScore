import type { Metadata } from "next";
import { Be_Vietnam_Pro, Bricolage_Grotesque } from "next/font/google";
import "./globals.css";

// Text: Be Vietnam Pro, drawn for Vietnamese (stacked marks stay clear at small sizes).
// Headings and prices: Bricolage Grotesque (variable weight, width and optical size).
const beVietnam = Be_Vietnam_Pro({
  variable: "--font-be-vietnam",
  subsets: ["latin", "vietnamese"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
});

const bricolage = Bricolage_Grotesque({
  variable: "--font-bricolage",
  subsets: ["latin", "vietnamese"],
  axes: ["opsz", "wdth"],
  display: "swap",
});

export const metadata: Metadata = {
  // Resolves relative Open Graph / canonical URLs (1.7).
  metadataBase: new URL(siteUrl()),
  title: "DealScore — Đừng chỉ tìm giá rẻ. Tìm đúng thời điểm để mua.",
  description:
    "Lịch sử giá chuẩn hóa theo variant, Deal Score có giải thích, và câu trả lời Nên mua / Có thể chờ / Chưa nên mua.",
  // Without the manifest link the browser can't install the PWA, and the share target (1.1.d) never appears.
  manifest: "/manifest.webmanifest",
};

import { Suspense } from "react";
import { NavigationProgress } from "@/components/layout/navigation-progress";
import { SiteHeader } from "@/components/layout/site-header";
import { SiteFooter } from "@/components/layout/site-footer";
import { siteUrl } from "@/lib/site-url";
// Allowed by the CSP through its hash (src/lib/security/headers.ts).
import { THEME_INIT_SCRIPT } from "@/lib/security/headers";

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="vi"
      suppressHydrationWarning
      className={`${beVietnam.variable} ${bricolage.variable} h-full antialiased`}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body className="min-h-full flex flex-col bg-canvas text-ink">
        {/* useSearchParams needs a Suspense boundary to keep static routes static. */}
        <Suspense fallback={null}>
          <NavigationProgress />
        </Suspense>
        <SiteHeader />
        {children}
        <SiteFooter />
      </body>
    </html>
  );
}

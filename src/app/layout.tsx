import type { Metadata } from "next";
import { Plus_Jakarta_Sans } from "next/font/google";
import "./globals.css";

const plusJakartaSans = Plus_Jakarta_Sans({
  variable: "--font-jakarta",
  subsets: ["latin", "vietnamese"],
  weight: ["400", "500", "600", "700", "800"],
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
      className={`${plusJakartaSans.variable} h-full antialiased`}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body className="min-h-full flex flex-col bg-canvas text-ink">
        <SiteHeader />
        {children}
        <SiteFooter />
      </body>
    </html>
  );
}

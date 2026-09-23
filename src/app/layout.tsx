import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Kairo — Đừng chỉ tìm giá rẻ. Tìm đúng thời điểm để mua.",
  description:
    "Lịch sử giá chuẩn hóa theo variant, Deal Score có giải thích, và câu trả lời Nên mua / Có thể chờ / Chưa nên mua.",
  // Không link manifest thì trình duyệt không cài được PWA, và share target (1.1.d) không bao giờ hiện.
  manifest: "/manifest.webmanifest",
};

import { SiteHeader } from "@/components/layout/site-header";

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="vi"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <SiteHeader />
        {children}
      </body>
    </html>
  );
}

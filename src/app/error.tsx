"use client"; // Error boundaries must be Client Components

import { useEffect } from "react";
import Link from "next/link";
import { AlertIcon } from "@/components/ui/icons";
import { Button, ButtonLink } from "@/components/ui/button";

/**
 * Route error boundary (Next 16 passes `retry`, not `reset`). Calm and honest: says the page did
 * not load, never blames the user, offers a retry and a way home. The digest lets support match
 * the server log without exposing the error message.
 */
export default function RouteError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    console.error("route error", error);
  }, [error]);

  return (
    <main className="flex w-full flex-1 items-center justify-center bg-ledger px-4 py-16 sm:px-6 lg:px-14">
      <div role="alert" className="flex w-full max-w-[620px] flex-col gap-4 rounded-hero border border-line bg-surface p-8 shadow-lift max-sm:p-5">
        <span className="eyebrow flex items-center gap-1.5 text-avoid">
          <AlertIcon className="size-4" />
          Lỗi tải trang
        </span>
        <h1 className="display text-h3 font-semibold text-ink">Chưa tải được trang này</h1>
        <p className="text-body-sm leading-relaxed text-ink-2">
          DealScore gặp trục trặc khi lấy dữ liệu. Thường chỉ cần thử lại sau vài giây. Nếu vẫn lỗi, hãy quay về trang chủ và
          tìm lại sản phẩm.
        </p>
        <div className="flex flex-wrap gap-2.5 pt-1">
          <Button onClick={() => retry()}>Thử lại</Button>
          <ButtonLink href="/" variant="secondary">
            Về trang chủ
          </ButtonLink>
        </div>
        {error.digest && (
          <p className="text-micro text-ink-3">
            Mã lỗi: <span className="num">{error.digest}</span>
          </p>
        )}
        <p className="sr-only">
          <Link href="/search">Tìm kiếm sản phẩm</Link>
        </p>
      </div>
    </main>
  );
}

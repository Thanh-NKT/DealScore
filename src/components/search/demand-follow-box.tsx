"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { unstable_rethrow } from "next/navigation";
import { followDemand, unfollowDemand } from "@/actions/demand-follow";
import { Button } from "@/components/ui/button";

const ERROR_TEXT: Record<string, string> = {
  limit: "Bạn đang chờ 10 tìm kiếm — hủy bớt ở Tài khoản.",
  not_eligible: "Tìm kiếm này đã có đủ kết quả.",
  unauthenticated: "Phiên đăng nhập đã hết. Hãy đăng nhập lại.",
  unavailable: "Chưa bật được. Thử lại sau ít phút.",
};

/**
 * "Báo tôi khi có" (UI spec §1.1, roadmap P4 F). Shown only where demand is recorded (< 3 results). Signed out:
 * a login link only — nothing is stored. The keyword is recomputed on the server, never sent from here.
 */
export function DemandFollowBox({
  keyword,
  q,
  intent,
  signedIn,
  loginHref,
  existing,
}: {
  keyword: string;
  q: string;
  intent: boolean;
  signedIn: boolean;
  loginHref: string;
  existing: { id: string } | null;
}) {
  const [followId, setFollowId] = useState<string | null>(existing?.id ?? null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const run = (work: () => Promise<void>) => {
    setError(null);
    startTransition(async () => {
      try {
        await work();
      } catch (err) {
        unstable_rethrow(err);
        setError(ERROR_TEXT.unavailable);
      }
    });
  };

  return (
    <div className="space-y-2 rounded-lg bg-surface-2 p-4">
      {followId ? (
        <div role="status" className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-body-sm text-ink">Đã bật. DealScore sẽ báo một lần khi có sản phẩm, trong 30 ngày tới.</p>
          <Button
            variant="secondary"
            size="sm"
            busy={pending}
            onClick={() =>
              run(async () => {
                const r = await unfollowDemand(followId);
                if (r.ok) setFollowId(null);
                else setError(ERROR_TEXT.unavailable);
              })
            }
          >
            Hủy
          </Button>
        </div>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-body-sm text-ink">DealScore đang tìm thêm “{keyword}” trên các sàn.</p>
          {signedIn ? (
            <Button
              size="sm"
              busy={pending}
              onClick={() =>
                run(async () => {
                  const r = await followDemand({ q, intent });
                  if (r.ok) setFollowId(r.id);
                  else setError(ERROR_TEXT[r.error] ?? ERROR_TEXT.unavailable);
                })
              }
            >
              Báo tôi khi có
            </Button>
          ) : (
            <Link href={loginHref} className="inline-flex min-h-10 items-center text-body-sm font-semibold text-primary underline underline-offset-4">
              Đăng nhập để được báo
            </Link>
          )}
        </div>
      )}
      {error ? (
        <p role="alert" className="text-body-sm font-semibold text-avoid">
          {error}
        </p>
      ) : null}
      {signedIn ? (
        <p className="text-micro text-ink-3">
          DealScore chỉ lưu từ khóa này cùng tài khoản của bạn để báo tin; tìm kiếm khác vẫn ẩn danh.
        </p>
      ) : null}
    </div>
  );
}

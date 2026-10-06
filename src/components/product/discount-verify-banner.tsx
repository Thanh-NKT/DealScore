"use client";

import { useState } from "react";
import { ShieldVerifyIcon } from "@/components/ui/icons";

interface DiscountVerifyBannerProps {
  /** "ok" = the check ran and found nothing; "fake" = it fired; "insufficient" = too little history to check. */
  status: "ok" | "fake" | "insufficient";
  message?: string | null;
}

export function DiscountVerifyBanner({ status, message }: DiscountVerifyBannerProps) {
  const [openModal, setOpenModal] = useState(false);
  const isValid = status === "ok";

  // Say only what the check established; never claim more than the engine computed.
  const defaultNote =
    status === "insufficient"
      ? "Chưa đủ lịch sử giá để kiểm tra mức giảm này. DealScore cần ít nhất 14 ngày dữ liệu hợp lệ."
      : status === "ok"
        ? "Không thấy dấu hiệu giá niêm yết bị đẩy cao so với giá hệ thống ghi nhận."
        : message || "Mức giá hiện tại chưa thấp hơn đáng kể so với lịch sử quan sát.";
  const chip =
    status === "insufficient"
      ? { text: "Chưa đủ dữ liệu", tone: "bg-unknown-soft text-unknown border border-dashed border-unknown" }
      : status === "ok"
        ? { text: "Không thấy dấu hiệu", tone: "bg-buy-soft text-buy border border-buy/30" }
        : { text: "Giảm giá chưa thực chất", tone: "bg-wait-soft text-wait border border-wait/30" };

  return (
    <>
      <section aria-label="Kiểm tra mức giảm" className="w-full">
        <div className="flex flex-wrap items-center justify-between gap-5 rounded-lg border border-line bg-surface p-5 sm:p-6">
          <div className="flex max-w-[70ch] flex-col gap-1.5">
            <div className="flex flex-wrap items-center gap-2.5">
              <ShieldVerifyIcon
                className={`size-5 ${status === "insufficient" ? "text-unknown" : isValid ? "text-buy" : "text-wait"}`}
                strokeWidth={2.2}
              />
              <h2 className="text-title font-bold text-ink">Kiểm tra mức giảm</h2>
              <span
                className={`rounded-full px-2.5 py-0.5 text-micro font-bold ${chip.tone}`}
              >
                {chip.text}
              </span>
            </div>
            <p className="text-body-sm leading-relaxed text-ink-2">{defaultNote}</p>
          </div>

          <button
            type="button"
            onClick={() => setOpenModal(true)}
            className="flex min-h-11 items-center gap-1.5 text-body-sm font-bold text-primary hover:text-primary-hover transition-colors cursor-pointer"
          >
            <span>Cách DealScore kiểm tra</span>
            <span aria-hidden="true">→</span>
          </button>
        </div>
      </section>

      {/* Verification Explanation Modal */}
      {openModal && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="verify-modal-title"
          className="fixed inset-0 z-[10000] flex items-center justify-center bg-night/60 p-4"
        >
          <div className="relative flex w-full max-w-[580px] flex-col gap-5 rounded-lg bg-surface p-6 sm:p-8 shadow-lift">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <ShieldVerifyIcon className="size-6 text-buy" strokeWidth={2.4} />
                <h3 id="verify-modal-title" className="display text-h3 font-bold tracking-tight text-ink">
                  3 bước kiểm tra mức giảm
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setOpenModal(false)}
                aria-label="Đóng"
                className="flex size-10 shrink-0 items-center justify-center rounded-full border border-line-strong bg-surface text-ink transition-colors hover:bg-surface-2 cursor-pointer"
              >
                ✕
              </button>
            </div>

            <p className="text-body-sm leading-relaxed text-ink-2">
              Trước khi tin một nhãn giảm giá, DealScore so nó với giá đã ghi nhận. Nếu không đạt, trang sản phẩm hiện “Giảm giá chưa thực chất”.
            </p>

            <div className="flex flex-col gap-4">
              <div className="flex gap-3.5">
                <span className="flex size-6.5 shrink-0 items-center justify-center rounded-full bg-night text-micro font-bold text-night-ink">
                  1
                </span>
                <div className="flex flex-col gap-0.5">
                  <strong className="text-body-sm font-bold text-ink">So với lịch sử giá</strong>
                  <p className="text-label leading-relaxed text-ink-3">
                    So giá hiện tại với giá trung vị 90 ngày. Nếu giá không thấp hơn đáng kể, mức giảm chỉ dựa trên giá niêm yết bị đẩy cao.
                  </p>
                </div>
              </div>

              <div className="flex gap-3.5">
                <span className="flex size-6.5 shrink-0 items-center justify-center rounded-full bg-night text-micro font-bold text-night-ink">
                  2
                </span>
                <div className="flex flex-col gap-0.5">
                  <strong className="text-body-sm font-bold text-ink">Tăng giá trước đợt giảm</strong>
                  <p className="text-label leading-relaxed text-ink-3">
                    Xem giá có bị nâng lên trong những ngày ngay trước khi gắn nhãn giảm hay không.
                  </p>
                </div>
              </div>

              <div className="flex gap-3.5">
                <span className="flex size-6.5 shrink-0 items-center justify-center rounded-full bg-night text-micro font-bold text-night-ink">
                  3
                </span>
                <div className="flex flex-col gap-0.5">
                  <strong className="text-body-sm font-bold text-ink">Đúng mẫu, đúng phân loại</strong>
                  <p className="text-label leading-relaxed text-ink-3">
                    Chỉ so các nơi bán đã xác minh cùng mẫu và cùng phân loại, để giá phụ kiện không bị nhầm thành giá sản phẩm.
                  </p>
                </div>
              </div>
            </div>

            <button
              type="button"
              onClick={() => setOpenModal(false)}
              className="mt-2 flex h-11 items-center justify-center rounded-md bg-night text-body-sm font-bold text-night-ink transition-opacity hover:opacity-90 cursor-pointer"
            >
              Đã hiểu
            </button>
          </div>
        </div>
      )}
    </>
  );
}

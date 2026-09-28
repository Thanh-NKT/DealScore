"use client";

import { useId, useOptimistic, useState, useTransition } from "react";
import { unstable_rethrow } from "next/navigation";
import { updateMarketingOptIn } from "@/actions/account";
import { AlertIcon, CheckIcon } from "@/components/ui/icons";

interface MarketingToggleProps {
  /** From the database; defaults to off when unknown (opt-in, never opt-out). */
  initialOptIn?: boolean | null;
}

type Status = { kind: "idle" } | { kind: "saved" } | { kind: "error"; wanted: boolean };

/**
 * Deal-email opt-in. Off unless the person turned it on. The switch flips immediately (optimistic),
 * says "đang lưu", then "đã lưu"; if saving fails it flips back and offers to retry, so the screen
 * never shows a setting the server doesn't have.
 */
export function MarketingToggle({ initialOptIn = false }: MarketingToggleProps) {
  const uid = useId();
  const [saved, setSaved] = useState(Boolean(initialOptIn));
  const [shown, setShown] = useOptimistic(saved);
  const [pending, startTransition] = useTransition();
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  const save = (wanted: boolean) => {
    setStatus({ kind: "idle" });
    startTransition(async () => {
      setShown(wanted);
      try {
        const form = new FormData();
        if (wanted) form.set("marketing", "on");
        const res = await updateMarketingOptIn({ status: "idle" }, form);
        if (res.status === "saved") {
          setSaved(wanted);
          setStatus({ kind: "saved" });
        } else {
          setStatus({ kind: "error", wanted });
        }
      } catch (err) {
        unstable_rethrow(err); // expired session → login
        setStatus({ kind: "error", wanted });
      }
    });
  };

  return (
    <div className="space-y-1.5">
      <div className="flex items-start justify-between gap-4">
        <label htmlFor={`${uid}-switch`} className="min-w-0 cursor-pointer">
          <span className="block text-control font-semibold text-ink">Email về deal nổi bật và tính năng mới</span>
          <span className="mt-0.5 block text-body-sm text-ink-2">Không ảnh hưởng tới thông báo giá của các sản phẩm bạn theo dõi.</span>
        </label>
        <button
          id={`${uid}-switch`}
          type="button"
          role="switch"
          aria-checked={shown}
          aria-busy={pending}
          aria-describedby={`${uid}-status`}
          disabled={pending}
          onClick={() => save(!shown)}
          className="-my-1.5 inline-flex h-11 w-14 shrink-0 items-center justify-center rounded-md disabled:cursor-progress"
        >
          <span className="sr-only">{shown ? "Đang bật" : "Đang tắt"}</span>
          {/* 28px track inside a 44px hit area. */}
          <span
            aria-hidden="true"
            className={`inline-flex h-7 w-12 items-center rounded-full border transition-colors duration-150 ease-out ${
              shown ? "border-primary bg-primary" : "border-line-strong bg-surface-2"
            }`}
          >
            <span
              className={`inline-block size-5 rounded-full border border-line bg-surface transition-transform duration-150 ease-out ${
                shown ? "translate-x-[22px]" : "translate-x-[3px]"
              }`}
            />
          </span>
        </button>
      </div>

      <p id={`${uid}-status`} aria-live="polite" className="min-h-5 text-label">
        {pending ? (
          <span className="text-ink-2">Đang lưu…</span>
        ) : status.kind === "saved" ? (
          <span className="inline-flex items-center gap-1 text-ink-2">
            <CheckIcon className="size-3.5" />
            Đã lưu: {saved ? "sẽ nhận email deal" : "không nhận email deal"}.
          </span>
        ) : status.kind === "error" ? (
          <span className="inline-flex flex-wrap items-center gap-1.5 font-semibold text-avoid">
            <AlertIcon className="size-3.5" />
            Chưa lưu được, lựa chọn vẫn là {saved ? "bật" : "tắt"}.
            <button type="button" onClick={() => save(status.wanted)} className="inline-flex min-h-10 items-center font-semibold text-primary underline underline-offset-4 hover:text-primary-hover">
              Thử lại
            </button>
          </span>
        ) : null}
      </p>
    </div>
  );
}

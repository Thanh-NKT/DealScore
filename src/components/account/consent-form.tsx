"use client";

import { useActionState, useId, useState } from "react";
import Link from "next/link";
import { unstable_rethrow } from "next/navigation";
import { acceptConsent, type ActionResult } from "@/actions/account";
import { AlertIcon } from "@/components/ui/icons";
import { buttonClass } from "@/components/ui/button";

interface ConsentFormProps {
  initialNext: string;
}

type Result = ActionResult<"agree">;

async function submit(prev: Result, form: FormData): Promise<Result> {
  try {
    return await acceptConsent(prev, form);
  } catch (err) {
    unstable_rethrow(err); // success redirects to `next`
    return { status: "error", errors: { agree: "Chưa lưu được lựa chọn của bạn do lỗi kết nối. Hãy thử lại." } };
  }
}

/**
 * Consent gate. Nothing is pre-ticked: the required box must be ticked by the person, and the
 * marketing box is a separate, optional choice (defaults to no). Links open the real policy pages
 * in a new tab so the form keeps its state.
 */
export function ConsentForm({ initialNext }: ConsentFormProps) {
  const uid = useId();
  const [state, formAction, pending] = useActionState(submit, { status: "idle" } as Result);
  const [agreed, setAgreed] = useState(false);
  const [tried, setTried] = useState(false);

  const serverError = state.status === "error" ? state.errors.agree : null;
  const localError = tried && !agreed ? "Hãy đánh dấu ô đồng ý ở trên để tiếp tục dùng Kairo." : null;
  const error = localError ?? serverError;

  return (
    <form
      action={formAction}
      noValidate
      onSubmit={(e) => {
        setTried(true);
        if (!agreed || pending) e.preventDefault();
      }}
      className="space-y-5"
    >
      <input type="hidden" name="next" value={initialNext} />

      <fieldset className="space-y-3">
        <legend className="sr-only">Lựa chọn của bạn</legend>

        <label className={`flex cursor-pointer items-start gap-3 rounded-md border bg-surface p-3.5 transition-colors duration-150 ease-out hover:bg-surface-2 ${localError ? "border-2 border-avoid" : "border-line-strong"}`}>
          <input
            type="checkbox"
            name="agree"
            checked={agreed}
            onChange={(e) => setAgreed(e.target.checked)}
            aria-describedby={error ? `${uid}-err` : undefined}
            aria-invalid={Boolean(localError) || undefined}
            className="mt-0.5 size-5 shrink-0 accent-primary"
          />
          <span className="text-control leading-relaxed text-ink">
            Tôi đã đọc và đồng ý với{" "}
            <Link href="/terms" target="_blank" className="font-semibold text-primary underline underline-offset-4 hover:text-primary-hover">
              Điều khoản sử dụng
            </Link>{" "}
            và{" "}
            <Link href="/privacy" target="_blank" className="font-semibold text-primary underline underline-offset-4 hover:text-primary-hover">
              Chính sách quyền riêng tư
            </Link>{" "}
            của Kairo. <span className="text-ink-3">(bắt buộc)</span>
          </span>
        </label>

        <label className="flex cursor-pointer items-start gap-3 rounded-md border border-line-strong bg-surface p-3.5 transition-colors duration-150 ease-out hover:bg-surface-2">
          <input type="checkbox" name="marketing" defaultChecked={false} className="mt-0.5 size-5 shrink-0 accent-primary" />
          <span className="text-control leading-relaxed text-ink">
            Gửi cho tôi email về deal nổi bật và tính năng mới.{" "}
            <span className="text-ink-3">(không bắt buộc, tắt được bất cứ lúc nào trong phần Thông báo)</span>
          </span>
        </label>
      </fieldset>

      <p className="text-body-sm text-ink-2">
        Thông báo giá cho sản phẩm bạn theo dõi không phụ thuộc vào ô thứ hai: bạn vẫn nhận được chúng nếu không chọn nhận email deal.
      </p>

      {error && (
        <p id={`${uid}-err`} role="alert" className="flex items-start gap-2 text-body-sm font-semibold text-avoid">
          <AlertIcon className="mt-0.5 size-4 shrink-0" />
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={pending}
        aria-busy={pending}
        className={buttonClass({ size: "lg", block: true })}
      >
        {pending ? "Đang lưu…" : "Đồng ý và tiếp tục"}
      </button>
    </form>
  );
}

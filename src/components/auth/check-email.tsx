"use client";

import { useActionState, useState } from "react";
import type { AuthFormState } from "@/actions/auth";
import { ClockIcon, MailIcon } from "@/components/ui/icons";
import { Problem, SECONDARY, safe, useCountdown } from "./fields";

const RESEND_SECONDS = 60;

/**
 * "Check your inbox" state shared by sign-up, resend-confirmation and forgot-password.
 * `resend` re-runs the same kind of email for `email`; the button counts down between sends.
 */
export function CheckEmail({
  email,
  next,
  lead,
  note,
  resend,
  resendLabel,
  onRestart,
}: {
  email: string;
  next: string;
  lead: string;
  note?: string;
  resend: (prev: AuthFormState, form: FormData) => Promise<AuthFormState>;
  resendLabel: string;
  onRestart: () => void;
}) {
  const [state, action, sending] = useActionState(safe(resend), { status: "idle" } as AuthFormState);
  const [countdown, setCountdown] = useCountdown(RESEND_SECONDS);
  const [resent, setResent] = useState(false);

  // React to each finished resend: restart the countdown (or honour the server's wait time).
  const [seen, setSeen] = useState(state);
  if (state !== seen) {
    setSeen(state);
    if (state.status === "check_email") {
      setResent(true);
      setCountdown(RESEND_SECONDS);
    } else if (state.status === "error" && state.error?.retryAfterSeconds) {
      setCountdown(state.error.retryAfterSeconds);
    }
  }
  const error = state.status === "error" ? (state.error?.message ?? state.fields?.email) : null;

  return (
    <div className="space-y-5" aria-live="polite">
      <div className="flex items-start gap-3.5">
        <span className="inline-flex size-11 shrink-0 items-center justify-center rounded-md bg-surface-2 text-ink">
          <MailIcon className="size-5" />
        </span>
        <div className="min-w-0 text-[15px] leading-relaxed text-ink-2">
          <p>
            {lead} <b className="font-semibold text-ink [overflow-wrap:anywhere]">{email}</b>.
          </p>
          <p className="mt-1.5">Link hết hạn sau 60 phút. Không thấy thư? Xem thêm mục Thư rác hoặc Quảng cáo.</p>
          {note && <p className="mt-1.5">{note}</p>}
        </div>
      </div>

      {error && (
        <Problem>
          <p>{error}</p>
        </Problem>
      )}
      {resent && !error && <p className="text-[14px] font-semibold text-ink">Đã gửi lại. Hãy mở thư mới nhất.</p>}

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
        <form action={action}>
          <input type="hidden" name="email" value={email} />
          <input type="hidden" name="next" value={next} />
          <button type="submit" disabled={countdown > 0 || sending} aria-busy={sending} className={SECONDARY}>
            {countdown > 0 && <ClockIcon className="size-4" />}
            {sending ? "Đang gửi…" : countdown > 0 ? `${resendLabel} sau ${countdown} giây` : resendLabel}
          </button>
        </form>
        <button type="button" onClick={onRestart} className="inline-flex min-h-11 items-center text-[14px] text-ink-2 underline underline-offset-4 hover:text-ink">
          Dùng email khác
        </button>
      </div>
    </div>
  );
}

"use client";

import { useActionState, useEffect, useState } from "react";
import {
  requestLoginCode,
  verifyLoginCode,
  type LoginState,
} from "@/actions/auth";
import { authErrorFromCode } from "@/lib/auth/errors";

interface LoginFormProps {
  initialNext: string;
  initialError?: string;
}

export function LoginForm({ initialNext, initialError }: LoginFormProps) {
  const [requestState, requestAction, isRequestPending] = useActionState(
    requestLoginCode,
    { status: "idle" } as LoginState,
  );

  const [verifyState, verifyAction, isVerifyPending] = useActionState(
    verifyLoginCode,
    { status: "idle" } as LoginState,
  );

  const [countdown, setCountdown] = useState<number>(0);
  const [emailInput, setEmailInput] = useState<string>("");

  // Bắt đầu đếm ngược khi requestState đổi (gửi mã thành công hoặc bị giới hạn).
  // Điều chỉnh state ngay trong render thay vì setState trong effect.
  const [seenRequestState, setSeenRequestState] = useState(requestState);
  if (requestState !== seenRequestState) {
    setSeenRequestState(requestState);
    if (requestState.status === "sent") {
      setCountdown(60);
    } else if (
      requestState.status === "error" &&
      requestState.error.retryAfterSeconds
    ) {
      setCountdown(requestState.error.retryAfterSeconds);
    }
  }

  useEffect(() => {
    if (countdown <= 0) return;
    const timer = setInterval(() => {
      setCountdown((prev) => (prev > 0 ? prev - 1 : 0));
    }, 1000);
    return () => clearInterval(timer);
  }, [countdown]);

  const activeEmail =
    requestState.status === "sent" ? requestState.email : emailInput;
  const isSent = requestState.status === "sent";

  // Thông báo lỗi ưu tiên: verifyState lỗi > requestState lỗi > initialError
  let errorMessage: string | null = null;
  if (verifyState.status === "error") {
    errorMessage = verifyState.error.message;
  } else if (requestState.status === "error") {
    errorMessage = requestState.error.message;
  } else if (initialError) {
    errorMessage =
      authErrorFromCode(initialError)?.message ??
      "Có lỗi xảy ra khi xác thực. Vui lòng thử lại.";
  }

  return (
    <div className="w-full space-y-6">
      {/* Banner thông báo lỗi nếu có */}
      {errorMessage && (
        <div
          role="alert"
          className="rounded-xl border border-red-500/20 bg-red-500/10 p-4 text-xs font-medium text-red-600 dark:text-red-400"
        >
          {errorMessage}
        </div>
      )}

      {!isSent ? (
        /* BƯỚC 1: NHẬP EMAIL */
        <form action={requestAction} className="space-y-4">
          <input type="hidden" name="next" value={initialNext} />

          <div className="space-y-1.5">
            <label
              htmlFor="email"
              className="text-xs font-semibold uppercase tracking-wider text-muted"
            >
              Địa chỉ Email
            </label>
            <input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              required
              autoFocus
              value={emailInput}
              onChange={(e) => setEmailInput(e.target.value)}
              placeholder="ten@vidu.vn"
              className="w-full rounded-xl border border-border bg-background px-4 py-2.5 text-sm text-foreground placeholder:text-muted/60 focus:border-foreground focus:outline-none focus:ring-1 focus:ring-foreground"
            />
          </div>

          <button
            type="submit"
            disabled={isRequestPending}
            className="w-full rounded-xl bg-foreground py-2.5 text-sm font-semibold text-background transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isRequestPending ? "Đang gửi mã..." : "Gửi mã đăng nhập"}
          </button>
        </form>
      ) : (
        /* BƯỚC 2: NHẬP MÃ 6 SỐ HOẶC BẤM LINK TRONG EMAIL */
        <div className="space-y-6">
          <div className="rounded-xl border border-border bg-black/[0.02] p-4 text-xs leading-relaxed text-muted dark:bg-white/[0.02]">
            <p>
              Đã gửi liên kết và mã đăng nhập 6 số tới:{" "}
              <strong className="text-foreground">{activeEmail}</strong>.
            </p>
            <p className="mt-1">
              Bạn có thể <strong>bấm vào liên kết trong email</strong> hoặc nhập
              mã 6 số bên dưới:
            </p>
          </div>

          <form action={verifyAction} className="space-y-4">
            <input type="hidden" name="email" value={activeEmail} />
            <input type="hidden" name="next" value={initialNext} />

            <div className="space-y-1.5">
              <label
                htmlFor="token"
                className="text-xs font-semibold uppercase tracking-wider text-muted"
              >
                Mã xác nhận 6 số
              </label>
              <input
                id="token"
                name="token"
                type="text"
                inputMode="numeric"
                pattern="[0-9]{6}"
                maxLength={6}
                required
                autoFocus
                placeholder="123456"
                className="w-full rounded-xl border border-border bg-background px-4 py-3 text-center font-mono text-2xl font-bold tracking-widest text-foreground placeholder:tracking-normal placeholder:font-sans placeholder:text-sm placeholder:text-muted/40 focus:border-foreground focus:outline-none focus:ring-1 focus:ring-foreground"
              />
            </div>

            <button
              type="submit"
              disabled={isVerifyPending}
              className="w-full rounded-xl bg-foreground py-2.5 text-sm font-semibold text-background transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isVerifyPending ? "Đang xác thực..." : "Xác nhận đăng nhập"}
            </button>
          </form>

          {/* Gửi lại mã & Đổi email */}
          <div className="flex items-center justify-between text-xs text-muted pt-2 border-t border-border">
            <form action={requestAction}>
              <input type="hidden" name="email" value={activeEmail} />
              <input type="hidden" name="next" value={initialNext} />
              <button
                type="submit"
                disabled={countdown > 0 || isRequestPending}
                className="font-medium text-foreground hover:underline disabled:cursor-not-allowed disabled:opacity-50 disabled:no-underline"
              >
                {countdown > 0
                  ? `Gửi lại mã (${countdown}s)`
                  : "Gửi lại mã mới"}
              </button>
            </form>

            <button
              type="button"
              onClick={() => {
                // Quay lại bước nhập email
                window.location.reload();
              }}
              className="hover:text-foreground"
            >
              Dùng email khác
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

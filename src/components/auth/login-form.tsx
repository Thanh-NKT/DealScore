"use client";

import Link from "next/link";
import { useActionState, useId, useState } from "react";
import { resendConfirmation, signIn, type AuthFormState, type FieldErrors } from "@/actions/auth";
import { authErrorFromCode, isValidEmail, normalizeEmail } from "@/lib/auth/errors";
import { PASSWORD_MESSAGES } from "@/lib/auth/password";
import { CheckEmail } from "./check-email";
import { EmailField, PasswordField, PRIMARY, Problem, SECONDARY, TEXT_LINK, safe, useFieldErrors } from "./fields";

const IDLE: AuthFormState = { status: "idle" };

export function LoginForm({ initialNext, initialError }: { initialNext: string; initialError?: string }) {
  const uid = useId();
  const [state, action, pending] = useActionState(safe(signIn), IDLE);
  const [resendState, resendAction, resending] = useActionState(safe(resendConfirmation), IDLE);
  const { errors, setErrors, clear } = useFieldErrors(state);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showConfirmSent, setShowConfirmSent] = useState(true);

  const [seenResend, setSeenResend] = useState(resendState);
  if (resendState !== seenResend) {
    setSeenResend(resendState);
    setShowConfirmSent(true);
  }

  if (resendState.status === "check_email" && showConfirmSent) {
    return (
      <CheckEmail
        email={resendState.email}
        next={initialNext}
        lead="DealScore đã gửi lại thư xác nhận tới"
        resend={resendConfirmation}
        resendLabel="Gửi lại thư"
        onRestart={() => setShowConfirmSent(false)}
      />
    );
  }

  const serverError = state.status === "error" ? state.error : null;
  const resendError = resendState.status === "error" ? resendState.error : null;
  const urlError = state.status === "idle" && initialError ? authErrorFromCode(initialError) : null;
  const formError = serverError ?? urlError;

  return (
    <div className="space-y-5">
      {formError && (
        <Problem>
          <p>{formError.message}</p>
          {formError.code === "invalid_credentials" && (
            <p className="font-normal text-ink-2">
              Quên mật khẩu, hoặc trước đây đăng nhập bằng mã email?{" "}
              <Link href="/forgot-password" className={TEXT_LINK}>
                Đặt mật khẩu mới
              </Link>
            </p>
          )}
          {formError.code === "email_not_confirmed" && (
            <form action={resendAction}>
              <input type="hidden" name="email" value={normalizeEmail(email)} />
              <input type="hidden" name="next" value={initialNext} />
              <button type="submit" disabled={resending} aria-busy={resending} className={`${SECONDARY} mt-1`}>
                {resending ? "Đang gửi…" : "Gửi lại thư xác nhận"}
              </button>
              {resendError && <p className="mt-2 font-normal text-ink-2">{resendError.message}</p>}
            </form>
          )}
        </Problem>
      )}

      <form
        action={action}
        noValidate
        onSubmit={(e) => {
          const normalized = normalizeEmail(email);
          const next: FieldErrors = {};
          if (!normalized) next.email = "Nhập email của bạn.";
          else if (!isValidEmail(normalized)) next.email = "Email chưa đúng định dạng, ví dụ ten@gmail.com.";
          if (!password) next.password = PASSWORD_MESSAGES.empty;
          if (next.email || next.password || pending) {
            e.preventDefault();
            setErrors(next);
          }
        }}
        className="space-y-5"
      >
        <input type="hidden" name="next" value={initialNext} />
        <EmailField
          id={`${uid}-email`}
          value={email}
          onChange={(v) => {
            setEmail(v);
            clear("email");
          }}
          error={errors.email}
          autoFocus
        />
        <PasswordField
          id={`${uid}-password`}
          value={password}
          onChange={(v) => {
            setPassword(v);
            clear("password");
          }}
          error={errors.password}
          autoComplete="current-password"
          after={
            <Link href="/forgot-password" className={TEXT_LINK}>
              Quên mật khẩu?
            </Link>
          }
        />
        <button type="submit" disabled={pending} aria-busy={pending} className={PRIMARY}>
          {pending ? "Đang đăng nhập…" : "Đăng nhập"}
        </button>
      </form>
    </div>
  );
}

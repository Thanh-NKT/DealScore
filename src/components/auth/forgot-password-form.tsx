"use client";

import { useActionState, useId, useState } from "react";
import { requestPasswordReset, type AuthFormState } from "@/actions/auth";
import { authErrorFromCode, isValidEmail, normalizeEmail } from "@/lib/auth/errors";
import { CheckEmail } from "./check-email";
import { EmailField, PRIMARY, Problem, safe, useFieldErrors } from "./fields";

export function ForgotPasswordForm({ initialError }: { initialError?: string }) {
  const [attempt, setAttempt] = useState(0);
  const [email, setEmail] = useState("");
  return (
    <ForgotFlow
      key={attempt}
      initialError={attempt === 0 ? initialError : undefined}
      email={email}
      onEmailChange={setEmail}
      onRestart={() => setAttempt((a) => a + 1)}
    />
  );
}

function ForgotFlow({
  initialError,
  email,
  onEmailChange,
  onRestart,
}: {
  initialError?: string;
  email: string;
  onEmailChange: (v: string) => void;
  onRestart: () => void;
}) {
  const uid = useId();
  const [state, action, pending] = useActionState(safe(requestPasswordReset), { status: "idle" } as AuthFormState);
  const { errors, setErrors, clear } = useFieldErrors(state);

  if (state.status === "check_email") {
    return (
      <CheckEmail
        email={state.email}
        next="/"
        lead="Nếu email này có tài khoản DealScore, link đặt lại mật khẩu đã được gửi tới"
        resend={requestPasswordReset}
        resendLabel="Gửi lại link"
        onRestart={onRestart}
      />
    );
  }

  const formError = state.status === "error" ? state.error : initialError ? authErrorFromCode(initialError) : null;

  return (
    <form
      action={action}
      noValidate
      onSubmit={(e) => {
        const normalized = normalizeEmail(email);
        const problem = !normalized
          ? "Nhập email của bạn."
          : !isValidEmail(normalized)
            ? "Email chưa đúng định dạng, ví dụ ten@gmail.com."
            : undefined;
        if (problem || pending) {
          e.preventDefault();
          setErrors({ email: problem });
        }
      }}
      className="space-y-5"
    >
      {formError && (
        <Problem>
          <p>{formError.message}</p>
        </Problem>
      )}
      <EmailField
        id={`${uid}-email`}
        value={email}
        onChange={(v) => {
          onEmailChange(v);
          clear("email");
        }}
        error={errors.email}
        autoFocus
      />
      <button type="submit" disabled={pending} aria-busy={pending} className={PRIMARY}>
        {pending ? "Đang gửi…" : "Gửi link đặt lại"}
      </button>
    </form>
  );
}

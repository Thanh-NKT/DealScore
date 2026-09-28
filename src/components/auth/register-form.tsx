"use client";

import { useActionState, useId, useState } from "react";
import { signUp, resendConfirmation, type AuthFormState, type FieldErrors } from "@/actions/auth";
import { AUTH_MESSAGES, isValidEmail, normalizeEmail } from "@/lib/auth/errors";
import { PASSWORD_MESSAGES, passwordProblem } from "@/lib/auth/password";
import { CheckEmail } from "./check-email";
import { EmailField, PasswordField, PRIMARY, Problem, safe, useFieldErrors } from "./fields";

/** "Use another email" remounts the flow with a new key so the action state resets; the email is kept. */
export function RegisterForm({ initialNext }: { initialNext: string }) {
  const [attempt, setAttempt] = useState(0);
  const [email, setEmail] = useState("");
  return (
    <RegisterFlow
      key={attempt}
      initialNext={initialNext}
      email={email}
      onEmailChange={setEmail}
      onRestart={() => setAttempt((a) => a + 1)}
    />
  );
}

function RegisterFlow({
  initialNext,
  email,
  onEmailChange,
  onRestart,
}: {
  initialNext: string;
  email: string;
  onEmailChange: (v: string) => void;
  onRestart: () => void;
}) {
  const uid = useId();
  const [state, action, pending] = useActionState(safe(signUp), { status: "idle" } as AuthFormState);
  const { errors, setErrors, clear } = useFieldErrors(state);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");

  if (state.status === "check_email") {
    return (
      <CheckEmail
        email={state.email}
        next={state.next}
        lead="Gần xong rồi. Bấm link xác nhận Kairo vừa gửi tới"
        note="Nếu email này đã có tài khoản, hãy đăng nhập hoặc đặt lại mật khẩu."
        resend={resendConfirmation}
        resendLabel="Gửi lại thư"
        onRestart={onRestart}
      />
    );
  }

  const formError = state.status === "error" ? state.error : null;

  return (
    <form
      action={action}
      noValidate
      onSubmit={(e) => {
        const normalized = normalizeEmail(email);
        const next: FieldErrors = {};
        if (!normalized) next.email = "Nhập email của bạn.";
        else if (!isValidEmail(normalized)) next.email = "Email chưa đúng định dạng, ví dụ ten@gmail.com.";
        const problem = passwordProblem(password, normalized);
        if (problem) next.password = PASSWORD_MESSAGES[problem];
        else if (password !== confirm) next.confirm = AUTH_MESSAGES.password_mismatch;
        if (next.email || next.password || next.confirm || pending) {
          e.preventDefault();
          setErrors(next);
        }
      }}
      className="space-y-5"
    >
      <input type="hidden" name="next" value={initialNext} />
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
      <PasswordField
        id={`${uid}-password`}
        label="Tạo mật khẩu"
        value={password}
        onChange={(v) => {
          setPassword(v);
          clear("password");
        }}
        error={errors.password}
        autoComplete="new-password"
        checklist
      />
      <PasswordField
        id={`${uid}-confirm`}
        name="confirm"
        label="Nhập lại mật khẩu"
        value={confirm}
        onChange={(v) => {
          setConfirm(v);
          clear("confirm");
        }}
        error={errors.confirm}
        autoComplete="new-password"
      />
      <button type="submit" disabled={pending} aria-busy={pending} className={PRIMARY}>
        {pending ? "Đang tạo tài khoản…" : "Tạo tài khoản"}
      </button>
    </form>
  );
}

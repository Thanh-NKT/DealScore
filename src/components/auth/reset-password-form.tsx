"use client";

import Link from "next/link";
import { useActionState, useId, useState } from "react";
import { updatePassword, type AuthFormState, type FieldErrors } from "@/actions/auth";
import { AUTH_MESSAGES } from "@/lib/auth/errors";
import { PASSWORD_MESSAGES, passwordProblem } from "@/lib/auth/password";
import { PasswordField, PRIMARY, Problem, TEXT_LINK, safe, useFieldErrors } from "./fields";

export function ResetPasswordForm({ email }: { email: string }) {
  const uid = useId();
  const [state, action, pending] = useActionState(safe(updatePassword), { status: "idle" } as AuthFormState);
  const { errors, setErrors, clear } = useFieldErrors(state);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");

  const formError = state.status === "error" ? state.error : null;

  return (
    <form
      action={action}
      noValidate
      onSubmit={(e) => {
        const next: FieldErrors = {};
        const problem = passwordProblem(password, email);
        if (problem) next.password = PASSWORD_MESSAGES[problem];
        if (!problem && password !== confirm) next.confirm = AUTH_MESSAGES.password_mismatch;
        if (next.password || next.confirm || pending) {
          e.preventDefault();
          setErrors(next);
        }
      }}
      className="space-y-5"
    >
      {/* Lets password managers file the new password under the right account. */}
      <input type="email" name="username" autoComplete="username" value={email} readOnly tabIndex={-1} aria-hidden="true" className="sr-only" />
      {formError && (
        <Problem>
          <p>{formError.message}</p>
          {formError.code === "link_expired" && (
            <p className="font-normal text-ink-2">
              <Link href="/forgot-password" className={TEXT_LINK}>
                Yêu cầu link mới
              </Link>
            </p>
          )}
        </Problem>
      )}
      <PasswordField
        id={`${uid}-password`}
        label="Mật khẩu mới"
        value={password}
        onChange={(v) => {
          setPassword(v);
          clear("password");
        }}
        error={errors.password}
        autoComplete="new-password"
        autoFocus
        checklist
      />
      <PasswordField
        id={`${uid}-confirm`}
        name="confirm"
        label="Nhập lại mật khẩu mới"
        value={confirm}
        onChange={(v) => {
          setConfirm(v);
          clear("confirm");
        }}
        error={errors.confirm}
        autoComplete="new-password"
      />
      <button type="submit" disabled={pending} aria-busy={pending} className={PRIMARY}>
        {pending ? "Đang lưu…" : "Lưu mật khẩu mới"}
      </button>
    </form>
  );
}

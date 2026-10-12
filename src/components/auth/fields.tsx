"use client";

import { useEffect, useState } from "react";
import { unstable_rethrow } from "next/navigation";
import type { AuthFormState, FieldErrors } from "@/actions/auth";
import { checkPassword } from "@/lib/auth/password";
import { AlertIcon, CheckIcon, DashIcon, EyeIcon, EyeOffIcon } from "@/components/ui/icons";
import { buttonClass } from "@/components/ui/button";
import { FieldMessage, inputClass } from "@/components/ui/field";

export const NETWORK_ERROR = "Chưa kết nối được tới DealScore. Kiểm tra mạng rồi thử lại.";

export const INPUT = inputClass({ size: "lg" });
export const PRIMARY = buttonClass({ size: "lg", block: true });
export const SECONDARY = buttonClass({ variant: "secondary", size: "md" });
export const TEXT_LINK = "font-semibold text-ink underline decoration-line-strong underline-offset-4 hover:decoration-ink";

type Action = (prev: AuthFormState, form: FormData) => Promise<AuthFormState>;

/** Wrap a server action so a dropped connection becomes a calm error instead of a crash. */
export function safe(action: Action): Action {
  return async (prev, form) => {
    try {
      return await action(prev, form);
    } catch (err) {
      unstable_rethrow(err); // successful sign-in redirects; let Next handle it
      return {
        status: "error",
        error: { code: "internal", message: NETWORK_ERROR },
        email: String(form.get("email") ?? ""),
        next: String(form.get("next") ?? "/"),
      };
    }
  };
}

/** Seconds left before another email may be sent. Restart with the returned setter. */
export function useCountdown(initial = 0) {
  const [left, setLeft] = useState(initial);
  useEffect(() => {
    if (left <= 0) return;
    const t = window.setTimeout(() => setLeft((c) => Math.max(0, c - 1)), 1000);
    return () => window.clearTimeout(t);
  }, [left]);
  return [left, setLeft] as const;
}

/**
 * Field errors shown right now: the server's after each submit, replaced by client checks on the next
 * submit, and cleared field by field as the person edits.
 */
export function useFieldErrors(state: AuthFormState) {
  const [errors, setErrors] = useState<FieldErrors>({});
  const [seen, setSeen] = useState(state);
  if (state !== seen) {
    setSeen(state);
    setErrors(state.status === "error" ? (state.fields ?? {}) : {});
  }
  const clear = (field: keyof FieldErrors) => setErrors((e) => (e[field] ? { ...e, [field]: undefined } : e));
  return { errors, setErrors, clear };
}

export function Problem({ id, children }: { id?: string; children: React.ReactNode }) {
  return (
    <div
      id={id}
      role="alert"
      className="flex items-start gap-2.5 rounded-tile bg-avoid-soft p-4 text-body-sm font-semibold text-avoid"
    >
      <AlertIcon className="mt-0.5 size-4 shrink-0" />
      <div className="min-w-0 space-y-2">{children}</div>
    </div>
  );
}

/** Common domain typos → the domain the person almost certainly meant. */
const DOMAIN_FIXES: Record<string, string> = {
  "gmai.com": "gmail.com",
  "gmial.com": "gmail.com",
  "gmail.co": "gmail.com",
  "gmail.con": "gmail.com",
  "gmail.vn": "gmail.com",
  "gamil.com": "gmail.com",
  "yahooo.com": "yahoo.com",
  "yaho.com": "yahoo.com",
  "hotmai.com": "hotmail.com",
  "outlook.co": "outlook.com",
  "icloud.co": "icloud.com",
};

function suggestEmail(email: string): string | null {
  const at = email.lastIndexOf("@");
  if (at < 1) return null;
  const fix = DOMAIN_FIXES[email.slice(at + 1).toLowerCase()];
  return fix ? `${email.slice(0, at + 1)}${fix}` : null;
}

export function EmailField({
  id,
  value,
  onChange,
  error,
  autoFocus,
}: {
  id: string;
  value: string;
  onChange: (v: string) => void;
  error?: string | null;
  autoFocus?: boolean;
}) {
  const suggestion = !error ? suggestEmail(value.trim()) : null;
  return (
    <div>
      <label htmlFor={id} className="text-body-sm font-semibold text-ink">
        Email
      </label>
      <input
        id={id}
        name="email"
        type="email"
        inputMode="email"
        autoComplete="email"
        autoCapitalize="none"
        spellCheck={false}
        autoFocus={autoFocus}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="ten@gmail.com"
        aria-invalid={Boolean(error) || undefined}
        aria-describedby={error || suggestion ? `${id}-msg` : undefined}
        className={`${INPUT} mt-1.5`}
      />
      <FieldMessage
        id={`${id}-msg`}
        error={error}
        hint={
          suggestion && (
            <p className="text-ink-2">
              Có phải bạn định nhập{" "}
              <button type="button" onClick={() => onChange(suggestion)} className="font-semibold text-ink underline decoration-line-strong underline-offset-4 hover:decoration-ink">
                {suggestion}
              </button>
              ?
            </p>
          )
        }
      />
    </div>
  );
}

export function PasswordField({
  id,
  name = "password",
  label = "Mật khẩu",
  value,
  onChange,
  error,
  autoComplete,
  autoFocus,
  checklist,
  after,
}: {
  id: string;
  name?: string;
  label?: string;
  value: string;
  onChange: (v: string) => void;
  error?: string | null;
  autoComplete: "current-password" | "new-password";
  autoFocus?: boolean;
  /** Show the live rule checklist (sign-up and reset). */
  checklist?: boolean;
  /** Rendered under the field, right-aligned (e.g. "Quên mật khẩu?"). */
  after?: React.ReactNode;
}) {
  const [visible, setVisible] = useState(false);
  const describedBy = [error && `${id}-msg`, checklist && `${id}-rules`].filter(Boolean).join(" ") || undefined;

  return (
    <div>
      <label htmlFor={id} className="text-body-sm font-semibold text-ink">
        {label}
      </label>
      <div className="relative mt-1.5">
        <input
          id={id}
          name={name}
          type={visible ? "text" : "password"}
          autoComplete={autoComplete}
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          autoFocus={autoFocus}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          aria-invalid={Boolean(error) || undefined}
          aria-describedby={describedBy}
          className={`${INPUT} pr-13`}
        />
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          aria-pressed={visible}
          aria-label={visible ? "Ẩn mật khẩu" : "Hiện mật khẩu"}
          aria-controls={id}
          className="absolute inset-y-0 right-0.5 my-auto inline-flex size-11 items-center justify-center rounded-full text-ink-2 transition-colors duration-150 ease-out hover:bg-surface-2 hover:text-ink"
        >
          {visible ? <EyeOffIcon className="size-5" /> : <EyeIcon className="size-5" />}
        </button>
      </div>
      <FieldMessage id={`${id}-msg`} error={error} />
      {checklist && <PasswordChecklist id={`${id}-rules`} password={value} />}
      {after && <div className="mt-2 flex justify-end text-body-sm">{after}</div>}
    </div>
  );
}

function PasswordChecklist({ id, password }: { id: string; password: string }) {
  return (
    <ul id={id} aria-label="Yêu cầu mật khẩu" className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-label">
      {checkPassword(password).map((c) => (
        <li key={c.rule} className={`flex items-center gap-1.5 transition-colors duration-150 ease-out ${c.ok ? "font-semibold text-ink" : "text-ink-3"}`}>
          {c.ok ? <CheckIcon className="size-4" /> : <DashIcon className="size-4" />}
          {c.label}
          <span className="sr-only">{c.ok ? ": đạt" : ": chưa đạt"}</span>
        </li>
      ))}
    </ul>
  );
}

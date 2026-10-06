"use client";

import { useFormStatus } from "react-dom";
import { buttonClass } from "@/components/ui/button";

/** Submit button of the /auth/confirm form; cannot be pressed twice (the token is single-use). */
export function ConfirmButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      aria-busy={pending}
      className={buttonClass({ size: "lg", block: true })}
    >
      {pending ? "Đang xác nhận…" : label}
    </button>
  );
}

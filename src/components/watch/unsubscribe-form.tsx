"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { AlertIcon } from "@/components/ui/icons";

interface UnsubscribeFormProps {
  token: string;
  scopeKind: "watch" | "email";
}

type Problem = "invalid" | "failed" | null;

/**
 * One tap, no guilt: the button does exactly what it says. Without JavaScript it is a plain POST to
 * /api/unsubscribe (which redirects to the "done" screen). With JavaScript the request runs in place
 * so a failure is explained here instead of on a raw error page, and the button can't be pressed twice.
 */
export function UnsubscribeForm({ token, scopeKind }: UnsubscribeFormProps) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<Problem>(null);
  const action = `/api/unsubscribe?t=${encodeURIComponent(token)}`;

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setProblem(null);
    try {
      const res = await fetch(action, { method: "POST", headers: { Accept: "application/json" } });
      if (res.ok) {
        router.replace(`/unsubscribe?done=${scopeKind}`);
        return;
      }
      setProblem(res.status === 400 ? "invalid" : "failed");
    } catch {
      setProblem("failed");
    }
    setBusy(false);
  };

  return (
    <form action={action} method="POST" onSubmit={onSubmit} className="space-y-3">
      <button
        type="submit"
        disabled={busy}
        aria-busy={busy}
        className="inline-flex min-h-[52px] w-full items-center justify-center rounded-md bg-primary px-5 text-[16px] font-semibold text-on-primary transition-colors duration-150 ease-out hover:bg-primary-hover disabled:cursor-progress disabled:bg-surface-2 disabled:text-ink-3"
      >
        {busy ? "Đang xử lý…" : scopeKind === "watch" ? "Tạm dừng thông báo sản phẩm này" : "Tắt email thông báo giá"}
      </button>
      <div aria-live="polite">
        {problem && (
          <p role="alert" className="flex items-start gap-2 text-left text-[14px] font-semibold text-avoid">
            <AlertIcon className="mt-0.5 size-4 shrink-0" />
            {problem === "invalid"
              ? "Liên kết này không còn dùng được. Bạn có thể tắt thông báo trong phần Thông báo của tài khoản."
              : "Chưa xử lý được do lỗi kết nối. Hãy bấm lại sau giây lát."}
          </p>
        )}
      </div>
    </form>
  );
}

"use client";

import { useActionState, useState } from "react";
import {
  requestAccountDeletion,
  type ActionResult,
} from "@/app/account/actions";

export function DeleteAccountForm() {
  const [state, formAction, isPending] = useActionState(
    requestAccountDeletion,
    { status: "idle" } as ActionResult<"confirm">,
  );

  const [confirmInput, setConfirmInput] = useState<string>("");
  const isMatch = confirmInput.trim().toUpperCase() === "XÓA";
  const errorMsg = state.status === "error" ? state.errors.confirm : null;

  return (
    <form action={formAction} className="space-y-6">
      {errorMsg && (
        <div
          role="alert"
          className="rounded-xl border border-red-500/20 bg-red-500/10 p-4 text-xs font-medium text-red-600 dark:text-red-400"
        >
          {errorMsg}
        </div>
      )}

      <div className="space-y-2">
        <label
          htmlFor="confirm"
          className="text-xs font-semibold uppercase tracking-wider text-muted"
        >
          Nhập chữ <strong className="text-red-600 dark:text-red-400">XÓA</strong>{" "}
          để xác nhận
        </label>
        <input
          id="confirm"
          name="confirm"
          type="text"
          required
          autoComplete="off"
          value={confirmInput}
          onChange={(e) => setConfirmInput(e.target.value)}
          placeholder="XÓA"
          className="w-full rounded-xl border border-red-500/30 bg-background px-4 py-2.5 text-sm text-foreground focus:border-red-500 focus:outline-none focus:ring-1 focus:ring-red-500"
        />
      </div>

      <button
        type="submit"
        disabled={!isMatch || isPending}
        className="w-full rounded-xl bg-red-600 py-2.5 text-sm font-semibold text-white transition-opacity hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-40"
      >
        {isPending ? "Đang xử lý xóa..." : "Xác nhận xóa tài khoản của tôi"}
      </button>
    </form>
  );
}

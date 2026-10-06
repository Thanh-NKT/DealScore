"use client";

import { useActionState, useId, useState } from "react";
import { unstable_rethrow } from "next/navigation";
import { requestAccountDeletion, type ActionResult } from "@/actions/account";
import { TextField } from "@/components/ui/field";
import { buttonClass } from "@/components/ui/button";

type Result = ActionResult<"confirm">;

async function submit(prev: Result, form: FormData): Promise<Result> {
  try {
    return await requestAccountDeletion(prev, form);
  } catch (err) {
    unstable_rethrow(err); // success redirects home
    return { status: "error", errors: { confirm: "Chưa gửi được yêu cầu xóa do lỗi kết nối. Tài khoản của bạn chưa bị thay đổi, hãy thử lại." } };
  }
}

/** Mirrors the server check exactly (requestAccountDeletion accepts "XÓA" or "xóa", NFC). */
const matches = (v: string) => {
  const t = v.trim().normalize("NFC");
  return t === "XÓA" || t === "xóa";
};

/**
 * Account deletion. Says exactly what goes (from the database's cascade rules) and what stays
 * unlinked, then asks for a typed confirmation because the final deletion cannot be undone. The
 * 30-day grace period is stated up front so nobody deletes by accident without knowing they can
 * come back. Errors keep the account untouched and say so.
 */
export function DeleteAccountForm() {
  const uid = useId();
  const [state, formAction, pending] = useActionState(submit, { status: "idle" } as Result);
  const [typed, setTyped] = useState("");
  const [tried, setTried] = useState(false);

  const ok = matches(typed);
  const serverError = state.status === "error" ? state.errors.confirm : null;
  const hint =
    tried && !ok
      ? /^xoa$/i.test(typed.trim())
        ? "Gõ chữ XÓA có dấu sắc để xác nhận."
        : "Gõ đúng chữ XÓA để xác nhận."
      : null;

  return (
    <div className="space-y-6">
      <section aria-labelledby={`${uid}-what`} className="space-y-3 text-control leading-relaxed text-ink">
        <h2 id={`${uid}-what`} className="display text-h4 font-bold leading-tight">
          Những gì sẽ bị xóa
        </h2>
        <ul className="list-disc space-y-1.5 pl-5">
          <li>Danh sách sản phẩm bạn đang theo dõi, cùng giá mong muốn và các điều kiện báo bạn đã đặt.</li>
          <li>Lịch sử các thông báo giá DealScore đã gửi cho bạn.</li>
          <li>Cài đặt thông báo và các trình duyệt đã đăng ký nhận thông báo.</li>
          <li>Email và tài khoản đăng nhập của bạn.</li>
        </ul>
        <h2 className="display pt-2 text-h4 font-bold leading-tight">Chuyện gì xảy ra tiếp theo</h2>
        <ul className="list-disc space-y-1.5 pl-5">
          <li>DealScore ngừng gửi mọi thông báo ngay, và bạn được đăng xuất khỏi tất cả thiết bị.</li>
          <li>
            Trong <b>30 ngày</b>, bạn vẫn có thể đăng nhập lại để khôi phục mọi thứ như cũ. Sau 30 ngày, dữ liệu trên bị xóa hẳn và{" "}
            <b>không thể khôi phục</b>.
          </li>
          <li>Nhật ký lượt bấm “Đến sàn” và lượt tra cứu được giữ lại để đối soát, nhưng không còn gắn với tài khoản của bạn.</li>
        </ul>
      </section>

      <form
        action={formAction}
        noValidate
        onSubmit={(e) => {
          setTried(true);
          if (!ok || pending) e.preventDefault();
        }}
        className="space-y-4 rounded-md border border-avoid bg-surface p-4"
      >
        <TextField
          id={`${uid}-confirm`}
          name="confirm"
          label={
            <>
              Gõ chữ <span className="rounded-sm bg-avoid-soft px-1.5 py-0.5 font-bold text-avoid">XÓA</span> để xác nhận
            </>
          }
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          error={hint ?? serverError}
        />

        <button
          type="submit"
          disabled={pending}
          aria-busy={pending}
          className={buttonClass({ variant: "danger", size: "lg", block: true })}
        >
          {pending ? "Đang gửi yêu cầu xóa…" : "Xóa tài khoản của tôi"}
        </button>
      </form>
    </div>
  );
}

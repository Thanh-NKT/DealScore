"use client";

import { useActionState } from "react";
import { acceptConsent, type ActionResult } from "@/app/tai-khoan/actions";

interface ConsentFormProps {
  initialNext: string;
}

export function ConsentForm({ initialNext }: ConsentFormProps) {
  const [state, formAction, isPending] = useActionState(
    acceptConsent,
    { status: "idle" } as ActionResult<"agree">,
  );

  const errorMsg = state.status === "error" ? state.errors.agree : null;

  return (
    <form action={formAction} className="space-y-6">
      <input type="hidden" name="next" value={initialNext} />

      {errorMsg && (
        <div
          role="alert"
          className="rounded-xl border border-red-500/20 bg-red-500/10 p-4 text-xs font-medium text-red-600 dark:text-red-400"
        >
          {errorMsg}
        </div>
      )}

      <div className="space-y-4">
        {/* Checkbox bắt buộc */}
        <label className="flex items-start gap-3 cursor-pointer">
          <input
            type="checkbox"
            name="agree"
            required
            className="mt-0.5 h-4 w-4 rounded border-border text-foreground accent-foreground focus:ring-foreground"
          />
          <span className="text-xs leading-relaxed text-foreground">
            <span className="text-red-500 font-bold">*</span> Tôi đã đọc và
            đồng ý với{" "}
            <a
              href="#dieu-khoan"
              onClick={(e) => {
                e.preventDefault();
                alert(
                  "Điều khoản sử dụng Kairo: Kairo cung cấp thông tin so sánh và lịch sử giá nhằm mục đích tham khảo. Người dùng chịu trách nhiệm về quyết định mua hàng trên các sàn thương mại điện tử.",
                );
              }}
              className="font-semibold underline hover:text-muted"
            >
              Điều khoản sử dụng
            </a>{" "}
            và{" "}
            <a
              href="#quyen-rieng-tu"
              onClick={(e) => {
                e.preventDefault();
                alert(
                  "Chính sách quyền riêng tư Kairo: Chúng tôi chỉ thu thập email để gửi thông báo giá và mã OTP. Bạn có thể xuất toàn bộ dữ liệu hoặc xóa tài khoản bất kỳ lúc nào.",
                );
              }}
              className="font-semibold underline hover:text-muted"
            >
              Chính sách quyền riêng tư
            </a>{" "}
            của Kairo.
          </span>
        </label>

        {/* Checkbox tùy chọn: marketing */}
        <label className="flex items-start gap-3 cursor-pointer">
          <input
            type="checkbox"
            name="marketing"
            className="mt-0.5 h-4 w-4 rounded border-border text-foreground accent-foreground focus:ring-foreground"
          />
          <span className="text-xs leading-relaxed text-muted">
            Nhận email về deal giá tốt nổi bật và tính năng mới từ Kairo (tùy
            chọn, có thể hủy bất kỳ lúc nào trong Cài đặt).
          </span>
        </label>
      </div>

      <button
        type="submit"
        disabled={isPending}
        className="w-full rounded-xl bg-foreground py-2.5 text-sm font-semibold text-background transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {isPending ? "Đang xử lý..." : "Đồng ý và Tiếp tục"}
      </button>
    </form>
  );
}

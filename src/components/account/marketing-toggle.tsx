"use client";

import { useTransition } from "react";
import { updateMarketingOptIn } from "@/app/tai-khoan/actions";

interface MarketingToggleProps {
  initialOptIn: boolean;
}

export function MarketingToggle({ initialOptIn }: MarketingToggleProps) {
  const [isPending, startTransition] = useTransition();

  const handleToggle = (checked: boolean) => {
    startTransition(async () => {
      const formData = new FormData();
      if (checked) {
        formData.set("marketing", "on");
      }
      await updateMarketingOptIn({ status: "idle" }, formData);
    });
  };

  return (
    <label className="flex items-center gap-3 cursor-pointer">
      <input
        type="checkbox"
        defaultChecked={initialOptIn}
        disabled={isPending}
        onChange={(e) => handleToggle(e.target.checked)}
        className="h-4 w-4 rounded border-border text-foreground accent-foreground focus:ring-foreground disabled:opacity-50"
      />
      <span className="text-xs text-muted">
        {isPending
          ? "Đang lưu thay đổi..."
          : "Nhận email gợi ý deal giảm giá sâu và tính năng mới"}
      </span>
    </label>
  );
}

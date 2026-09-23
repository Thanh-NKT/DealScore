"use client";

interface UnsubscribeFormProps {
  token: string;
  scopeKind: "watch" | "email";
}

export function UnsubscribeForm({ token, scopeKind }: UnsubscribeFormProps) {
  return (
    <form action={`/api/unsubscribe?t=${encodeURIComponent(token)}`} method="POST">
      <button
        type="submit"
        className="w-full rounded-xl bg-foreground py-2.5 text-sm font-semibold text-background transition-opacity hover:opacity-90"
      >
        {scopeKind === "watch"
          ? "Xác nhận tạm dừng Watch này"
          : "Xác nhận tắt toàn bộ email thông báo"}
      </button>
    </form>
  );
}

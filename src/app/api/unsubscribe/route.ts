import { NextResponse, type NextRequest } from "next/server";
import { verifyUnsubscribeToken } from "@/lib/alerts/unsubscribe-token";
import { createAdminClient } from "@/lib/supabase/admin";

const NO_STORE = { "Cache-Control": "no-store" };

/**
 * Chỉ POST. KHÔNG có GET: trình quét link của hộp thư tự mở mọi link, GET mà
 * hủy luôn thì người dùng bị hủy mà không hề bấm (W14).
 * Nhận cả One-Click của Gmail/Yahoo (RFC 8058) lẫn form từ trang /huy-dang-ky.
 */
export async function POST(request: NextRequest) {
  const secret = process.env.UNSUBSCRIBE_SECRET;
  const token = new URL(request.url).searchParams.get("t") ?? "";
  const scope = secret ? verifyUnsubscribeToken(token, secret) : null;
  if (!scope) return NextResponse.json({ error: "invalid_token" }, { status: 400, headers: NO_STORE });

  // Danh tính lấy từ token đã xác minh — không có session ở đây.
  const admin = createAdminClient();
  const { error } =
    scope.kind === "watch"
      ? await admin.from("watches").update({ status: "paused" }).eq("id", scope.watchId).eq("user_id", scope.userId)
      : await admin.from("notification_settings").update({ email_enabled: false }).eq("user_id", scope.userId);
  if (error) throw new Error(`Hủy đăng ký thất bại: ${error.message}`);

  if ((request.headers.get("accept") ?? "").includes("text/html")) {
    return NextResponse.redirect(new URL(`/huy-dang-ky?xong=${scope.kind}`, request.url), { status: 303, headers: NO_STORE });
  }
  return new NextResponse(null, { status: 200, headers: NO_STORE });
}

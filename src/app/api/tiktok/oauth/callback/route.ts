import type { NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { tiktokConfig } from "@/lib/tiktok/config";
import { exchangeCode, verifyState } from "@/lib/tiktok/oauth";
import { supabaseTokenStore } from "@/lib/tiktok/credentials";

export const dynamic = "force-dynamic";

function text(body: string, status: number) {
  return new Response(body, { status, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });
}

/**
 * TikTok Shop redirects here after the owner authorizes Kairo (link printed by `pnpm tiktok:authorize`).
 * The signed `state` proves we printed that link; tokens go straight to marketplace_credentials.
 */
export async function GET(request: NextRequest) {
  const cfg = tiktokConfig(process.env);
  const secret = process.env.CRON_SECRET;
  if (!cfg || !secret) return text("Kairo chưa cấu hình TikTok Shop.", 503);

  const params = new URL(request.url).searchParams;
  const code = params.get("code");
  const state = params.get("state") ?? "";
  if (!code || !verifyState(secret, state, new Date())) {
    return text("Liên kết ủy quyền đã hết hạn hoặc không hợp lệ. Chạy lại pnpm tiktok:authorize để lấy link mới.", 400);
  }

  try {
    const tokens = await exchangeCode(cfg, code);
    await supabaseTokenStore(createAdminClient()).save(tokens);
  } catch (err) {
    console.error("tiktok oauth callback failed:", err instanceof Error ? err.message : "unknown");
    return text("Không đổi được mã ủy quyền với TikTok Shop. Thử chạy lại pnpm tiktok:authorize.", 502);
  }
  return text("Đã kết nối TikTok Shop. Bạn có thể đóng trang này.", 200);
}

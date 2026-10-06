import type { NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { tiktokConfig } from "@/lib/tiktok/config";
import { consumeState, exchangeCode, oauthStateKey, verifyState } from "@/lib/tiktok/oauth";
import { supabaseTokenStore } from "@/lib/tiktok/credentials";
import { reportError } from "@/lib/observability";

export const dynamic = "force-dynamic";

function text(body: string, status: number) {
  return new Response(body, { status, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });
}

const INVALID = "Liên kết ủy quyền đã hết hạn, đã được dùng hoặc không hợp lệ. Chạy lại pnpm tiktok:authorize để lấy link mới.";

/**
 * TikTok Shop redirects here after the owner authorizes Kairo (link printed by `pnpm tiktok:authorize`
 * or the admin API). The signed `state` proves we printed that link, and its nonce is consumed so a
 * link works once; tokens go straight to marketplace_credentials.
 */
export async function GET(request: NextRequest) {
  const cfg = tiktokConfig(process.env);
  const key = oauthStateKey(process.env);
  if (!cfg || !key) return text("Kairo chưa cấu hình TikTok Shop.", 503);

  const params = new URL(request.url).searchParams;
  const code = params.get("code");
  const state = params.get("state") ?? "";
  const nonce = code ? verifyState(key, state, new Date()) : null;
  if (!code || !nonce) return text(INVALID, 400);

  const admin = createAdminClient();
  try {
    if (!(await consumeState(admin, nonce))) return text(INVALID, 400);
  } catch (err) {
    reportError(err, { where: "tiktok.oauth.consumeState" });
    return text("Không kiểm tra được liên kết ủy quyền. Thử lại sau.", 503);
  }

  try {
    const tokens = await exchangeCode(cfg, code);
    await supabaseTokenStore(admin).save(tokens);
  } catch (err) {
    console.error("tiktok oauth callback failed:", err instanceof Error ? err.message : "unknown");
    return text("Không đổi được mã ủy quyền với TikTok Shop. Thử chạy lại pnpm tiktok:authorize.", 502);
  }
  return text("Đã kết nối TikTok Shop. Bạn có thể đóng trang này.", 200);
}

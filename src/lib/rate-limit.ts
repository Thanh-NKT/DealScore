import crypto from "crypto";
import { createAdminClient } from "@/lib/supabase/admin";

export type LookupOutcome = "resolved" | "ingested" | "rejected" | "error";

export interface RateLimitVerdict {
  allowed: boolean;
  reason?: "ip_hourly" | "user_hourly" | "global_daily";
  retryAfterSeconds?: number;
}

const DEV_SALT = "kairo_lookup_dev_salt";

export function hashIp(ip: string): string {
  const salt = process.env.LOOKUP_IP_SALT;
  // Salt mặc định công khai trong repo thì hash IP đảo ngược được bằng vét cạn
  // (không gian IPv4 chỉ 2^32). Production bắt buộc có salt riêng.
  if (!salt && process.env.NODE_ENV === "production") {
    throw new Error("Thiếu LOOKUP_IP_SALT");
  }
  return crypto.createHash("sha256").update(`${ip}_${salt || DEV_SALT}`).digest("hex");
}

/**
 * IP của client, dùng làm khóa rate limit.
 *
 * GIẢ ĐỊNH triển khai: nền tảng phía trước (Vercel) GHI ĐÈ x-real-ip /
 * x-forwarded-for, nên client không giả được. Tự host sau proxy khác thì phải
 * cấu hình proxy ghi đè hai header này, nếu không mỗi request tự chọn được
 * "IP" của mình và hạn mức theo IP vô hiệu.
 */
export function clientIp(headers: Headers): string {
  const realIp = headers.get("x-real-ip")?.trim();
  if (realIp) return realIp;
  const forwarded = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || "unknown";
}

function retryAfter(reason: RateLimitVerdict["reason"]): number {
  // Cửa sổ trượt 1 giờ / 1 ngày: không biết chính xác lúc nào có chỗ, trả
  // cận trên để client không thử lại dồn dập.
  return reason === "global_daily" ? 86_400 : 3_600;
}

/**
 * Bắt đầu một lượt tra cứu: kiểm hạn mức chống quét (120/giờ/IP) và ghi một
 * dòng 'pending' — nguyên tử, trong DB. Lỗi DB thì NÉM, không cho qua: rate
 * limit tắt âm thầm là mở cửa cho quét catalog.
 */
export async function beginLookup(params: {
  ipHash: string;
  userId: string | null;
}): Promise<RateLimitVerdict & { requestId: number | null }> {
  const supabase = createAdminClient();
  const { data, error } = await supabase.rpc("lookup_begin", {
    p_ip_hash: params.ipHash,
    // Type sinh ra không biết tham số uuid nhận null.
    p_user_id: params.userId as string,
  });
  if (error) throw new Error(`lookup_begin thất bại: ${error.message}`);

  const row = data?.[0];
  if (!row) throw new Error("lookup_begin không trả kết quả");
  if (!row.allowed) {
    const reason = row.reason as RateLimitVerdict["reason"];
    return { allowed: false, reason, retryAfterSeconds: retryAfter(reason), requestId: null };
  }
  return { allowed: true, requestId: row.request_id };
}

/**
 * Nâng lượt tra cứu thành ingest mới: kiểm hạn mức ingest (khách 10/giờ/IP,
 * user 60/giờ, toàn hệ thống LOOKUP_DAILY_INGEST_CAP/ngày). Chỉ gọi khi URL
 * CHƯA có trong catalog.
 */
export async function beginIngest(requestId: number): Promise<RateLimitVerdict> {
  const supabase = createAdminClient();
  const cap = parseInt(process.env.LOOKUP_DAILY_INGEST_CAP || "2000", 10);
  const { data, error } = await supabase.rpc("lookup_begin_ingest", {
    p_request_id: requestId,
    p_global_cap: Number.isFinite(cap) ? cap : 2000,
  });
  if (error) throw new Error(`lookup_begin_ingest thất bại: ${error.message}`);

  const row = data?.[0];
  if (!row) throw new Error("lookup_begin_ingest không trả kết quả");
  if (!row.allowed) {
    const reason = row.reason as RateLimitVerdict["reason"];
    return { allowed: false, reason, retryAfterSeconds: retryAfter(reason) };
  }
  return { allowed: true };
}

/** Ghi kết quả cuối cùng của lượt tra cứu. Lỗi chỉ log — người dùng đã có kết quả. */
export async function finishLookup(requestId: number, outcome: LookupOutcome): Promise<void> {
  const supabase = createAdminClient();
  const { error } = await supabase
    .from("lookup_requests")
    .update({ outcome })
    .eq("id", requestId);
  if (error) console.error("Không ghi được outcome lookup_requests:", error.message);
}

import crypto from "crypto";
import { createAdminClient } from "@/lib/supabase/admin";

export type LookupOutcome = "resolved" | "ingested" | "rejected" | "error";

export interface RateLimitVerdict {
  allowed: boolean;
  reason?: "ip_hourly" | "user_hourly" | "global_daily";
  retryAfterSeconds?: number;
}

export function hashIp(ip: string): string {
  const salt = process.env.LOOKUP_IP_SALT || "kairo_lookup_default_salt";
  return crypto.createHash("sha256").update(`${ip}_${salt}`).digest("hex");
}

export async function checkLookupLimit(params: {
  ipHash: string;
  userId: string | null;
  isIngest: boolean;
}): Promise<RateLimitVerdict> {
  try {
    const supabase = createAdminClient();
    const oneHourAgo = new Date(Date.now() - 3600 * 1000).toISOString();
    const oneDayAgo = new Date(Date.now() - 86400 * 1000).toISOString();

    if (params.isIngest) {
      // 1. Kiểm tra trần toàn hệ thống trong ngày
      const globalDailyCap = parseInt(process.env.LOOKUP_DAILY_INGEST_CAP || "2000", 10);
      const { count: globalCount } = await supabase
        .from("lookup_requests")
        .select("id", { count: "exact", head: true })
        .eq("outcome", "ingested")
        .gte("created_at", oneDayAgo);

      if ((globalCount ?? 0) >= globalDailyCap) {
        return {
          allowed: false,
          reason: "global_daily",
          retryAfterSeconds: 3600,
        };
      }

      // 2. Nếu đã đăng nhập: 60 ingest / giờ
      if (params.userId) {
        const { count: userCount } = await supabase
          .from("lookup_requests")
          .select("id", { count: "exact", head: true })
          .eq("user_id", params.userId)
          .eq("outcome", "ingested")
          .gte("created_at", oneHourAgo);

        if ((userCount ?? 0) >= 60) {
          return {
            allowed: false,
            reason: "user_hourly",
            retryAfterSeconds: 3600,
          };
        }
      } else {
        // 3. Khách: 10 ingest / giờ theo IP
        const { count: ipCount } = await supabase
          .from("lookup_requests")
          .select("id", { count: "exact", head: true })
          .eq("ip_hash", params.ipHash)
          .eq("outcome", "ingested")
          .gte("created_at", oneHourAgo);

        if ((ipCount ?? 0) >= 10) {
          return {
            allowed: false,
            reason: "ip_hourly",
            retryAfterSeconds: 3600,
          };
        }
      }
    } else {
      // Tra cứu URL đã có trong catalog: tối đa 120 / giờ / IP (chống quét)
      const { count: lookupCount } = await supabase
        .from("lookup_requests")
        .select("id", { count: "exact", head: true })
        .eq("ip_hash", params.ipHash)
        .gte("created_at", oneHourAgo);

      if ((lookupCount ?? 0) >= 120) {
        return {
          allowed: false,
          reason: "ip_hourly",
          retryAfterSeconds: 3600,
        };
      }
    }

    return { allowed: true };
  } catch (error) {
    console.warn("Lỗi kiểm tra rate limit, cho phép truy cập:", error);
    return { allowed: true };
  }
}

export async function recordLookup(params: {
  ipHash: string;
  userId: string | null;
  outcome: LookupOutcome;
}): Promise<void> {
  try {
    const supabase = createAdminClient();
    await supabase.from("lookup_requests").insert({
      ip_hash: params.ipHash,
      user_id: params.userId,
      outcome: params.outcome,
    });
  } catch (error) {
    console.warn("Không thể ghi lookup_requests:", error);
  }
}

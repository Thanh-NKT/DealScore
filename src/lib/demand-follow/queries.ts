import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { createClient } from "@/lib/supabase/server";

export interface MyDemandFollow {
  id: string;
  keyword: string;
  status: "waiting" | "found" | "expired";
  createdAt: string;
  expiresAt: string;
  foundAt: string | null;
}

/** The signed-in user's follows (≤ 10 waiting + finished ones kept 30 days), through RLS. */
export async function listMyDemandFollows(userId: string, client?: SupabaseClient<Database>): Promise<MyDemandFollow[]> {
  const supabase = client ?? (await createClient());
  const { data, error } = await supabase
    .from("demand_follows")
    .select("id, keyword, status, created_at, expires_at, found_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) throw new Error(`Failed to load demand follows: ${error.message}`);
  return (data ?? []).map((r) => ({
    id: r.id,
    keyword: r.keyword,
    status: r.status === "found" || r.status === "expired" ? r.status : "waiting",
    createdAt: r.created_at,
    expiresAt: r.expires_at,
    foundAt: r.found_at,
  }));
}

/** Whether the user already waits for this keyword (search page shows "Đã bật" instead of the button). */
export async function findMyDemandFollow(
  userId: string,
  keyword: string,
  client?: SupabaseClient<Database>,
): Promise<{ id: string; expiresAt: string } | null> {
  const supabase = client ?? (await createClient());
  const { data } = await supabase
    .from("demand_follows")
    .select("id, expires_at")
    .eq("user_id", userId)
    .eq("keyword", keyword)
    .eq("status", "waiting")
    .maybeSingle();
  return data ? { id: data.id, expiresAt: data.expires_at } : null;
}

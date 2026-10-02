import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { configuredMarketplaces } from "@/lib/marketplaces/sources";
import { demandDailyCap, demandKeyword, shouldRecordDemand } from "@/lib/sourcing/demand";

/**
 * A name search found (almost) nothing: queue its keyword for sourcing on every configured
 * marketplace. Call inside after(). Never throws — losing a demand signal must not break search.
 */
export async function recordSearchDemand(input: {
  q: string | undefined;
  total: number;
  page: number;
  intent?: { text: string; brands?: string[]; categoryName?: string };
}): Promise<void> {
  try {
    if (!shouldRecordDemand(input)) return;
    const keyword = demandKeyword(input.q!, input.intent);
    if (!keyword) return;
    const marketplaces = configuredMarketplaces();
    const cap = demandDailyCap();
    if (marketplaces.length === 0 || cap === 0) return;
    const { error } = await createAdminClient().rpc("request_sourcing_query", {
      p_value: keyword,
      p_marketplaces: marketplaces,
      p_daily_cap: cap,
    });
    if (error) console.error("recordSearchDemand failed:", error.message);
  } catch (err) {
    console.error("recordSearchDemand failed:", err instanceof Error ? err.message : err);
  }
}

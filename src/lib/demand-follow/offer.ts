import { demandKeyword, shouldRecordDemand } from "@/lib/sourcing/demand";
import type { DemandIntent } from "@/lib/search/resolve-params";

/**
 * The "Báo tôi khi có" opt-in appears exactly where demand is recorded for sourcing (same rule): a name search
 * with < 3 results on page 1 whose cleaned keyword is valid (no e-mail, phone, URL or hostname). Pure.
 */
export function demandFollowOffer(input: {
  q: string | undefined;
  total: number;
  page: number;
  intent?: DemandIntent;
}): { keyword: string } | null {
  if (!shouldRecordDemand(input)) return null;
  const keyword = demandKeyword(input.q!, input.intent);
  return keyword ? { keyword } : null;
}

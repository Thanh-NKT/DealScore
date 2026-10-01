import { getSource } from "@/lib/marketplaces/sources";

/**
 * Whether POST /api/vouchers/refresh can succeed for a listing on this marketplace: it has a configured
 * data source. The product page offers "Làm mới" exactly when this is true, instead of a button that can
 * only answer 503. Nothing here names a marketplace.
 */
export function canRefreshVouchers(marketplace: string): boolean {
  return getSource(marketplace)?.isConfigured() ?? false;
}

import { getAdapter } from "@/lib/marketplaces";

/**
 * Whether POST /api/vouchers/refresh can succeed for a listing on this marketplace: its adapter has a
 * configured data source and can read a listing's details. The product page offers "Làm mới" exactly
 * when this is true, instead of a button that can only answer 503. A new marketplace gets refresh by
 * implementing `fetchListingDetail` in its adapter — nothing here names a marketplace.
 */
export function canRefreshVouchers(marketplace: string): boolean {
  const adapter = getAdapter(marketplace);
  return adapter != null && adapter.fetchListingDetail != null && adapter.isConfigured();
}

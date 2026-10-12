import { parseProductUrl } from "@/lib/marketplaces";
import type { Env, MarketplaceId, MarketplaceItem } from "@/lib/marketplaces/types";

const REQUIRED_ENV: Record<"shopee" | "tiktok", string[]> = {
  shopee: ["SHOPEE_AFFILIATE_APP_ID", "SHOPEE_AFFILIATE_SECRET"],
  tiktok: ["TIKTOK_SHOP_APP_KEY", "TIKTOK_SHOP_APP_SECRET"],
};

export function missingEnv(marketplace: "shopee" | "tiktok", env: Env): string[] {
  return REQUIRED_ENV[marketplace].filter((k) => !env[k]);
}

export function probeTarget(
  marketplace: MarketplaceId,
  arg: string,
): { kind: "item"; externalItemId: string } | { kind: "search"; value: string } {
  const parsed = parseProductUrl(arg);
  if (parsed.ok && parsed.item.marketplace === marketplace) return { kind: "item", externalItemId: parsed.item.externalItemId };
  if (marketplace === "shopee" && /^\d+_\d+$/.test(arg)) return { kind: "item", externalItemId: arg };
  if (marketplace === "tiktok" && /^\d{6,25}$/.test(arg)) return { kind: "item", externalItemId: arg };
  return { kind: "search", value: arg };
}

export function redact(text: string, secrets: string[]): string {
  return secrets.filter((s) => s.length > 0).reduce((t, s) => t.split(s).join("***"), text);
}

/** Fields S2/T4 promised that came back empty — revise the normalizer if a real response has them under another name. */
export function expectedFieldWarnings(item: MarketplaceItem): string[] {
  const w: string[] = [];
  if (item.models.every((m) => m.price == null)) w.push("price");
  if (!item.seller.name) w.push("seller.name");
  if (item.images.length === 0) w.push("images");
  return w;
}

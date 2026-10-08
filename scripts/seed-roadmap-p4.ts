/**
 * Roadmap P4 seed: fake data so every "đủ dữ liệu" and "chưa đủ dữ liệu" state of A, E, F, G, H, J, K can be
 * reviewed locally.
 *
 * Run: pnpm seed:p4
 *
 * ADDITIVE and idempotent: never wipes anything; rows are keyed by `seed-p4-*` slugs / external ids and the
 * `p4@dealscore.test` account, and a second run only fills what is missing. Refuses to run unless
 * NEXT_PUBLIC_SUPABASE_URL is a local Supabase (127.0.0.1 / localhost — the tests/db rule, no bypass).
 *
 * What you get:
 *   - categories `ta-bim` "Tã bỉm" and `sua` "Sữa" with unit-quantity variants (48 / 96 miếng, Thùng 48 hộp
 *     180ml, Lốc 4 hộp 180ml, 1,5L) → unit prices (G);
 *   - three variants with 400 days of prices dipping on 9.9 / 10.10 / 11.11 / 12.12 / Black Friday / Tết, the
 *     others 120 days → season "ok" and "partial" states (A); categories stay under 8 variants → the category
 *     strip's "chưa đủ dữ liệu" state;
 *   - sellers: one with 120 days of voucher checks and recurring end-of-month shop vouchers (K patterns), one
 *     with 10 check days (K insufficient), one with inflated list prices (H doubtful claims), one stable (H);
 *   - user p4@dealscore.test (password as seed-dev) with 2 saved searches (one baselined, one initialised
 *     with no hits → its next evaluation alerts), 2 demand follows (waiting, found) and one shared folder
 *     (its token is printed — local only).
 *
 * Wrapped in main(): tsx compiles .ts files to CJS, which forbids top-level await.
 */
import { randomBytes } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../src/lib/database.types";
import { requireStrictLocalSupabase } from "./guard-env";
import { recomputeDealScores } from "../src/lib/pricing/recompute-scores";
import { recomputeSellerProfiles } from "../src/lib/sellers/profile-job";
import { recomputeCategorySeasons } from "../src/lib/seasons/job";
import { seasonWindows } from "../src/lib/seasons/events";

const SEED_PASSWORD = "DealScoreTest2026";
const USER_EMAIL = "p4@dealscore.test";
const DAY = 86_400_000;

type Db = SupabaseClient<Database>;

const vnDay = (t: number) => new Date(t + 7 * 3_600_000).toISOString().slice(0, 10);
const noonUtc = (day: string) => `${day}T05:00:00Z`;

interface ProductSpec {
  slug: string;
  name: string;
  brand: string;
  category: string;
  variants: Array<{ key: string; base: number; days: number }>;
}
const PRODUCTS: ProductSpec[] = [
  {
    slug: "seed-p4-ta-quan-bobby-l",
    name: "Tã quần Bobby size L",
    brand: "Bobby",
    category: "ta-bim",
    variants: [
      { key: "48 miếng", base: 189_000, days: 400 },
      { key: "96 miếng", base: 349_000, days: 400 },
    ],
  },
  {
    slug: "seed-p4-sua-tuoi-th-180ml",
    name: "Sữa tươi tiệt trùng TH true MILK 180ml",
    brand: "TH true MILK",
    category: "sua",
    variants: [
      { key: "Thùng 48 hộp 180ml", base: 385_000, days: 400 },
      { key: "Lốc 4 hộp 180ml", base: 34_000, days: 120 },
    ],
  },
  {
    slug: "seed-p4-sua-vinamilk-1-5l",
    name: "Sữa tươi Vinamilk 1,5L",
    brand: "Vinamilk",
    category: "sua",
    variants: [{ key: "Mặc định", base: 59_000, days: 120 }],
  },
];

const SELLERS = [
  { ext: "seed-p4-shop-vouchers", name: "Shop Mẹ Bé P4 (mã cuối tháng)" },
  { ext: "seed-p4-shop-few-checks", name: "Shop P4 ít dữ liệu" },
  { ext: "seed-p4-shop-inflated", name: "Shop P4 giá niêm yết cao" },
  { ext: "seed-p4-shop-stable", name: "Shop P4 giá ổn định" },
] as const;

async function must<T>(p: PromiseLike<{ data: T; error: { message: string } | null }>, what: string): Promise<T> {
  const { data, error } = await p;
  if (error) throw new Error(`${what}: ${error.message}`);
  return data;
}

async function one<T>(p: PromiseLike<{ data: T; error: { message: string } | null }>, what: string): Promise<NonNullable<T>> {
  const d = await must(p, what);
  if (d == null) throw new Error(`${what}: no row`);
  return d as NonNullable<T>;
}

async function upsertCategory(db: Db, slug: string, name: string): Promise<string> {
  const found = await must(db.from("categories").select("id").eq("slug", slug).maybeSingle(), "read category");
  if (found) return found.id;
  return (await one(db.from("categories").insert({ slug, name, sort_order: 90 }).select("id").single(), "insert category")).id;
}

async function upsertSeller(db: Db, ext: string, name: string): Promise<string> {
  const found = await must(db.from("sellers").select("id").eq("marketplace", "shopee").eq("external_seller_id", ext).maybeSingle(), "read seller");
  if (found) return found.id;
  return (
    await one(
      db.from("sellers").insert({ marketplace: "shopee", external_seller_id: ext, name, rating: 4.8, rating_count: 1200 }).select("id").single(),
      "insert seller",
    )
  ).id;
}

/** Price of a day: base, −15% inside sale windows, small weekly wobble; the stable shop never moves. */
function priceOn(day: string, base: number, windows: Array<{ start: string; end: string }>, stable: boolean): number {
  if (stable) return base;
  const inSale = windows.some((w) => day >= w.start && day <= w.end);
  const wobble = 1 + ((Number(day.slice(8, 10)) % 7) - 3) / 100;
  return Math.round((base * (inSale ? 0.85 : wobble)) / 1000) * 1000;
}

async function seedCatalog(db: Db, now: number, sellerIds: Record<string, string>) {
  const cat: Record<string, string> = {
    "ta-bim": await upsertCategory(db, "ta-bim", "Tã bỉm"),
    sua: await upsertCategory(db, "sua", "Sữa"),
  };
  const today = vnDay(now);
  const windows = seasonWindows(vnDay(now - 401 * DAY), today);
  const variantIds: string[] = [];
  const seasonVariantIds: string[] = [];
  let obsTotal = 0;

  for (const p of PRODUCTS) {
    let product = await must(db.from("products").select("id").eq("slug", p.slug).maybeSingle(), "read product");
    if (!product) {
      product = await one(
        db
          .from("products")
          .insert({ slug: p.slug, canonical_name: p.name, brand: p.brand, category_id: cat[p.category], status: "verified" })
          .select("id")
          .single(),
        "insert product",
      );
    }
    for (const [vi, v] of p.variants.entries()) {
      let variant = await must(
        db.from("product_variants").select("id").eq("product_id", product.id).eq("variant_key", v.key).maybeSingle(),
        "read variant",
      );
      if (!variant) {
        variant = await one(db.from("product_variants").insert({ product_id: product.id, variant_key: v.key }).select("id").single(), "insert variant");
      }
      variantIds.push(variant.id);
      if (v.days >= 400) seasonVariantIds.push(variant.id);

      // Three shops sell each variant: the voucher shop, the inflated-list shop and the stable shop (first
      // variant of each product also from the few-checks shop).
      const shops = ["seed-p4-shop-vouchers", "seed-p4-shop-inflated", "seed-p4-shop-stable", ...(vi === 0 ? ["seed-p4-shop-few-checks"] : [])];
      for (const shop of shops) {
        const ext = `${p.slug}-${vi}-${shop}`;
        let listing = await must(db.from("listings").select("id").eq("marketplace", "shopee").eq("external_item_id", ext).maybeSingle(), "read listing");
        if (!listing) {
          listing = await one(
            db
              .from("listings")
              .insert({
                marketplace: "shopee",
                external_item_id: ext,
                seller_id: sellerIds[shop],
                title: `${p.name} ${v.key}`,
                url: `https://shopee.vn/product/0/${Math.abs(hash(ext))}`,
                status: "active",
                last_observed_at: new Date(now).toISOString(),
              })
              .select("id")
              .single(),
            "insert listing",
          );
        }
        let offer = await must(db.from("offers").select("id").eq("listing_id", listing.id).maybeSingle(), "read offer");
        if (offer) continue; // already seeded: observations exist
        offer = await one(
          db.from("offers").insert({ listing_id: listing.id, variant_id: variant.id, match_status: "manual", match_confidence: 1 }).select("id").single(),
          "insert offer",
        );
        const stable = shop === "seed-p4-shop-stable";
        const inflated = shop === "seed-p4-shop-inflated";
        const markup = shop === "seed-p4-shop-vouchers" ? 1 : shop === "seed-p4-shop-few-checks" ? 1.04 : 1.02;
        const rows = [];
        for (let i = v.days - 1; i >= 0; i--) {
          const day = vnDay(now - i * DAY);
          const price = Math.round((priceOn(day, v.base, windows, stable) * markup) / 1000) * 1000;
          rows.push({
            offer_id: offer.id,
            // today: a minute ago (noon VN may still be ahead)
            observed_at: i === 0 ? new Date(now - 60_000).toISOString() : noonUtc(day),
            price,
            // Inflated shop: a struck-through list price ~2× the real price every day (list_inflated claims).
            original_price: inflated ? price * 2 : stable ? null : Math.round(price * 1.1),
            stock: 50,
            source: "seed",
            is_flash_sale: false,
            is_valid: true,
          });
        }
        for (let i = 0; i < rows.length; i += 500) {
          await must(db.from("price_observations").insert(rows.slice(i, i + 500)), "insert observations");
        }
        obsTotal += rows.length;
      }
    }
  }

  await must(db.rpc("refresh_variant_current_price", { p_variant_ids: variantIds }), "refresh_variant_current_price");
  await must(
    db.rpc("refresh_variant_daily_prices", { p_from: vnDay(now - 401 * DAY), p_to: today, p_variant_ids: variantIds }),
    "refresh_variant_daily_prices",
  );
  await recomputeDealScores(db, { variantIds });
  console.log(`  catalog: ${variantIds.length} variants (${seasonVariantIds.length} with 400 days), ${obsTotal} new observations`);
  return { variantIds };
}

function hash(s: string): number {
  let h = 0;
  for (const c of s) h = (h * 31 + c.charCodeAt(0)) | 0;
  return h;
}

async function seedVouchers(db: Db, now: number, sellerIds: Record<string, string>) {
  const voucherShop = sellerIds["seed-p4-shop-vouchers"];
  const fewShop = sellerIds["seed-p4-shop-few-checks"];
  // Coverage: every 2nd day for 120 days (60 check days over ~5 months) vs 10 check days.
  const checks = [
    ...Array.from({ length: 60 }, (_, i) => ({ seller_id: voucherShop, day: vnDay(now - i * 2 * DAY), vouchers_seen: 1 })),
    ...Array.from({ length: 10 }, (_, i) => ({ seller_id: fewShop, day: vnDay(now - i * DAY), vouchers_seen: 0 })),
  ];
  await must(db.from("voucher_seller_checks").upsert(checks, { onConflict: "seller_id,day", ignoreDuplicates: true }), "voucher checks");

  // Two shop voucher shapes: 50k off from 500k (end of month), 10% up to 30k (on double days).
  const shapes = [
    { code: "SEEDP4CUOI", discount_type: "amount", discount_value: 50_000, max_discount: null, min_spend: 500_000, days: (d: string) => Number(d.slice(8, 10)) >= 25 },
    { code: "SEEDP4DOI", discount_type: "percent", discount_value: 10, max_discount: 30_000, min_spend: 0, days: (d: string) => Number(d.slice(5, 7)) === Number(d.slice(8, 10)) },
  ] as const;
  for (const s of shapes) {
    let v = await must(db.from("vouchers").select("id").eq("seller_id", voucherShop).eq("code", s.code).maybeSingle(), "read voucher");
    if (!v) {
      v = await one(
        db
          .from("vouchers")
          .insert({
            marketplace: "shopee", kind: "shop", seller_id: voucherShop, code: s.code, discount_type: s.discount_type,
            discount_value: s.discount_value, max_discount: s.max_discount, min_spend: s.min_spend, source: "seed",
            last_seen_at: new Date(now).toISOString(),
          })
          .select("id")
          .single(),
        "insert voucher",
      );
    }
    const days = Array.from({ length: 120 }, (_, i) => vnDay(now - i * DAY)).filter(s.days);
    await must(
      db.from("voucher_sightings").upsert(days.map((day) => ({ voucher_id: v!.id, day })), { onConflict: "voucher_id,day", ignoreDuplicates: true }),
      "voucher sightings",
    );
  }
  console.log("  vouchers: 60 + 10 check days, 2 recurring shop voucher shapes");
}

async function seedUser(db: Db, now: number, variantIds: string[]) {
  let userId: string | null = null;
  const existing = await must(db.from("users").select("id").eq("email", USER_EMAIL).maybeSingle(), "read user");
  if (existing) userId = existing.id;
  else {
    const { data, error } = await db.auth.admin.createUser({ email: USER_EMAIL, password: SEED_PASSWORD, email_confirm: true });
    if (error || !data.user) throw new Error(`create user: ${error?.message}`);
    userId = data.user.id;
  }

  // Saved searches: one baselined with today's matches, one initialised with no hits (alerts on next run).
  const searches = [
    { name: "Tã Bobby dưới 400 nghìn", params: { q: "tã quần bobby", maxPrice: 400_000 }, baseline: true },
    { name: "Sữa tươi dưới 500 nghìn", params: { categorySlug: "sua", maxPrice: 500_000 }, baseline: false },
  ];
  for (const s of searches) {
    const found = await must(db.from("saved_searches").select("id").eq("user_id", userId).eq("name", s.name).maybeSingle(), "read saved search");
    if (found) continue;
    const row = await one(
      db.from("saved_searches").insert({ user_id: userId, name: s.name, params: s.params }).select("id").single(),
      "insert saved search",
    );
    const { data: prods } = await db.from("products").select("id").like("slug", "seed-p4-%");
    await must(
      db.rpc("record_saved_search_evaluation", {
        p_id: row.id,
        p_params_version: 1,
        p_now: new Date(now).toISOString(),
        p_hits: (s.baseline ? (prods ?? []) : []).map((p) => ({ product_id: p.id, in_set: true, alerted: false, price: null })) as never,
        p_event: null as never,
      }),
      "baseline saved search",
    );
  }

  // Demand follows: waiting and found.
  await must(
    db.from("demand_follows").upsert(
      [
        { user_id: userId, keyword: "máy hút sữa spectra s1", status: "waiting", expires_at: new Date(now + 30 * DAY).toISOString(), known_product_ids: [] },
        {
          user_id: userId, keyword: "tã quần bobby", status: "found", expires_at: new Date(now + 20 * DAY).toISOString(),
          found_at: new Date(now - 2 * DAY).toISOString(), known_product_ids: [],
        },
      ],
      { onConflict: "user_id,keyword", ignoreDuplicates: true },
    ),
    "demand follows",
  );

  // A shared folder with watches on the seeded variants.
  let folder = await must(db.from("watch_folders").select("id").eq("user_id", userId).eq("name", "Đồ cho bé").maybeSingle(), "read folder");
  if (!folder) folder = await one(db.from("watch_folders").insert({ user_id: userId, name: "Đồ cho bé" }).select("id").single(), "insert folder");
  for (const vid of variantIds.slice(0, 3)) {
    const w = await must(db.from("watches").select("id").eq("user_id", userId).eq("variant_id", vid).maybeSingle(), "read watch");
    if (w) continue;
    await must(
      db.from("watches").insert({ user_id: userId, variant_id: vid, target_price: 200_000, folder_id: folder.id, note: "Mua cho bé Na" }),
      "insert watch",
    );
  }
  let share = await must(db.from("watch_folder_shares").select("token").eq("folder_id", folder.id).maybeSingle(), "read share");
  if (!share) {
    share = await one(
      db
        .from("watch_folder_shares")
        .insert({ folder_id: folder.id, user_id: userId, token: randomBytes(32).toString("base64url"), title: "Đồ cho bé", display_name: "Mẹ Na", show_target: true })
        .select("token")
        .single(),
      "insert share",
    );
  }
  console.log(`  user ${USER_EMAIL} (password as seed-dev): 2 saved searches, 2 demand follows, shared folder`);
  console.log(`  shared folder (local only): http://localhost:3000/shared/${share.token}`);
}

async function main() {
  const { url, serviceKey } = requireStrictLocalSupabase("seed-roadmap-p4");
  const db = createClient<Database>(url, serviceKey, { auth: { persistSession: false } });
  const now = Date.now();
  console.log("Seeding roadmap P4 data (additive)…");
  const sellerIds: Record<string, string> = {};
  for (const s of SELLERS) sellerIds[s.ext] = await upsertSeller(db, s.ext, s.name);
  const { variantIds } = await seedCatalog(db, now, sellerIds);
  await seedVouchers(db, now, sellerIds);
  await seedUser(db, now, variantIds);
  // Force a fresh profile / season snapshot for the seeded sellers and categories.
  await db.from("seller_price_profiles").delete().in("seller_id", Object.values(sellerIds));
  const sellers = await recomputeSellerProfiles({ now: new Date(now), deadline: Date.now() + 5 * 60_000 }, db);
  const seasons = await recomputeCategorySeasons({ now: new Date(now), deadline: Date.now() + 5 * 60_000 }, db);
  console.log("  insights:", { sellers, seasons });
  for (const [ext, id] of Object.entries(sellerIds)) console.log(`  /seller/${id}  (${ext})`);
  console.log("Done.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

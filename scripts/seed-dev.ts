/**
 * Generate fake, cross-linked data in EVERY table so the whole app can be exercised locally
 * before the Shopee API and the real collector exist.
 *
 * Run: pnpm seed:dev
 *
 * What you get:
 *   - Catalog: categories → products (verified + draft) → variants → offers on Shopee, plus a few
 *     TikTok Shop / Lazada offers (cross-marketplace comparison) → 120 days of price_observations,
 *     sellers, listings, vouchers, affiliate_offers, match_candidates (pending / accepted / rejected),
 *     collector_runs (the last 7 days of observations point at them).
 *   - Derived: variant_current_price, variant_daily_prices, variant_deal_scores, backtest_runs
 *     (computed by the same code the cron jobs use, not hand-written).
 *   - Users (password login, see SEED_PASSWORD): notification_settings, push_subscriptions,
 *     watch_folders, watches, alert_events → alert_deliveries, click_events (from alerts and from the
 *     web) → conversions, analytics_events, lookup_requests, extension_observations /
 *     extension_contributions, job_locks.
 *
 * WARNING: wipes the catalog, every *@kairo.test account and the operational tables
 * (clicks, conversions, analytics, lookups, runs, locks). guard-env.ts refuses to run when
 * NEXT_PUBLIC_SUPABASE_URL does not point at a local Supabase.
 *
 * Wrapped in main(): tsx compiles .ts files to CJS, which forbids top-level await.
 */

import crypto from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../src/lib/database.types";
import { slugify } from "../src/lib/slug";
import { encodeSubId } from "../src/lib/affiliate/link";
import { recomputeDealScores } from "../src/lib/pricing/recompute-scores";
import { runBacktest } from "../src/lib/pricing/backtest-job";
import { CURRENT_CONSENT_VERSION } from "../src/lib/account/consent";
import { requireLocalSupabase } from "./guard-env";
import { sampleImageFor } from "./sample-images";

const { url, serviceKey } = requireLocalSupabase("seed-dev");
const db = createClient(url, serviceKey, { auth: { persistSession: false } });
const typedDb = db as unknown as SupabaseClient<Database>;

const DAYS = 120;
const PRODUCTS = 60;
const BATCH = 1000;
const ZERO_UUID = "00000000-0000-0000-0000-000000000000";
const DAY_MS = 86_400_000;

/** Local test accounts only — every seed user logs in with this password. */
const SEED_PASSWORD = "KairoTest2026";
const SEED_EMAIL_DOMAIN = "@kairo.test";

const CATEGORIES: Array<[string, string]> = [
  ["ssd", "Ổ cứng SSD"],
  ["ban-phim", "Bàn phím"],
  ["chuot", "Chuột"],
  ["man-hinh", "Màn hình"],
  ["tai-nghe", "Tai nghe"],
  ["ram", "RAM"],
  ["sac-du-phong", "Sạc dự phòng"],
  ["webcam", "Webcam"],
];

const BRANDS = ["Samsung", "WD", "Logitech", "Keychron", "Dell", "Sony", "Anker", "Kingston"];
const SUFFIX = ["Pro", "Plus", "Air", "Max", "Lite"];
const CAPACITY = ["512GB", "1TB", "2TB"];
const LOCATIONS = ["TP. Hồ Chí Minh", "Hà Nội", "Đà Nẵng", "Bình Dương", "Hải Phòng"];

interface SeedUserSpec {
  key: "demo" | "an" | "binh" | "xoa";
  email: string;
  /** Signup date — old enough for the D30 retention cohort where it matters. */
  signedUpDaysAgo: number;
  marketing: boolean;
  /** Set = account scheduled for deletion (grace period), exercises /account/restore. */
  deletedDaysAgo?: number;
}

const SEED_USERS: SeedUserSpec[] = [
  { key: "demo", email: `demo${SEED_EMAIL_DOMAIN}`, signedUpDaysAgo: 50, marketing: true },
  { key: "an", email: `an${SEED_EMAIL_DOMAIN}`, signedUpDaysAgo: 40, marketing: false },
  { key: "binh", email: `binh${SEED_EMAIL_DOMAIN}`, signedUpDaysAgo: 12, marketing: true },
  { key: "xoa", email: `xoa${SEED_EMAIL_DOMAIN}`, signedUpDaysAgo: 70, marketing: false, deletedDaysAgo: 5 },
];

/** PRNG with a fixed seed — every seed produces the same data, easy to compare across runs. */
function makeRng(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}
const rnd = makeRng(20260922);
const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(rnd() * xs.length)];
const randInt = (min: number, max: number) => min + Math.floor(rnd() * (max - min + 1));
const hex = (n: number) => Array.from({ length: n }, () => Math.floor(rnd() * 16).toString(16)).join("");
const b64url = (n: number) =>
  Buffer.from(Array.from({ length: n }, () => Math.floor(rnd() * 256))).toString("base64url");
const sha256 = (s: string) => crypto.createHash("sha256").update(s).digest("hex");

const now = new Date();
/** `d` days before now at `hour`:`minute` UTC, never in the future. */
function daysAgo(d: number, hour = 5, minute = 0): Date {
  const at = new Date(now.getTime() - d * DAY_MS);
  at.setUTCHours(hour, minute, 0, 0);
  return at.getTime() > now.getTime() ? new Date(now.getTime() - 60_000) : at;
}
const addMinutes = (at: Date, m: number) => new Date(at.getTime() + m * 60_000);

interface SeedOffer {
  id: string;
  listingId: string;
  marketplace: "shopee" | "tiktok" | "lazada";
  externalItemId: string;
  externalModelId: string;
  latestPrice: number;
}

interface SeedVariant {
  id: string;
  productId: string;
  categorySlug: string;
  isDraft: boolean;
  offers: SeedOffer[];
  /** Lowest non-flash price per day, keyed by days-ago — alert prices come from here. */
  dailyMin: Map<number, number>;
}

interface SeedUser extends SeedUserSpec {
  id: string;
  createdAt: Date;
}

interface CreatedWatch {
  id: string;
  user: SeedUser;
  variant: SeedVariant;
  channels: string[] | null;
  createdAt: Date;
}

async function insertBatched(table: string, rows: unknown[]) {
  for (let i = 0; i < rows.length; i += BATCH) {
    const { error } = await db.from(table).insert(rows.slice(i, i + BATCH));
    if (error) throw new Error(`insert ${table}: ${error.message}`);
  }
}

async function insertReturning<T>(table: string, rows: object[], columns = "*"): Promise<T[]> {
  const { data, error } = await db.from(table).insert(rows).select(columns);
  if (error) throw new Error(`insert ${table}: ${error.message}`);
  return data as T[];
}

async function insertOne<T>(table: string, row: object): Promise<T> {
  const { data, error } = await db.from(table).insert(row).select().single();
  if (error) throw new Error(`insert ${table}: ${error.message}`);
  return data as T;
}

// ============================================================================
// 0. Wipe
// ============================================================================

async function wipe() {
  console.log("Deleting seed accounts…");
  // Deleting an auth user cascades to users → watches → alert_events → alert_deliveries,
  // notification_settings, push_subscriptions, watch_folders, analytics_events.
  for (let page = 1; ; page++) {
    const { data, error } = await db.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw new Error(`list users: ${error.message}`);
    for (const u of data.users) {
      if (u.email?.endsWith(SEED_EMAIL_DOMAIN)) {
        const { error: delErr } = await db.auth.admin.deleteUser(u.id);
        if (delErr) throw new Error(`delete user ${u.email}: ${delErr.message}`);
      }
    }
    if (data.users.length < 200) break;
  }

  console.log("Deleting operational data…");
  const byUuid = ["conversions", "click_events", "collector_runs", "backtest_runs", "vouchers"];
  for (const t of byUuid) {
    const { error } = await db.from(t).delete().neq("id", ZERO_UUID);
    if (error) throw new Error(`delete ${t}: ${error.message}`);
  }
  for (const t of ["lookup_requests", "analytics_events", "extension_contributions"]) {
    const { error } = await db.from(t).delete().gte("id", 0);
    if (error) throw new Error(`delete ${t}: ${error.message}`);
  }
  const { error: lockErr } = await db.from("job_locks").delete().neq("name", "");
  if (lockErr) throw new Error(`delete job_locks: ${lockErr.message}`);

  console.log("Deleting old catalog…");
  // Deleting products cascades to variants → watches / variant_* caches; listings cascades to
  // offers → price_observations, match_candidates, affiliate_offers, extension_observations.
  for (const t of ["products", "categories", "listings", "sellers"]) {
    const { error } = await db.from(t).delete().neq("id", ZERO_UUID);
    if (error) throw new Error(`delete ${t}: ${error.message}`);
  }
}

// ============================================================================
// 1. Catalog + price history
// ============================================================================

async function seedCatalog() {
  console.log("Creating collector runs…");
  // One run per day for the last 7 days; observations of those days point at them.
  const runByDay = new Map<number, string>();
  for (let d = 6; d >= 0; d--) {
    const started = daysAgo(d, 4, 58);
    const failed = d === 3 ? 4 : 0;
    const run = await insertOne<{ id: string }>("collector_runs", {
      source: "seed",
      started_at: started.toISOString(),
      finished_at: addMinutes(started, 6).toISOString(),
      items_failed: failed,
      error_summary: failed ? "shopee: 429 Too Many Requests (4 listing)" : null,
    });
    runByDay.set(d, run.id);
  }
  const runItems = new Map<string, number>();

  console.log("Creating categories…");
  const cats = await insertReturning<{ id: string; slug: string; name: string }>(
    "categories",
    CATEGORIES.map(([slug, name], i) => ({ slug, name, sort_order: i })),
  );

  console.log("Creating sellers…");
  const sellers = await insertReturning<{ id: string; is_official: boolean }>(
    "sellers",
    Array.from({ length: 12 }, (_, i) => ({
      marketplace: "shopee",
      external_seller_id: `seed-shop-${i}`,
      name: `Shop Demo ${i + 1}`,
      rating: Number((4 + rnd()).toFixed(2)),
      rating_count: Math.floor(rnd() * 5000),
      is_official: i < 3,
      location: pick(LOCATIONS),
    })),
  );
  const otherSellers = await insertReturning<{ id: string; marketplace: string }>("sellers", [
    { marketplace: "tiktok", external_seller_id: "seed-tt-0", name: "TikTok Demo Store", rating: 4.7, rating_count: 820, is_official: false, location: "TP. Hồ Chí Minh" },
    { marketplace: "lazada", external_seller_id: "seed-lz-0", name: "LazMall Demo", rating: 4.8, rating_count: 1540, is_official: true, location: "Hà Nội" },
  ]);
  const tiktokSeller = otherSellers.find((s) => s.marketplace === "tiktok")!;
  const lazadaSeller = otherSellers.find((s) => s.marketplace === "lazada")!;

  const variants: SeedVariant[] = [];
  const candidates: Record<string, unknown>[] = [];
  const affiliate: Record<string, unknown>[] = [];
  let obsCount = 0;

  for (let p = 0; p < PRODUCTS; p++) {
    const brand = pick(BRANDS);
    const cat = pick(cats);
    const model = `${pick(SUFFIX)} ${100 + p}`;
    const name = `${cat.name} ${brand} ${model}`;
    // 10% stay draft, mimicking products created by the paste-URL flow (Đ6).
    const isDraft = p % 10 === 9;

    const prod = await insertOne<{ id: string }>("products", {
      canonical_name: name,
      brand,
      model,
      category_id: cat.id,
      slug: `${slugify(`${brand} ${model}`)}-${p}`,
      status: isDraft ? "draft" : "verified",
      image: sampleImageFor(cat.slug, p),
      gtin: isDraft ? null : `893${String(1000000000 + p * 7919).slice(0, 10)}`,
      specs: { brand, model },
    });

    // At most 3: CAPACITY has only 3 levels, more would create two variants with the same key
    // in one product.
    const nVariants = 2 + Math.floor(rnd() * 2);
    // Base price per PRODUCT, so 512GB < 1TB < 2TB inside a product (the price-range filter
    // relies on the cheapest variant being the product price).
    const productBasePrice = 500_000 + Math.floor(rnd() * 4_500_000);
    const CAPACITY_MULT = [1, 1.7, 2.9];

    for (let v = 0; v < nVariants; v++) {
      const variant = await insertOne<{ id: string }>("product_variants", {
        product_id: prod.id,
        variant_key: `dung-luong=${CAPACITY[v % 3]}`,
        specs: { dung_luong: CAPACITY[v % 3] },
      });
      const seedVariant: SeedVariant = {
        id: variant.id,
        productId: prod.id,
        categorySlug: cat.slug,
        isDraft,
        offers: [],
        dailyMin: new Map(),
      };

      const basePrice = Math.round(productBasePrice * CAPACITY_MULT[v % 3]);
      // Each variant gets its own trend: negative = falling price (buy), positive = rising
      // (avoid), around 0 = wait. All-falling data would never exercise the other branches.
      const driftPerDay = (rnd() - 0.5) * 0.0024;
      // A few variants dropped ~15% today → they show up on the Price Drop Radar.
      const radarDrop = !isDraft && v === 0 && p % 8 === 1;
      const nShopee = 1 + Math.floor(rnd() * 4);

      const specs: Array<{ marketplace: SeedOffer["marketplace"]; sellerId: string; extId: string; url: string }> = [];
      for (let o = 0; o < nShopee; o++) {
        const extId = `${1000 + p}_${2000 + v * 10 + o}`;
        specs.push({
          marketplace: "shopee",
          sellerId: pick(sellers).id,
          extId,
          url: `https://shopee.vn/product/${1000 + p}/${2000 + v * 10 + o}`,
        });
      }
      // A few verified products are also sold on TikTok Shop / Lazada → cross-marketplace comparison.
      if (!isDraft && v === 0 && p % 6 === 0) {
        const id = String(1729000000 + p);
        specs.push({ marketplace: "tiktok", sellerId: tiktokSeller.id, extId: id, url: `https://www.tiktok.com/view/product/${id}` });
      }
      if (!isDraft && v === 0 && p % 9 === 0) {
        const id = String(880000 + p);
        specs.push({ marketplace: "lazada", sellerId: lazadaSeller.id, extId: id, url: `https://www.lazada.vn/products/-i${id}.html` });
      }

      const observations: Record<string, unknown>[] = [];

      for (let o = 0; o < specs.length; o++) {
        const spec = specs[o];
        const listing = await insertOne<{ id: string }>("listings", {
          marketplace: spec.marketplace,
          external_item_id: spec.extId,
          seller_id: spec.sellerId,
          title: name,
          url: spec.url,
          status: "active",
          first_seen_at: daysAgo(DAYS).toISOString(),
          last_observed_at: daysAgo(0).toISOString(),
          refresh_priority: randInt(1, 3),
        });

        // One reviewed-then-accepted offer per few products → match_status 'manual'.
        const manual = !isDraft && o === 0 && p % 13 === 4;
        const externalModelId = String(v + 1);
        const offerRow = await insertOne<{ id: string }>("offers", {
          listing_id: listing.id,
          external_model_id: externalModelId,
          variant_id: variant.id,
          match_confidence: isDraft ? 0.4 : manual ? 0.9 : 0.98,
          match_status: isDraft ? "pending" : manual ? "manual" : "auto",
          free_shipping: rnd() < 0.5,
          has_voucher: rnd() < 0.35,
        });
        const offer: SeedOffer = {
          id: offerRow.id,
          listingId: listing.id,
          marketplace: spec.marketplace,
          externalItemId: spec.extId,
          externalModelId,
          latestPrice: 0,
        };
        seedVariant.offers.push(offer);

        if (manual) {
          candidates.push({
            offer_id: offer.id,
            suggested_variant_id: variant.id,
            confidence: 0.9,
            reason: "brand+model khớp, dung lượng khớp; tiêu đề thiếu mã model",
            decision: "accepted",
            reviewed_at: daysAgo(20).toISOString(),
          });
        }

        if (spec.marketplace === "shopee" && !isDraft) {
          const code = hex(8);
          affiliate.push({
            offer_id: offer.id,
            affiliate_url: `https://s.shopee.vn/an_redir?origin_link=${encodeURIComponent(spec.url)}&affiliate_id=seed`,
            short_link: `https://s.shopee.vn/${code}`,
            commission_rate: Number((0.03 + rnd() * 0.05).toFixed(4)),
            campaign: pick(["seed-default", "seed-tech-9-9", "seed-payday"]),
            eligible: rnd() > 0.1,
          });
        }

        // This offer's price deviates -4…+8% from the variant's base price.
        const offerBase = Math.round(basePrice * (0.96 + rnd() * 0.12));

        for (let d = DAYS - 1; d >= 0; d--) {
          // A few days with missing data — chart segment breaks and the 10-observation threshold.
          if (d % 17 === 3) continue;

          const at = daysAgo(d);
          const elapsed = DAYS - 1 - d; // 0 = oldest day, increasing to today
          const trend = 1 + driftPerDay * elapsed;
          const noise = 1 + (rnd() - 0.5) * 0.04;
          // Today is never a flash sale: flash prices are excluded from the rollup, so the current
          // price would always sit below the whole history and every variant would be "buy".
          const isFlash = d > 0 && d % 29 === 0;
          const drop = radarDrop && d === 0 ? 0.85 : 1;
          const price = Math.round(offerBase * trend * noise * drop * (isFlash ? 0.82 : 1));
          const stock = rnd() < 0.08 ? 0 : 10 + Math.floor(rnd() * 90);
          const originalPrice = rnd() < 0.5 ? Math.round(price * 1.35) : null;
          const runId = spec.marketplace === "shopee" ? runByDay.get(d) ?? null : null;
          if (runId) runItems.set(runId, (runItems.get(runId) ?? 0) + 1);

          observations.push({
            offer_id: offer.id,
            observed_at: at.toISOString(),
            price,
            original_price: originalPrice,
            stock,
            is_flash_sale: isFlash,
            is_valid: true,
            // Synthetic data, not real prices — must never mix with 'api'.
            source: "seed",
            collector_run_id: runId,
          });

          // Now and then the page had no price → invalid observation (ignored everywhere).
          if (rnd() < 0.01) {
            observations.push({
              offer_id: offer.id,
              observed_at: addMinutes(at, 30).toISOString(),
              price: null,
              stock,
              is_valid: false,
              invalid_reason: "no_price",
              is_flash_sale: false,
              source: "seed",
              collector_run_id: runId,
            });
          }

          if (!isFlash && stock > 0) {
            const prev = seedVariant.dailyMin.get(d);
            if (prev === undefined || price < prev) seedVariant.dailyMin.set(d, price);
          }
          if (d === 0) offer.latestPrice = price;
        }
      }

      await insertBatched("price_observations", observations);
      obsCount += observations.length;
      variants.push(seedVariant);
    }

    if ((p + 1) % 10 === 0) console.log(`  …${p + 1}/${PRODUCTS} products`);
  }

  // Close the collector runs with the number of observations they wrote.
  for (const [runId, n] of runItems) {
    const { error } = await db.from("collector_runs").update({ items_ok: n }).eq("id", runId);
    if (error) throw new Error(`update collector_runs: ${error.message}`);
  }

  console.log("Creating match candidates…");
  const verified = variants.filter((v) => !v.isDraft);
  for (const v of variants.filter((x) => x.isDraft)) {
    // Draft offers: the matcher found a similar verified variant but not confidently enough.
    const target = verified.find((x) => x.categorySlug === v.categorySlug);
    if (!target) continue;
    for (const o of v.offers) {
      candidates.push({
        offer_id: o.id,
        suggested_variant_id: target.id,
        confidence: Number((0.55 + rnd() * 0.35).toFixed(4)),
        reason: "brand khớp, model gần giống, thiếu dung lượng trong tiêu đề",
        decision: "pending",
      });
    }
  }
  // A rejected suggestion: the matcher proposed the wrong capacity.
  for (const v of verified.filter((_, i) => i % 23 === 7)) {
    const sibling = verified.find((x) => x.productId === v.productId && x.id !== v.id);
    if (!sibling) continue;
    candidates.push({
      offer_id: v.offers[0].id,
      suggested_variant_id: sibling.id,
      confidence: 0.61,
      reason: "brand+model khớp, dung lượng khác",
      decision: "rejected",
      reviewed_at: daysAgo(10).toISOString(),
    });
  }
  // Unmatched offers: a new model appeared on an existing listing (variant_id still null).
  const unmatchedObs: Record<string, unknown>[] = [];
  for (const v of verified.filter((_, i) => i % 19 === 2)) {
    const base = v.offers[0];
    const orphan = await insertOne<{ id: string }>("offers", {
      listing_id: base.listingId,
      external_model_id: "99",
      variant_id: null,
      match_status: "pending",
    });
    candidates.push({
      offer_id: orphan.id,
      suggested_variant_id: v.id,
      confidence: 0.72,
      reason: "cùng listing, tên phân loại gần giống",
      decision: "pending",
    });
    for (let d = 2; d >= 0; d--) {
      unmatchedObs.push({
        offer_id: orphan.id,
        observed_at: daysAgo(d, 5, 1).toISOString(),
        price: Math.round(base.latestPrice * 1.1),
        stock: 20,
        source: "seed",
      });
    }
  }
  await insertBatched("match_candidates", candidates);
  await insertBatched("price_observations", unmatchedObs);
  await insertBatched("affiliate_offers", affiliate);

  console.log("Computing current prices + daily rollup…");
  for (let i = 0; i < variants.length; i += 100) {
    const { error } = await db.rpc("refresh_variant_current_price", {
      p_variant_ids: variants.slice(i, i + 100).map((v) => v.id),
    });
    if (error) throw new Error(`refresh_variant_current_price: ${error.message}`);
  }
  const { error: rollupErr } = await db.rpc("refresh_variant_daily_prices", {
    p_from: new Date(now.getTime() - DAYS * DAY_MS).toISOString().slice(0, 10),
    p_to: now.toISOString().slice(0, 10),
  });
  if (rollupErr) throw rollupErr;

  console.log(`  ${PRODUCTS} products, ${variants.length} variants, ${obsCount} observations.`);
  return { variants, sellers };
}

// ============================================================================
// 2. Vouchers
// ============================================================================

async function seedVouchers(sellers: Array<{ id: string; is_official: boolean }>) {
  console.log("Creating vouchers…");
  const in30 = new Date(now.getTime() + 30 * DAY_MS).toISOString();
  const rows: Record<string, unknown>[] = [
    { kind: "platform", code: "KAIROSALE", discount_type: "percent", discount_value: 10, max_discount: 100_000, min_spend: 500_000, expires_at: in30 },
    { kind: "shipping", code: null, discount_type: "amount", discount_value: 30_000, min_spend: 0, expires_at: in30 },
    { kind: "payment", code: "PAYDAY50", discount_type: "amount", discount_value: 50_000, min_spend: 1_000_000, expires_at: in30 },
    // Expired — must not show.
    { kind: "platform", code: "HETHAN99", discount_type: "percent", discount_value: 15, max_discount: 200_000, min_spend: 300_000, expires_at: daysAgo(3).toISOString() },
  ];
  sellers.forEach((s, i) => {
    if (!s.is_official && i % 3 !== 0) return;
    rows.push({
      kind: "shop",
      seller_id: s.id,
      code: `SHOP${i}GIAM`,
      discount_type: i % 2 ? "amount" : "percent",
      discount_value: i % 2 ? 20_000 + i * 5_000 : 5 + i,
      max_discount: i % 2 ? null : 150_000,
      min_spend: 200_000,
      expires_at: in30,
    });
  });
  // Listing-level vouchers for the listings whose offer advertises one (offers.has_voucher).
  const { data: withVoucher, error } = await db.from("offers").select("listing_id").eq("has_voucher", true);
  if (error) throw error;
  const listingIds = [...new Set((withVoucher ?? []).map((o) => o.listing_id as string))];
  const listings: Array<{ id: string; seller_id: string; marketplace: string }> = [];
  for (let i = 0; i < listingIds.length; i += 200) {
    const { data, error: lErr } = await db
      .from("listings")
      .select("id, seller_id, marketplace")
      .in("id", listingIds.slice(i, i + 200));
    if (lErr) throw lErr;
    listings.push(...(data ?? []));
  }
  listings.forEach((l, i) => {
    rows.push({
      marketplace: l.marketplace,
      kind: "shop",
      seller_id: l.seller_id,
      listing_id: l.id,
      code: i % 4 === 0 ? null : `SP${String(i).padStart(3, "0")}`,
      discount_type: "amount",
      discount_value: 10_000 + (i % 5) * 10_000,
      min_spend: 0,
      expires_at: in30,
    });
  });
  await insertBatched(
    "vouchers",
    rows.map((r) => ({ marketplace: "shopee", source: "seed", starts_at: daysAgo(7).toISOString(), ...r })),
  );
  console.log(`  ${rows.length} vouchers.`);
}

// ============================================================================
// 3. Users + everything that hangs off them
// ============================================================================

async function seedUsers(): Promise<Record<SeedUserSpec["key"], SeedUser>> {
  console.log("Creating users…");
  const out = {} as Record<SeedUserSpec["key"], SeedUser>;
  for (const spec of SEED_USERS) {
    const { data, error } = await db.auth.admin.createUser({
      email: spec.email,
      password: SEED_PASSWORD,
      email_confirm: true,
    });
    if (error || !data.user) throw new Error(`create user ${spec.email}: ${error?.message}`);
    const createdAt = daysAgo(spec.signedUpDaysAgo, 2, 30);

    // The on_auth_user_created trigger made users + notification_settings; fill in the profile.
    const { error: upErr } = await db
      .from("users")
      .update({
        created_at: createdAt.toISOString(),
        marketing_opt_in: spec.marketing,
        consent_version: CURRENT_CONSENT_VERSION,
        consent_at: createdAt.toISOString(),
        deleted_at: spec.deletedDaysAgo ? daysAgo(spec.deletedDaysAgo).toISOString() : null,
      })
      .eq("id", data.user.id);
    if (upErr) throw new Error(`update users: ${upErr.message}`);
    out[spec.key] = { ...spec, id: data.user.id, createdAt };
  }

  const settings: Array<[SeedUserSpec["key"], Record<string, unknown>]> = [
    ["demo", { push_enabled: true, frequency: "instant", quiet_start: 22, quiet_end: 7 }],
    ["an", { push_enabled: false, frequency: "daily_digest", digest_hour: 20 }],
    ["binh", { push_enabled: true, frequency: "weekly_digest", digest_hour: 9, digest_weekday: 7 }],
    ["xoa", { email_enabled: false }],
  ];
  for (const [key, patch] of settings) {
    const { error } = await db.from("notification_settings").update(patch).eq("user_id", out[key].id);
    if (error) throw new Error(`update notification_settings: ${error.message}`);
  }

  await insertBatched("push_subscriptions", [
    {
      user_id: out.demo.id,
      endpoint: `https://fcm.googleapis.com/fcm/send/seed-demo-${hex(16)}`,
      p256dh: b64url(65),
      auth: b64url(16),
      user_agent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/140",
      failure_count: 0,
      last_success_at: daysAgo(1).toISOString(),
    },
    {
      user_id: out.binh.id,
      endpoint: `https://updates.push.services.mozilla.com/wpush/v2/seed-binh-${hex(16)}`,
      p256dh: b64url(65),
      auth: b64url(16),
      user_agent: "Mozilla/5.0 (Android 14; Mobile) Firefox/131",
      failure_count: 2,
    },
  ]);
  return out;
}

async function seedWatchesAndAlerts(users: Record<SeedUserSpec["key"], SeedUser>, variants: SeedVariant[]) {
  console.log("Creating folders, watches, alerts…");
  const folders = await insertReturning<{ id: string; user_id: string; name: string }>("watch_folders", [
    { user_id: users.demo.id, name: "Build PC", sort_order: 0 },
    { user_id: users.demo.id, name: "Quà Tết", sort_order: 1 },
    { user_id: users.an.id, name: "Gaming", sort_order: 0 },
  ]);
  const folder = (userId: string, name: string) => folders.find((f) => f.user_id === userId && f.name === name)!.id;

  const { data: vcpRows, error: vcpErr } = await db
    .from("variant_current_price")
    .select("variant_id, best_offer_id, price, in_stock");
  if (vcpErr) throw vcpErr;
  const vcp = new Map((vcpRows ?? []).map((r) => [r.variant_id as string, r]));

  const inStock = variants.filter((v) => !v.isDraft && vcp.get(v.id)?.in_stock);
  const outOfStock = variants.filter((v) => !v.isDraft && vcp.get(v.id) && !vcp.get(v.id)!.in_stock);
  let cursor = 0;
  const nextVariant = () => inStock[(cursor++ * 7) % inStock.length];
  const priceOf = (v: SeedVariant) => Number(vcp.get(v.id)!.price);

  type Plan = {
    user: SeedUser;
    variant: SeedVariant;
    cond: Record<string, unknown>;
    channels: string[] | null;
    folderId?: string;
    note?: string;
    finalStatus: "active" | "paused" | "done";
    createdDaysAgo: number;
    /** Alerts fired, as days-ago; must be < createdDaysAgo. */
    alerts: number[];
  };

  const plans: Plan[] = [];
  // Watched by three users → appears in trending_products("watched") (needs ≥ 2 active watches).
  const popular = inStock[3];
  const add = (p: Omit<Plan, "variant"> & { variant?: SeedVariant }) =>
    plans.push({ ...p, variant: p.variant ?? nextVariant() });

  // demo — covers every condition type, folders, statuses and channels.
  {
    const v0 = nextVariant();
    add({ user: users.demo, variant: v0, cond: { target_price: Math.round(priceOf(v0) * 0.93 / 1000) * 1000 }, channels: ["email", "push"], folderId: folder(users.demo.id, "Build PC"), note: "Chờ dưới 2 triệu", finalStatus: "active", createdDaysAgo: 30, alerts: [] });
  }
  add({ user: users.demo, variant: popular, cond: { drop_pct: 10, notify_low: true }, channels: null, folderId: folder(users.demo.id, "Build PC"), finalStatus: "active", createdDaysAgo: 28, alerts: [21, 6] });
  add({ user: users.demo, cond: { min_deal_score: 75 }, channels: ["push"], finalStatus: "active", createdDaysAgo: 25, alerts: [14, 1] });
  if (outOfStock.length) {
    add({ user: users.demo, variant: outOfStock[0], cond: { notify_back_in_stock: true }, channels: ["email"], finalStatus: "active", createdDaysAgo: 9, alerts: [] });
  }
  {
    const v = nextVariant();
    // Target already above the current price → an alert fired today, not yet delivered.
    add({ user: users.demo, variant: v, cond: { target_price: Math.round(priceOf(v) * 1.05 / 1000) * 1000 }, channels: ["email", "push"], folderId: folder(users.demo.id, "Quà Tết"), finalStatus: "active", createdDaysAgo: 4, alerts: [0] });
  }
  add({ user: users.demo, cond: { drop_pct: 15 }, channels: null, finalStatus: "paused", createdDaysAgo: 35, alerts: [] });
  add({ user: users.demo, cond: { notify_low: true, min_deal_score: 80 }, channels: ["email"], folderId: folder(users.demo.id, "Quà Tết"), note: "Đã mua", finalStatus: "done", createdDaysAgo: 45, alerts: [33] });
  // an — digest user.
  add({ user: users.an, variant: popular, cond: { drop_pct: 5 }, channels: null, folderId: folder(users.an.id, "Gaming"), finalStatus: "active", createdDaysAgo: 38, alerts: [30, 18, 3] });
  add({ user: users.an, cond: { notify_low: true }, channels: null, folderId: folder(users.an.id, "Gaming"), finalStatus: "active", createdDaysAgo: 20, alerts: [8] });
  add({ user: users.an, cond: { min_deal_score: 70 }, channels: ["email"], finalStatus: "active", createdDaysAgo: 15, alerts: [] });
  // binh — push user whose device is failing.
  add({ user: users.binh, variant: popular, cond: { drop_pct: 8 }, channels: ["push"], finalStatus: "active", createdDaysAgo: 10, alerts: [2] });
  add({ user: users.binh, cond: { min_deal_score: 85 }, channels: ["email", "push"], finalStatus: "active", createdDaysAgo: 6, alerts: [] });
  // xoa — account pending deletion still owns a watch.
  add({ user: users.xoa, cond: { drop_pct: 20 }, channels: null, finalStatus: "active", createdDaysAgo: 60, alerts: [] });

  const channelDefaults: Record<string, string[]> = {
    demo: ["email", "push"],
    an: ["email"],
    binh: ["email", "push"],
    xoa: ["email"],
  };

  const watches: CreatedWatch[] = [];
  const alertEvents: Array<{ id: string; watch: CreatedWatch; at: Date; channels: string[] }> = [];

  for (const plan of plans) {
    // Every watch is inserted active so record_watch_evaluation accepts its history, then set
    // to its final status.
    const w = await insertOne<{ id: string }>("watches", {
      user_id: plan.user.id,
      variant_id: plan.variant.id,
      channels: plan.channels,
      folder_id: plan.folderId ?? null,
      note: plan.note ?? null,
      status: "active",
      ...plan.cond,
    });
    const createdAt = daysAgo(plan.createdDaysAgo, 13, 15);
    const { error: cErr } = await db.from("watches").update({ created_at: createdAt.toISOString() }).eq("id", w.id);
    if (cErr) throw new Error(`update watches: ${cErr.message}`);
    const watch: CreatedWatch = { id: w.id, user: plan.user, variant: plan.variant, channels: plan.channels, createdAt };
    watches.push(watch);

    const bestOffer = vcp.get(plan.variant.id)!.best_offer_id as string;
    const baseline = plan.variant.dailyMin.get(plan.createdDaysAgo) ?? priceOf(plan.variant);
    let previous: number | null = null;
    const channels = plan.channels ?? channelDefaults[plan.user.key];

    for (const d of [...plan.alerts].sort((a, b) => b - a)) {
      const at = daysAgo(d, 6, 15);
      const price = d === 0 ? priceOf(plan.variant) : plan.variant.dailyMin.get(d) ?? priceOf(plan.variant);
      const triggers = Object.keys(plan.cond)
        .map((k) => ({ target_price: "target_price", drop_pct: "drop_pct", notify_low: "low", min_deal_score: "deal_score", notify_back_in_stock: "back_in_stock" })[k]!)
        .slice(0, 2);
      if (previous !== null) triggers.push("deeper_drop");
      const score = randInt(72, 94);
      const { data: eventId, error } = await db.rpc("record_watch_evaluation", {
        p_watch_id: w.id,
        p_config_version: 1,
        p_now: at.toISOString(),
        p_state: { cond_state: {}, last_in_stock: true, alerted: { price, at: at.toISOString() } },
        p_event: {
          trigger_types: [...new Set(triggers)],
          price,
          offer_id: bestOffer,
          baseline_price: baseline,
          previous_alert_price: previous,
          deal_score: score,
          recommendation: "buy",
          score_reasons: [
            `Rẻ hơn ${randInt(70, 95)}% số ngày trong 90 ngày qua`,
            "Gần mức thấp nhất từng ghi nhận",
          ],
          deliver_after: at.toISOString(),
          channels,
        },
      });
      if (error || !eventId) throw new Error(`record_watch_evaluation: ${error?.message}`);
      alertEvents.push({ id: eventId as string, watch, at, channels });
      previous = price;
    }

    // Latest evaluation: now, no new event.
    const { error: evalErr } = await db.rpc("record_watch_evaluation", {
      p_watch_id: w.id,
      p_config_version: 1,
      p_now: now.toISOString(),
      p_state: { cond_state: {}, last_in_stock: vcp.get(plan.variant.id)!.in_stock },
      p_event: null,
    });
    if (evalErr) throw new Error(`record_watch_evaluation: ${evalErr.message}`);

    if (plan.finalStatus !== "active") {
      const { error } = await db.from("watches").update({ status: plan.finalStatus }).eq("id", w.id);
      if (error) throw new Error(`update watches: ${error.message}`);
    }
  }

  // Deliveries: record_watch_evaluation left them 'pending'. Older ones went out; binh's push
  // device keeps failing; today's alert stays pending for the dispatcher to pick up.
  for (const e of alertEvents) {
    const ageDays = (now.getTime() - e.at.getTime()) / DAY_MS;
    for (const channel of e.channels) {
      let patch: Record<string, unknown>;
      if (ageDays < 0.5) continue;
      if (e.watch.user.key === "binh" && channel === "push") {
        patch = { status: "failed", attempts: 3, last_error: "WebPush 410 Gone", claimed_at: addMinutes(e.at, 30).toISOString() };
      } else if (e.watch.user.key === "an" && channel === "push") {
        patch = { status: "skipped", skip_reason: "no_device" };
      } else {
        const sentAt = addMinutes(e.at, 2);
        patch = {
          status: "sent",
          attempts: 1,
          claimed_at: e.at.toISOString(),
          sent_at: sentAt.toISOString(),
          provider_message_id: `seed-${channel}-${hex(12)}`,
        };
      }
      const { error } = await db
        .from("alert_deliveries")
        .update(patch)
        .eq("alert_event_id", e.id)
        .eq("channel", channel);
      if (error) throw new Error(`update alert_deliveries: ${error.message}`);
    }
  }

  console.log(`  ${folders.length} folders, ${watches.length} watches, ${alertEvents.length} alerts.`);
  return { watches, alertEvents, vcp };
}

async function seedClicksAndConversions(
  users: Record<SeedUserSpec["key"], SeedUser>,
  variants: SeedVariant[],
  alertEvents: Array<{ id: string; watch: CreatedWatch; at: Date; channels: string[] }>,
  vcp: Map<string, { best_offer_id: unknown }>,
) {
  console.log("Creating clicks + conversions…");
  const offerById = new Map(variants.flatMap((v) => v.offers.map((o) => [o.id, o] as const)));
  const clicks: Record<string, unknown>[] = [];

  // Clicks from alerts (most sent alerts get opened).
  alertEvents.forEach((e, i) => {
    if (i % 3 === 2 || now.getTime() - e.at.getTime() < DAY_MS / 2) return;
    const channel = e.channels.includes("email") ? "email" : "push";
    clicks.push({
      id: crypto.randomUUID(),
      user_id: e.watch.user.id,
      offer_id: vcp.get(e.watch.variant.id)!.best_offer_id,
      source: channel,
      watch_id: e.watch.id,
      alert_event_id: e.id,
      session_id: `seed-${hex(10)}`,
      created_at: addMinutes(e.at, 25).toISOString(),
    });
  });
  // Buy clicks from the product page and the extension, signed-in or anonymous.
  const shopeeOffers = variants.filter((v) => !v.isDraft).flatMap((v) => v.offers.filter((o) => o.marketplace === "shopee"));
  const clickUsers = [users.demo, users.an, users.binh, null, null];
  for (let i = 0; i < 70; i++) {
    const u = pick(clickUsers);
    clicks.push({
      id: crypto.randomUUID(),
      user_id: u?.id ?? null,
      offer_id: pick(shopeeOffers).id,
      source: i % 9 === 0 ? "extension" : "web",
      session_id: `seed-${hex(10)}`,
      created_at: daysAgo(randInt(0, 30), randInt(1, 15), randInt(0, 59)).toISOString(),
    });
  }
  await insertBatched("click_events", clicks);

  const conversions: Record<string, unknown>[] = [];
  clicks.forEach((c, i) => {
    if (i % 3 !== 0) return;
    const offer = offerById.get(c.offer_id as string);
    if (!offer) return;
    const purchase = addMinutes(new Date(c.created_at as string), 40);
    const ageDays = (now.getTime() - purchase.getTime()) / DAY_MS;
    const status = ageDays < 7 ? "pending" : i % 5 === 0 ? "cancelled" : "completed";
    const quantity = i % 4 === 0 ? 2 : 1;
    const orderValue = offer.latestPrice * quantity;
    conversions.push({
      marketplace: "shopee",
      order_id: `SEED${String(240000 + i)}`,
      item_id: offer.externalItemId.split("_")[1] ?? offer.externalItemId,
      model_id: offer.externalModelId,
      click_event_id: c.id,
      sub_ids: [encodeSubId(c.id as string, c.source as "web" | "email" | "push" | "extension")],
      source_channel: c.source,
      purchase_time: purchase.toISOString(),
      complete_time: status === "completed" ? new Date(purchase.getTime() + 7 * DAY_MS).toISOString() : null,
      status,
      raw_status: status.toUpperCase(),
      item_price: offer.latestPrice,
      quantity,
      order_value: orderValue,
      commission: Math.round(orderValue * 0.05),
      import_source: i % 2 ? "csv" : "api",
      raw: { seed: true },
    });
  });
  // Orders that could not be tied to a click (sub_id lost) — lowers the match rate.
  for (let i = 0; i < 3; i++) {
    const offer = pick(shopeeOffers);
    const purchase = daysAgo(randInt(8, 25), 12);
    conversions.push({
      marketplace: "shopee",
      order_id: `SEED${String(250000 + i)}`,
      item_id: offer.externalItemId.split("_")[1] ?? offer.externalItemId,
      model_id: offer.externalModelId,
      sub_ids: [],
      source_channel: "unknown",
      purchase_time: purchase.toISOString(),
      complete_time: new Date(purchase.getTime() + 7 * DAY_MS).toISOString(),
      status: "completed",
      raw_status: "COMPLETED",
      item_price: offer.latestPrice,
      quantity: 1,
      order_value: offer.latestPrice,
      commission: Math.round(offer.latestPrice * 0.04),
      import_source: "csv",
      raw: { seed: true },
    });
  }
  await insertBatched("conversions", conversions);
  console.log(`  ${clicks.length} clicks, ${conversions.length} conversions.`);
}

async function seedAnalyticsAndLookups(
  users: Record<SeedUserSpec["key"], SeedUser>,
  variants: SeedVariant[],
  watches: CreatedWatch[],
) {
  console.log("Creating analytics events + lookups…");
  const events: Record<string, unknown>[] = [];
  const ev = (name: string, at: Date, user: SeedUser | null, props: Record<string, unknown> = {}) =>
    events.push({
      name,
      user_id: user?.id ?? null,
      session_id: `seed-${hex(10)}`,
      props,
      created_at: at.toISOString(),
    });

  for (const u of Object.values(users)) {
    ev("signup_completed", u.createdAt, u);
  }
  // Logins: demo every few days (retained at D30), an once in its D30 window, xoa never came back.
  for (let d = users.demo.signedUpDaysAgo - 1; d >= 0; d -= 3) ev("login_succeeded", daysAgo(d, 1, 10), users.demo);
  ev("login_succeeded", daysAgo(users.an.signedUpDaysAgo - 32, 12), users.an);
  ev("login_succeeded", daysAgo(1, 12), users.an);
  ev("login_succeeded", daysAgo(0, 2), users.binh);

  // Product views: a few "hot" products this week drive trending_products (views_7d vs prev_7d).
  const verified = variants.filter((v) => !v.isDraft);
  const hot = verified.slice(0, 5);
  const viewers = [users.demo, users.an, users.binh, null, null, null];
  for (let i = 0; i < 220; i++) {
    const recent = i % 3 !== 0;
    const v = recent && i % 2 === 0 ? pick(hot) : pick(verified);
    ev("product_viewed", daysAgo(randInt(recent ? 0 : 7, recent ? 6 : 13), randInt(0, 15), randInt(0, 59)), pick(viewers), {
      product_id: v.productId,
      variant_id: v.id,
      recommendation: pick(["buy", "wait", "avoid"]),
      is_draft: false,
    });
  }
  for (let i = 0; i < 60; i++) {
    ev("search_performed", daysAgo(randInt(0, 20), randInt(0, 15)), pick(viewers), {
      has_query: i % 4 !== 0,
      has_filters: i % 3 === 0,
      result_count: randInt(0, 48),
      page: i % 7 === 0 ? 2 : 1,
      sort: pick(["relevance", "deal_score", "price_asc", "price_desc", "updated"]),
    });
  }
  for (const w of watches) {
    ev("watch_created", w.createdAt, w.user, { variant_id: w.variant.id, condition_count: 1 });
  }
  ev("watch_deleted", daysAgo(11, 9), users.demo);
  ev("push_enabled", daysAgo(users.demo.signedUpDaysAgo - 1, 3), users.demo);
  ev("push_enabled", daysAgo(users.binh.signedUpDaysAgo - 1, 3), users.binh);
  for (let i = 0; i < 6; i++) {
    const v = pick(hot);
    ev("deal_shared", daysAgo(randInt(0, 6), 10), users.demo, { product_id: v.productId, method: i % 2 ? "copy" : "native" });
    ev("share_opened", daysAgo(randInt(0, 6), 11), null, { product_id: v.productId });
  }

  // Paste-link lookups (rate limit table) + the matching analytics event.
  const lookups: Record<string, unknown>[] = [];
  const outcomes = ["resolved", "resolved", "resolved", "ingested", "rejected", "error"] as const;
  for (let i = 0; i < 40; i++) {
    const u = pick([users.demo, users.an, null, null]);
    const outcome = pick(outcomes);
    const at = daysAgo(randInt(0, 14), randInt(0, 15), randInt(0, 59));
    lookups.push({
      ip_hash: sha256(`seed-ip-${i % 9}`),
      user_id: u?.id ?? null,
      outcome,
      is_ingest: outcome === "ingested",
      created_at: at.toISOString(),
    });
    ev("lookup_submitted", at, u, { outcome });
  }

  await insertBatched("analytics_events", events);
  await insertBatched("lookup_requests", lookups);
  console.log(`  ${events.length} analytics events, ${lookups.length} lookups.`);
}

async function seedExtension(users: Record<SeedUserSpec["key"], SeedUser>, variants: SeedVariant[]) {
  console.log("Creating extension contributions…");
  const contributors = [`u:${users.demo.id}`, `u:${users.an.id}`, `ip:${sha256("seed-ext-ip").slice(0, 32)}`];
  const observations: Record<string, unknown>[] = [];
  const contributions: Record<string, unknown>[] = [];
  const promoted: Record<string, unknown>[] = [];
  const offers = variants.filter((v) => !v.isDraft).flatMap((v) => v.offers.filter((o) => o.marketplace === "shopee")).filter((_, i) => i % 9 === 0);

  offers.forEach((o, i) => {
    const at = daysAgo(0, 3, 10 + i);
    // Every other offer: two contributors saw the same price → corroborated and promoted into
    // price_observations with source 'extension'. The rest wait for a second witness.
    const corroborated = i % 2 === 0;
    const who = corroborated ? contributors.slice(0, 2) : [pick(contributors)];
    who.forEach((c, k) => {
      const seenAt = addMinutes(at, k * 7);
      observations.push({
        offer_id: o.id,
        contributor: c,
        observed_at: seenAt.toISOString(),
        price: o.latestPrice,
        stock: 30,
        free_shipping: true,
        has_voucher: false,
        promoted_at: corroborated ? addMinutes(at, 8).toISOString() : null,
        created_at: seenAt.toISOString(),
      });
      contributions.push({ contributor: c, created_at: seenAt.toISOString() });
    });
    if (corroborated) {
      promoted.push({
        offer_id: o.id,
        observed_at: addMinutes(at, 7).toISOString(),
        price: o.latestPrice,
        stock: 30,
        source: "extension",
      });
    }
  });
  await insertBatched("extension_observations", observations);
  await insertBatched("extension_contributions", contributions);
  await insertBatched("price_observations", promoted);
  console.log(`  ${observations.length} extension observations (${promoted.length} promoted).`);
}

async function seedJobLocks() {
  await insertBatched(
    "job_locks",
    ["alerts", "collector", "conversions", "backtest"].map((name) => ({
      name,
      owner: "seed",
      locked_until: "-infinity",
    })),
  );
}

// ============================================================================
// main
// ============================================================================

async function main() {
  console.log(`Seeding ${url}`);
  await wipe();

  const { variants, sellers } = await seedCatalog();
  await seedVouchers(sellers);

  // The promoted extension prices joined the history → refresh derived tables once more below.
  const users = await seedUsers();
  await seedExtension(users, variants);
  for (let i = 0; i < variants.length; i += 100) {
    const { error } = await db.rpc("refresh_variant_current_price", {
      p_variant_ids: variants.slice(i, i + 100).map((v) => v.id),
    });
    if (error) throw new Error(`refresh_variant_current_price: ${error.message}`);
  }
  const today = now.toISOString().slice(0, 10);
  const { error: rollupErr } = await db.rpc("refresh_variant_daily_prices", { p_from: today, p_to: today });
  if (rollupErr) throw rollupErr;

  console.log("Computing Deal Scores…");
  const { scored, tally } = await recomputeDealScores(typedDb);
  console.log(`  ${scored} variants: ${JSON.stringify(tally)}`);

  console.log("Running backtests…");
  for (const version of ["v0", "v1"] as const) {
    await runBacktest(typedDb, { version, now: new Date(now.getTime() - 7 * DAY_MS) });
    await runBacktest(typedDb, { version });
  }

  const { watches, alertEvents, vcp } = await seedWatchesAndAlerts(users, variants);
  await seedClicksAndConversions(users, variants, alertEvents, vcp);
  await seedAnalyticsAndLookups(users, variants, watches);
  await seedJobLocks();

  console.log("\nDone. Test accounts (password = SEED_PASSWORD in scripts/seed-dev.ts):");
  for (const u of SEED_USERS) {
    console.log(`  ${u.email.padEnd(18)} ${u.deletedDaysAgo ? "(pending deletion → /account/restore)" : ""}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

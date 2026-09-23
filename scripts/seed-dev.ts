/**
 * Generate fake data to build and verify 1.1/1.2 before the Shopee API
 * and the real collector exist (Phase 0).
 *
 * Run: pnpm seed:dev
 *
 * WARNING: wipes the existing catalog. guard-env.ts refuses to run when
 * NEXT_PUBLIC_SUPABASE_URL does not point at a local Supabase.
 */

import { createClient } from "@supabase/supabase-js";
import { slugify } from "../src/lib/slug";
import { requireLocalSupabase } from "./guard-env";

const { url, serviceKey } = requireLocalSupabase("seed-dev");
const db = createClient(url, serviceKey, { auth: { persistSession: false } });

const DAYS = 120;
const PRODUCTS = 60;
const BATCH = 1000;
const ZERO_UUID = "00000000-0000-0000-0000-000000000000";

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

interface LatestObservation {
  offer_id: string;
  price: number;
  original_price: number | null;
  stock: number;
  is_flash_sale: boolean;
  observed_at: string;
}

async function insertBatched(table: string, rows: unknown[]) {
  for (let i = 0; i < rows.length; i += BATCH) {
    const { error } = await db.from(table).insert(rows.slice(i, i + BATCH));
    if (error) throw new Error(`insert ${table}: ${error.message}`);
  }
}

async function main() {
  console.log(`Seeding ${url}`);

  console.log("Deleting old catalog…");
  // Deleting products cascades to variants -> offers -> price_observations.
  for (const t of ["products", "categories", "listings", "sellers"]) {
    const { error } = await db.from(t).delete().neq("id", ZERO_UUID);
    if (error) throw new Error(`delete ${t}: ${error.message}`);
  }

  console.log("Creating categories…");
  const { data: cats, error: catErr } = await db
    .from("categories")
    .insert(CATEGORIES.map(([slug, name], i) => ({ slug, name, sort_order: i })))
    .select();
  if (catErr) throw catErr;

  console.log("Creating sellers…");
  const { data: sellers, error: sellerErr } = await db
    .from("sellers")
    .insert(
      Array.from({ length: 12 }, (_, i) => ({
        marketplace: "shopee",
        external_seller_id: `seed-shop-${i}`,
        name: `Shop Demo ${i + 1}`,
        rating: Number((4 + rnd()).toFixed(2)),
        rating_count: Math.floor(rnd() * 5000),
        is_official: i < 3,
      })),
    )
    .select();
  if (sellerErr) throw sellerErr;

  const today = new Date();
  let variantCount = 0;
  let obsCount = 0;

  for (let p = 0; p < PRODUCTS; p++) {
    const brand = pick(BRANDS);
    const cat = pick(cats!);
    const model = `${pick(SUFFIX)} ${100 + p}`;
    const name = `${cat.name} ${brand} ${model}`;
    // 10% stay draft, mimicking products created by the paste-URL flow (Đ6).
    const isDraft = p % 10 === 9;

    const { data: prod, error: prodErr } = await db
      .from("products")
      .insert({
        canonical_name: name,
        brand,
        model,
        category_id: cat.id,
        slug: `${slugify(`${brand} ${model}`)}-${p}`,
        status: isDraft ? "draft" : "verified",
      })
      .select()
      .single();
    if (prodErr) throw prodErr;

    // At most 3: CAPACITY has only 3 levels, more would create two variants with the same key
    // in one product.
    const nVariants = 2 + Math.floor(rnd() * 2);
    // Base price per PRODUCT. It used to be drawn per variant, so the 512GB version
    // could cost more than the 2TB one — nonsensical data, and it made the price-range filter
    // unverifiable since product price comes from the cheapest variant.
    const productBasePrice = 500_000 + Math.floor(rnd() * 4_500_000);
    // Capacity multiplier: 512GB < 1TB < 2TB.
    const CAPACITY_MULT = [1, 1.7, 2.9];

    for (let v = 0; v < nVariants; v++) {
      const { data: variant, error: vErr } = await db
        .from("product_variants")
        .insert({ product_id: prod.id, variant_key: `dung-luong=${CAPACITY[v % 3]}` })
        .select()
        .single();
      if (vErr) throw vErr;
      variantCount++;

      const basePrice = Math.round(productBasePrice * CAPACITY_MULT[v % 3]);
      // Each variant gets its own trend: negative = falling price (cheap today -> buy),
      // positive = rising price (expensive today -> avoid), around 0 -> wait.
      // If every variant fell, every product would come out "buy" and the seed data
      // could not exercise any other branch.
      const driftPerDay = (rnd() - 0.5) * 0.0024;
      const nOffers = 1 + Math.floor(rnd() * 4);
      const observations: Record<string, unknown>[] = [];
      let bestLatest: LatestObservation | null = null;

      for (let o = 0; o < nOffers; o++) {
        const seller = pick(sellers!);

        const { data: listing, error: lErr } = await db
          .from("listings")
          .insert({
            marketplace: "shopee",
            external_item_id: `${1000 + p}_${2000 + v * 10 + o}`,
            seller_id: seller.id,
            title: name,
            url: `https://shopee.vn/product/${1000 + p}/${2000 + v * 10 + o}`,
            status: "active",
          })
          .select()
          .single();
        if (lErr) throw lErr;

        const { data: offerRow, error: oErr } = await db
          .from("offers")
          .insert({
            listing_id: listing.id,
            variant_id: variant.id,
            match_confidence: isDraft ? 0.4 : 0.98,
            match_status: isDraft ? "pending" : "auto",
          })
          .select()
          .single();
        if (oErr) throw oErr;

        // This offer's price deviates 0–8% from the variant's base price.
        const offerBase = Math.round(basePrice * (1 + rnd() * 0.08));

        for (let d = DAYS - 1; d >= 0; d--) {
          // A few days with missing data — to exercise chart segment breaks and the
          // 10-observation threshold of deal-score.
          if (d % 17 === 3) continue;

          const at = new Date(today.getTime() - d * 86_400_000);
          at.setUTCHours(5, 0, 0, 0);

          const elapsed = DAYS - 1 - d; // 0 = oldest day, increasing to today
          const trend = 1 + driftPerDay * elapsed;
          const noise = 1 + (rnd() - 0.5) * 0.04;
          // d = 0 la hom nay: khong de hom nay luon roi vao flash sale, neu khong
          // gia hien tai luon thap hon toan bo lich su (rollup loai flash) va
          // moi variant deu ra "buy".
          const isFlash = d > 0 && d % 29 === 0;
          const price = Math.round(offerBase * trend * noise * (isFlash ? 0.82 : 1));
          const stock = rnd() < 0.08 ? 0 : 10 + Math.floor(rnd() * 90);
          const originalPrice = rnd() < 0.5 ? Math.round(price * 1.35) : null;

          observations.push({
            offer_id: offerRow.id,
            observed_at: at.toISOString(),
            price,
            original_price: originalPrice,
            stock,
            is_flash_sale: isFlash,
            is_valid: true,
            // Synthetic data, not real prices — must never mix with 'api'.
            source: "seed",
          });

          // Representative offer: in stock first, then cheapest — same as how the detail page
          // picks. Picking the cheapest regardless of stock would mark the variant "out of stock"
          // while some seller still has it.
          const better =
            bestLatest === null ||
            (stock > 0 && bestLatest.stock <= 0) ||
            ((stock > 0) === (bestLatest.stock > 0) && price < bestLatest.price);
          if (d === 0 && better) {
            bestLatest = {
              offer_id: offerRow.id,
              price,
              original_price: originalPrice,
              stock,
              is_flash_sale: isFlash,
              observed_at: at.toISOString(),
            };
          }
        }
      }

      await insertBatched("price_observations", observations);
      obsCount += observations.length;

      if (bestLatest) {
        const { error: vcpErr } = await db.from("variant_current_price").upsert({
          variant_id: variant.id,
          best_offer_id: bestLatest.offer_id,
          price: bestLatest.price,
          original_price: bestLatest.original_price,
          is_flash_sale: bestLatest.is_flash_sale,
          in_stock: bestLatest.stock > 0,
          offer_count: nOffers,
          observed_at: bestLatest.observed_at,
        });
        if (vcpErr) throw vcpErr;
      }
    }

    if ((p + 1) % 10 === 0) console.log(`  …${p + 1}/${PRODUCTS} products`);
  }

  console.log("Computing daily rollup…");
  const from = new Date(today.getTime() - DAYS * 86_400_000).toISOString().slice(0, 10);
  const to = today.toISOString().slice(0, 10);
  const { error: rollupErr } = await db.rpc("refresh_variant_daily_prices", {
    p_from: from,
    p_to: to,
  });
  if (rollupErr) throw rollupErr;

  console.log(
    `Done: ${PRODUCTS} products, ${variantCount} variants, ${obsCount} observations, ${DAYS} days.`,
  );
  console.log("Next: pnpm scores:recompute");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

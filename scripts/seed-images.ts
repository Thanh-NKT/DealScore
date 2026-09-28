/**
 * Attach sample images (public/samples/) to the products already in the local DB, without
 * re-seeding. Idempotent: running it again gives the same result.
 *
 * Run: pnpm seed:images
 */

import { createClient } from "@supabase/supabase-js";
import { requireLocalSupabase } from "./guard-env";
import { sampleImageFor } from "./sample-images";

const { url, serviceKey } = requireLocalSupabase("seed-images");
const db = createClient(url, serviceKey, { auth: { persistSession: false } });

async function main() {
  const { data, error } = await db
    .from("products")
    .select("id, slug, categories(slug)")
    .order("created_at", { ascending: true })
    .order("id", { ascending: true });
  if (error) throw new Error(`select products: ${error.message}`);

  let withImage = 0;
  for (const [i, p] of (data ?? []).entries()) {
    const cat = p.categories as unknown as { slug: string } | null;
    const image = sampleImageFor(cat?.slug ?? "", i);
    const { error: upErr } = await db.from("products").update({ image }).eq("id", p.id);
    if (upErr) throw new Error(`update ${p.slug}: ${upErr.message}`);
    if (image) withImage++;
  }

  console.log(`Done: ${data?.length ?? 0} products, ${withImage} with an image URL.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

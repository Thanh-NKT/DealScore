-- 0035 — GTIN lookup for the duplicate check in admin_create_product / admin_update_product (0032).
-- Not unique on purpose: older data may already hold duplicates; the RPCs enforce uniqueness for new writes.
--
-- One CONCURRENTLY statement per file, nothing else (see 0027 and supabase/README.md). A failed concurrent
-- build leaves an INVALID index that IF NOT EXISTS would then skip: drop it and re-run.
create index concurrently if not exists idx_products_gtin on public.products (gtin) where gtin is not null;

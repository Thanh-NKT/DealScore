-- 0034 — active listings by marketplace and last observation, for the admin health / freshness RPCs (0033)
-- and the admin catalog "Dữ liệu cũ" tab (0032). Built without blocking writes.
--
-- One CONCURRENTLY statement per file, nothing else: it cannot run inside a transaction block (see 0027 and
-- supabase/README.md). A failed concurrent build leaves an INVALID index that IF NOT EXISTS would then skip:
-- drop it and re-run.
create index concurrently if not exists idx_listings_active_observed on public.listings (marketplace, last_observed_at) where status = 'active';

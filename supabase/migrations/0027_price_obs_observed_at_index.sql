-- 0027 — the observed_at index used by the scoped daily rollup (0022), built without blocking writes.
--
-- CONCURRENTLY cannot run inside a transaction block, so this file holds this ONE statement and nothing
-- else. The Supabase CLI (checked with v2.117 `supabase migration up --db-url …` on a scratch database) sends
-- a migration file's statements without wrapping them in a transaction, so it works there. Applied some
-- other way (SQL Editor, a tool that wraps files in BEGIN/COMMIT), or if `db push` reports "cannot run inside
-- a transaction block", run the statement on its own first — see supabase/README.md.
-- A failed concurrent build leaves an INVALID index that IF NOT EXISTS would then skip: drop it and re-run.
create index concurrently if not exists idx_price_obs_observed_at on public.price_observations (observed_at);

-- 0054 — click_events (created_at): the date range of the admin affiliate report (0052) and the activity
-- window of the user KPIs / cohorts (0053). Same rules as 0027: CONCURRENTLY cannot run inside a transaction
-- block, so this file holds this ONE statement (see supabase/README.md). A failed concurrent build leaves an
-- INVALID index that IF NOT EXISTS would then skip: drop it and re-run.
create index concurrently if not exists idx_click_events_created on public.click_events (created_at);

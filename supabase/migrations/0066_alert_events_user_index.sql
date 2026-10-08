-- 0066 — alert_events (user_id, created_at desc): the per-user reads that no longer go through watches (0061 RLS
-- policy, the account export, the demand_found per-user cooldown in record_demand_follow_check). Same rules as
-- 0027 / 0054: CONCURRENTLY cannot run inside a transaction block, so this file holds this ONE statement (see
-- supabase/README.md). A failed concurrent build leaves an INVALID index that IF NOT EXISTS would then skip: drop
-- it and re-run.
create index concurrently if not exists idx_alert_events_user_time on public.alert_events (user_id, created_at desc);

-- 0024_pipeline_integrity.sql: data pipeline fixes (review-pipeline C1, I5, M5, M9).
--
--   1. extension_observations.peer_key: the salted IP hash of the request, also for signed-in contributors.
--      corroborate() counts one network as one peer, so "u:<id>" and "ip:<hash>" from the same person no
--      longer corroborate each other. Cleared after 2 days by prune_operational_data (the promotion window
--      reads 48h), so a user id is not kept next to an IP hash longer than needed.
--   2. collector_runs.pending_variant_ids: variants a run touched but has not re-scored yet. The next run
--      re-scores them when this run was killed (maxDuration) or its post-processing failed.
--   3. rate_counters + rate_hit(): a small fixed-window counter for app-level throttles (/go click writes per
--      IP, the global daily cap of /api/vouchers/refresh). Service role only.
--   4. prune_operational_data() (0023 version) also clears old peer keys and expired counters.

-- 1 ---------------------------------------------------------------------------
alter table public.extension_observations add column if not exists peer_key text;

-- 2 ---------------------------------------------------------------------------
alter table public.collector_runs add column if not exists pending_variant_ids uuid[];
create index if not exists idx_collector_runs_pending on public.collector_runs (started_at)
  where pending_variant_ids is not null or finished_at is null;

-- 3 ---------------------------------------------------------------------------
create table if not exists public.rate_counters (
  key          text primary key,
  window_start timestamptz not null,
  hits         integer not null,
  expires_at   timestamptz not null
);
alter table public.rate_counters enable row level security;
revoke all on public.rate_counters from public, anon, authenticated;
grant select, insert, update, delete on public.rate_counters to service_role;

-- true = this hit is within p_limit for the current window of p_window_seconds (and is counted);
-- false = over the limit. One statement, so concurrent hits cannot both pass the last slot.
create or replace function public.rate_hit(p_key text, p_window_seconds integer, p_limit integer)
returns boolean language plpgsql set search_path = public as $$
declare
  v_hits integer;
begin
  if p_key is null or length(p_key) > 200 or p_window_seconds <= 0 or p_limit <= 0 then
    raise exception 'rate_hit: invalid arguments';
  end if;
  insert into rate_counters as r (key, window_start, hits, expires_at)
  values (p_key, now(), 1, now() + make_interval(secs => p_window_seconds))
  on conflict (key) do update
    set window_start = case when r.expires_at <= now() then now() else r.window_start end,
        hits         = case when r.expires_at <= now() then 1 else r.hits + 1 end,
        expires_at   = case when r.expires_at <= now() then now() + make_interval(secs => p_window_seconds)
                            else r.expires_at end
  returning hits into v_hits;
  return v_hits <= p_limit;
end $$;
revoke execute on function public.rate_hit(text, integer, integer) from public, anon, authenticated;
grant execute on function public.rate_hit(text, integer, integer) to service_role;

-- 4 ---------------------------------------------------------------------------
create or replace function public.prune_operational_data()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_contrib  integer := 0;
  v_cron     integer := 0;
  v_http     integer := 0;
  v_peer     integer := 0;
  v_counters integer := 0;
begin
  -- The quota window is one hour.
  delete from extension_contributions where created_at < now() - interval '2 days';
  get diagnostics v_contrib = row_count;
  -- Corroboration reads 48h of contributions; older peer keys are never used again.
  update extension_observations set peer_key = null
  where peer_key is not null and created_at < now() - interval '2 days';
  get diagnostics v_peer = row_count;
  delete from rate_counters where expires_at < now() - interval '1 day';
  get diagnostics v_counters = row_count;
  begin
    delete from cron.job_run_details where end_time < now() - interval '30 days';
    get diagnostics v_cron = row_count;
  exception when undefined_table or insufficient_privilege then
    v_cron := -1;
  end;
  if to_regclass('net._http_response') is not null then
    begin
      execute 'delete from net._http_response where created < now() - interval ''7 days''';
      get diagnostics v_http = row_count;
    exception when insufficient_privilege or undefined_column then
      v_http := -1;
    end;
  end if;
  return jsonb_build_object('extension_contributions', v_contrib, 'cron_runs', v_cron, 'http_responses', v_http,
                            'peer_keys_cleared', v_peer, 'rate_counters', v_counters);
end $$;
revoke execute on function public.prune_operational_data() from public, anon, authenticated;
grant execute on function public.prune_operational_data() to service_role;

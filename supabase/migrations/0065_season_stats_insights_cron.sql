-- 0065 — Price-season calendar cache + the insights cron (roadmap P4 item A, spec §8.2; H's job shares it).
--
-- category_season_stats: per category and sale event (9.9, 11.11, Tết…), what recorded prices did around past
-- windows — aggregated by aggregateCategorySeason() (src/lib/seasons/category.ts). Recorded history only, never
-- a prediction. Public read, service-role writes. NEVER read by Deal Score, search or alerts.

create table if not exists public.category_season_stats (
  category_id      uuid not null references public.categories(id) on delete cascade,
  event_key        text not null check (event_key in ('6.6','7.7','8.8','9.9','10.10','11.11','12.12','black_friday','tet')),
  variants_counted integer not null,
  occurrences      integer not null,
  median_ratio     numeric(6,4) not null,
  share_lower      numeric(5,4) not null,
  computed_at      timestamptz not null,
  primary key (category_id, event_key)
);
alter table public.category_season_stats enable row level security;
drop policy if exists "category_season_stats_public_read" on public.category_season_stats;
create policy "category_season_stats_public_read" on public.category_season_stats for select using (true);
revoke all on public.category_season_stats from anon, authenticated;
grant select on public.category_season_stats to anon, authenticated;

-- Most-observed verified variants of a category (rollup day count over the last 400 days = SEASON_HISTORY_DAYS),
-- p_limit ≤ 200 (SEASON_JOB_MAX_VARIANTS).
create or replace function public.season_variant_ids(p_category_id uuid, p_limit integer)
returns table (variant_id uuid, days integer)
language sql stable set search_path = public as $$
  select v.id, count(*)::integer as days
  from products p
  join product_variants v on v.product_id = p.id
  join variant_daily_prices d on d.variant_id = v.id
  where p.category_id = p_category_id and p.status = 'verified'
    and d.day >= (now() at time zone 'Asia/Ho_Chi_Minh')::date - 400
    and d.min_price is not null
  group by v.id
  order by count(*) desc, v.id
  limit least(greatest(coalesce(p_limit, 200), 1), 200)
$$;
revoke execute on function public.season_variant_ids(uuid, integer) from public, anon, authenticated;
grant execute on function public.season_variant_ids(uuid, integer) to service_role;

-- Hourly; each run only does stale work (profiles / categories older than 7 days), so a weekly cadence emerges
-- and a large catalog finishes over several runs.
select cron.schedule('dealscore-insights', '37 * * * *', $job$
  select net.http_post(
    url     := (select decrypted_secret from vault.decrypted_secrets where name = 'dealscore_app_url')
               || '/api/cron/insights',
    headers := jsonb_build_object(
                 'Content-Type', 'application/json',
                 'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets
                                                where name = 'dealscore_cron_secret')),
    body    := '{}'::jsonb,
    timeout_milliseconds := 60000)
$job$);

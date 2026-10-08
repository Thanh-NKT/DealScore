-- 0037 — fix wave P1 (review minor 7): one malformed collector_runs.per_marketplace entry no longer breaks
-- admin_marketplace_health. Before, (e.value->>'ok')::integer / ::boolean raised on a string, a fraction or an
-- out-of-range number and the whole RPC failed (the admin page showed "Không đọc được số liệu sức khỏe").
-- Now: a counter is used only when it is a JSON number in [0, 2^31-1] (fractions truncated), else 0; aborted counts
-- only when it is a JSON boolean true. Redefined from 0033 (its latest body); same signature, grants kept.

-- Internal helper: revoked from every role like the other admin_* helpers; it runs inside the definer function.
create or replace function public.admin_run_counter(p jsonb)
returns integer language sql immutable set search_path = public as $$
  -- Nested CASE: the cast only runs once the type is known (AND does not guarantee evaluation order).
  select case when jsonb_typeof(p) = 'number'
              then case when (p #>> '{}')::numeric between 0 and 2147483647 then trunc((p #>> '{}')::numeric)::integer else 0 end
              else 0 end
$$;
revoke execute on function public.admin_run_counter(jsonb) from public, anon, authenticated, service_role;

create or replace function public.admin_marketplace_health(p_hours integer default 24, p_stale_hours integer default 48)
returns jsonb language sql stable security definer set search_path = public as $$
  with params as (
    select now() - least(greatest(coalesce(p_hours, 24), 1), 168) * interval '1 hour' as since,
           now() - least(greatest(coalesce(p_stale_hours, 48), 1), 720) * interval '1 hour' as stale_before
  ), lst as (
    select l.marketplace,
           count(*) filter (where l.status = 'active') as listings_active,
           count(*) filter (where l.status <> 'active') as listings_inactive,
           count(*) filter (where l.status = 'active'
                              and l.last_attempt_at > coalesce(l.last_observed_at, '-infinity'::timestamptz)) as listings_failing,
           count(*) filter (where l.status = 'active'
                              and (l.last_observed_at is null or l.last_observed_at < (select stale_before from params)))
             as listings_stale
    from listings l
    group by l.marketplace
  ), per_run as (
    select r.id, r.started_at, date_trunc('hour', r.started_at) as hour,
           coalesce(r.finished_at, r.started_at) as ended_at, r.error_summary,
           e.key as marketplace,
           admin_run_counter(e.value->'ok') as ok,
           admin_run_counter(e.value->'failed') as failed,
           case when jsonb_typeof(e.value->'aborted') = 'boolean' then (e.value->'aborted')::boolean else false end as aborted
    from collector_runs r
    cross join lateral jsonb_each(case when jsonb_typeof(r.per_marketplace) = 'object' then r.per_marketplace
                                       else '{}'::jsonb end) e
    where r.started_at >= (select since from params)
      and jsonb_typeof(e.value) = 'object'
  ), runs as (
    select marketplace, sum(ok)::integer as items_ok, sum(failed)::integer as items_failed, count(*)::integer as runs,
           (count(*) filter (where aborted))::integer as aborted_runs, max(ended_at) as last_run_at
    from per_run group by marketplace
  ), hourly as (
    select pr.hour, pr.marketplace,
           sum(pr.ok)::integer as ok, sum(pr.failed)::integer as failed, bool_or(pr.aborted) as aborted,
           (select left(x.error_summary, 300) from per_run x
             where x.marketplace = pr.marketplace and x.hour = pr.hour
               and x.error_summary is not null
             order by x.started_at desc, x.id limit 1) as error_sample
    from per_run pr
    group by 1, 2
  )
  select jsonb_build_object(
    'since', (select since from params),
    'marketplaces', coalesce((
      select jsonb_agg(jsonb_build_object(
               'marketplace', m.marketplace,
               'listings_active', coalesce(lst.listings_active, 0), 'listings_inactive', coalesce(lst.listings_inactive, 0),
               'listings_failing', coalesce(lst.listings_failing, 0), 'listings_stale', coalesce(lst.listings_stale, 0),
               'items_ok', coalesce(runs.items_ok, 0), 'items_failed', coalesce(runs.items_failed, 0),
               'runs', coalesce(runs.runs, 0), 'aborted_runs', coalesce(runs.aborted_runs, 0),
               'last_run_at', runs.last_run_at)
             order by m.marketplace)
      from (select marketplace from lst union select marketplace from runs) m
      left join lst on lst.marketplace = m.marketplace
      left join runs on runs.marketplace = m.marketplace), '[]'::jsonb),
    'hourly', coalesce((
      select jsonb_agg(jsonb_build_object('hour', h.hour, 'marketplace', h.marketplace, 'ok', h.ok, 'failed', h.failed,
                                          'aborted', h.aborted, 'error_sample', h.error_sample)
             order by h.hour, h.marketplace)
      from hourly h), '[]'::jsonb))
$$;

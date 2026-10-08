-- 0053 — Admin user KPIs and weekly retention cohorts (roadmap P3 item 14).
--
-- Aggregates only: no function returns a user_id or an email. "Active" = an analytics_events row with a
-- user or a click_events row with a user — the same source as metrics_daily_active_users /
-- metrics_retention_d30 (0010). Users pending deletion (users.deleted_at set) are never counted.
-- Cohorts are Vietnam calendar weeks (Monday) of users.created_at; T<k> = active in the k-th calendar week
-- after the signup week (T0 = the signup week). A week that has not ended is complete = false.
-- Both functions: security definer, service_role only.

-- 1 ---------------------------------------------------------------------------
create or replace function public.admin_user_kpis()
returns jsonb language sql stable security definer set search_path = public as $$
  with live as (
    select u.id, u.created_at from users u where u.deleted_at is null
  ),
  activity as (
    select a.user_id, a.created_at from analytics_events a
    where a.user_id is not null and a.created_at > now() - interval '30 days'
    union all
    select c.user_id, c.created_at from click_events c
    where c.user_id is not null and c.created_at > now() - interval '30 days'
  ),
  active as (
    select ac.user_id, max(ac.created_at) as last_at
    from activity ac join live l on l.id = ac.user_id
    group by ac.user_id
  ),
  w as (
    select w.user_id, w.channels from watches w join live l on l.id = w.user_id where w.status = 'active'
  )
  select jsonb_build_object(
    'total_users', (select count(*) from live),
    'new_7d', (select count(*) from live where created_at > now() - interval '7 days'),
    'new_30d', (select count(*) from live where created_at > now() - interval '30 days'),
    'pending_deletion', (select count(*) from users where deleted_at is not null),
    'active_7d', (select count(*) from active where last_at > now() - interval '7 days'),
    'active_30d', (select count(*) from active),
    'active_watches', (select count(*) from w),
    'watching_users', (select count(distinct user_id) from w),
    'watches_email', (select count(*) from w where 'email' = any(channels)),
    'watches_push', (select count(*) from w where 'push' = any(channels)),
    'push_subscribers', (select count(distinct ps.user_id) from push_subscriptions ps join live l on l.id = ps.user_id),
    'alerts_sent_7d', (select count(*) from alert_deliveries d where d.status = 'sent' and d.sent_at > now() - interval '7 days'))
$$;

-- 2 ---------------------------------------------------------------------------
create or replace function public.admin_retention_cohorts(p_weeks integer default 8, p_max_offset integer default 4)
returns table (cohort_week date, segment text, cohort_size integer, week_offset integer, active_users integer, complete boolean)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
declare
  v_weeks  integer := least(greatest(coalesce(p_weeks, 8), 1), 26);
  v_max    integer := least(greatest(coalesce(p_max_offset, 4), 1), 12);
  v_today  date := (now() at time zone 'Asia/Ho_Chi_Minh')::date;
  v_first  date;
  v_lo     timestamptz;
begin
  v_first := date_trunc('week', v_today::timestamp)::date - 7 * (v_weeks - 1);
  v_lo := v_first::timestamp at time zone 'Asia/Ho_Chi_Minh';

  return query
  with cohort as (
    select u.id, u.created_at, date_trunc('week', u.created_at at time zone 'Asia/Ho_Chi_Minh')::date as wk,
           (exists (select 1 from watches w
                    where w.user_id = u.id and w.created_at >= u.created_at and w.created_at < u.created_at + interval '7 days')
            or exists (select 1 from analytics_events e
                       where e.user_id = u.id and e.name = 'watch_created'
                         and e.created_at >= u.created_at and e.created_at < u.created_at + interval '7 days')) as with_watch
    from users u
    where u.deleted_at is null and u.created_at >= v_lo
  ),
  activity as (
    select a.user_id, date_trunc('week', a.created_at at time zone 'Asia/Ho_Chi_Minh')::date as wk
    from analytics_events a where a.user_id is not null and a.created_at >= v_lo
    union
    select c.user_id, date_trunc('week', c.created_at at time zone 'Asia/Ho_Chi_Minh')::date as wk
    from click_events c where c.user_id is not null and c.created_at >= v_lo
  ),
  members as (
    select c.id, c.wk, s.segment
    from cohort c
    cross join lateral (values ('all'), (case when c.with_watch then 'with_watch' else 'without_watch' end)) s(segment)
  ),
  sizes as (
    select m.wk, m.segment, count(*)::integer as n from members m group by 1, 2
  ),
  grid as (
    select s.wk, s.segment, s.n, k as off
    from sizes s cross join generate_series(0, v_max) k
    where s.wk + 7 * k <= v_today
  )
  select g.wk, g.segment, g.n, g.off,
         (select count(*)::integer from members m
          join activity a on a.user_id = m.id and a.wk = g.wk + 7 * g.off
          where m.wk = g.wk and m.segment = g.segment),
         g.wk + 7 * (g.off + 1) <= v_today
  from grid g
  order by g.wk desc, g.segment, g.off;
end $$;

-- 3 ---------------------------------------------------------------------------
revoke execute on function public.admin_user_kpis(), public.admin_retention_cohorts(integer, integer)
  from public, anon, authenticated;
grant execute on function public.admin_user_kpis(), public.admin_retention_cohorts(integer, integer)
  to service_role;

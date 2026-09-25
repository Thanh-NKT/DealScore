-- 0010_analytics.sql: first-party analytics for the North Star metrics (1.11)
--
-- No third-party tracker: events are written server-side (src/lib/analytics/track.ts) with the
-- service role. Only an allow-listed set of event names and properties (no emails, no search text,
-- no URLs — see sanitizeProps()). Rows go away with the user (on delete cascade).

create table if not exists public.analytics_events (
  id         bigint generated always as identity primary key,
  name       text not null check (name in (
               'signup_completed', 'login_succeeded', 'lookup_submitted', 'search_performed',
               'product_viewed', 'watch_created', 'watch_deleted', 'push_enabled')),
  user_id    uuid references public.users(id) on delete cascade,
  session_id text,
  props      jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_analytics_events_name_time on public.analytics_events (name, created_at desc);
create index if not exists idx_analytics_events_user_time on public.analytics_events (user_id, created_at desc)
  where user_id is not null;

alter table public.analytics_events enable row level security;
revoke all on public.analytics_events from anon, authenticated;

-- ============================================================================
-- North Star views (service role only)
-- ============================================================================

-- North Star: active Watches of users who are not being deleted.
create or replace view public.metrics_active_watches with (security_invoker = true) as
select count(*)::integer as active_watches,
       count(distinct w.user_id)::integer as watching_users
from watches w
join users u on u.id = w.user_id and u.deleted_at is null
where w.status = 'active';

-- Daily active users (Vietnam calendar day): any tracked event or buy click.
create or replace view public.metrics_daily_active_users with (security_invoker = true) as
with activity as (
  select user_id, created_at from analytics_events where user_id is not null
  union all
  select user_id, created_at from click_events where user_id is not null
)
select (created_at at time zone 'Asia/Ho_Chi_Minh')::date as day,
       count(distinct user_id)::integer as active_users
from activity
group by 1;

-- Retention D30 (G2 gate ≥ 25%): per signup week, users active on day [30, 37) after signup.
-- Cohorts younger than 37 days are incomplete and excluded.
create or replace view public.metrics_retention_d30 with (security_invoker = true) as
with activity as (
  select user_id, created_at from analytics_events where user_id is not null
  union all
  select user_id, created_at from click_events where user_id is not null
),
cohort as (
  select u.id, u.created_at,
         date_trunc('week', u.created_at at time zone 'Asia/Ho_Chi_Minh')::date as cohort_week
  from users u
  where u.created_at <= now() - interval '37 days'
)
select c.cohort_week,
       count(*)::integer as cohort_size,
       count(*) filter (where exists (
         select 1 from activity a
         where a.user_id = c.id
           and a.created_at >= c.created_at + interval '30 days'
           and a.created_at <  c.created_at + interval '37 days'
       ))::integer as retained,
       round(count(*) filter (where exists (
         select 1 from activity a
         where a.user_id = c.id
           and a.created_at >= c.created_at + interval '30 days'
           and a.created_at <  c.created_at + interval '37 days'
       ))::numeric / nullif(count(*), 0), 4) as rate
from cohort c
group by c.cohort_week;

revoke all on public.metrics_active_watches, public.metrics_daily_active_users,
              public.metrics_retention_d30
  from anon, authenticated;

-- ============================================================================
-- Reserved category slugs: routes are English now (/account, /search, …) and a category
-- must never shadow one of them (product URLs are /{category}/{product}).
-- ============================================================================
alter table public.categories drop constraint if exists categories_slug_reserved;
alter table public.categories add constraint categories_slug_reserved check (
  slug not in ('tim-kiem','brand','danh-muc','go','api','share-target','admin','auth','watch',
               'tai-khoan','account','login','register','search','privacy','terms','unsubscribe',
               'forgot-password','reset-password','sitemap.xml','robots.txt')
);

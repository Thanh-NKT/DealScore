-- 0033 — admin marketplace health, data freshness, sidebar badge (Admin spec 2026-10-07-roadmap-p1-admin-logic §A2).
-- Read-only, service-role only, no admin_audit row. Thresholds are parameters: the admin app owns the numbers
-- (src/lib/health/thresholds.ts there); the defaults here only mirror them.
--
-- Shared definitions (all on listings.status = 'active'):
--   failing = last_attempt_at > coalesce(last_observed_at, '-infinity')    (failing_listings, 0021)
--   stale   = last_observed_at is null or older than p_stale_hours         (STALE_HOURS = 48 in DealScore)

-- 1 ---------------------------------------------------------------------------
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
           coalesce((e.value->>'ok')::integer, 0) as ok,
           coalesce((e.value->>'failed')::integer, 0) as failed,
           coalesce((e.value->>'aborted')::boolean is true, false) as aborted
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

-- 2 ---------------------------------------------------------------------------
-- Stale visible offers per marketplace: the same rows admin_stale_offers lists (without paging).
create or replace function public.admin_stale_offer_rows(p_stale_hours integer)
returns table (offer_id uuid, listing_id uuid, variant_id uuid, product_id uuid, marketplace text,
               last_observed_at timestamptz, last_attempt_at timestamptz)
language sql stable set search_path = public as $$
  select o.id, l.id, o.variant_id, pr.id, l.marketplace, l.last_observed_at, l.last_attempt_at
  from offers o
  join listings l on l.id = o.listing_id
  join product_variants pv on pv.id = o.variant_id
  join products pr on pr.id = pv.product_id
  where l.status = 'active'
    and offer_is_visible(o.match_status, l.status, pr.status)
    and (l.last_observed_at is null
         or l.last_observed_at < now() - least(greatest(coalesce(p_stale_hours, 48), 1), 720) * interval '1 hour')
$$;

create or replace function public.admin_freshness(p_edges_minutes integer[] default '{15,60,360,1440,2880}',
                                                  p_stale_hours integer default 48)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_result jsonb;
begin
  if p_edges_minutes is null or cardinality(p_edges_minutes) not between 1 and 10
     or array_position(p_edges_minutes, null) is not null
     or exists (select 1 from unnest(p_edges_minutes) with ordinality e(m, i)
                where e.m <= 0 or (e.i > 1 and e.m <= p_edges_minutes[e.i::integer - 1])) then
    raise exception 'admin_freshness: mốc không hợp lệ';
  end if;

  with aged as (
    select l.marketplace,
           case when l.last_observed_at is null then -1
                else (select count(*)::integer from unnest(p_edges_minutes) m
                      where m <= extract(epoch from now() - l.last_observed_at) / 60) end as bucket
    from listings l
    where l.status = 'active'
  )
  select jsonb_build_object(
    'buckets', coalesce((
      select jsonb_agg(jsonb_build_object('marketplace', marketplace, 'bucket', bucket, 'listings', n)
             order by marketplace, bucket)
      from (select marketplace, bucket, count(*)::integer as n from aged group by 1, 2) b), '[]'::jsonb),
    'by_priority', coalesce((
      select jsonb_agg(jsonb_build_object('refresh_priority', refresh_priority, 'listings', n) order by refresh_priority)
      from (select refresh_priority, count(*)::integer as n from listings where status = 'active' group by 1) p), '[]'::jsonb),
    'stale_offers', coalesce((
      select jsonb_agg(jsonb_build_object('marketplace', marketplace, 'offers', n) order by marketplace)
      from (select marketplace, count(*)::integer as n from admin_stale_offer_rows(p_stale_hours) group by 1) s), '[]'::jsonb)
  ) into v_result;
  return v_result;
end $$;

-- 3 ---------------------------------------------------------------------------
create or replace function public.admin_stale_offers(p_stale_hours integer default 48, p_marketplace text default null,
                                                     p_limit integer default 50, p_offset integer default 0)
returns table (offer_id uuid, listing_id uuid, marketplace text, listing_title text, url text,
               product_id uuid, product_name text, product_status text, product_slug text, category_slug text,
               last_observed_at timestamptz, last_attempt_at timestamptz, failing boolean, watched boolean,
               total_count bigint)
language sql stable security definer set search_path = public as $$
  select s.offer_id, s.listing_id, s.marketplace, l.title, l.url,
         pr.id, pr.canonical_name, pr.status, pr.slug, c.slug,
         s.last_observed_at, s.last_attempt_at,
         coalesce(s.last_attempt_at > coalesce(s.last_observed_at, '-infinity'::timestamptz), false) as failing,
         w.watched,
         count(*) over () as total_count
  from admin_stale_offer_rows(p_stale_hours) s
  join listings l on l.id = s.listing_id
  join products pr on pr.id = s.product_id
  left join categories c on c.id = pr.category_id
  -- Same rule as collector_candidates: an active Watch on the offer's variant.
  cross join lateral (
    select exists (select 1 from watches wt where wt.variant_id = s.variant_id and wt.status = 'active') as watched
  ) w
  where p_marketplace is null or s.marketplace = p_marketplace
  order by w.watched desc, s.last_observed_at asc nulls first, s.offer_id
  limit least(greatest(coalesce(p_limit, 50), 1), 100)
  offset greatest(coalesce(p_offset, 0), 0)
$$;

-- 4 ---------------------------------------------------------------------------
-- admin_overview_counts from 0021 (latest body) + stale_listings. The signature changes, so drop first;
-- calling it without arguments still works (default 48).
drop function if exists public.admin_overview_counts();
create function public.admin_overview_counts(p_stale_hours integer default 48)
returns jsonb language sql stable security definer set search_path = public, cron as $$
  with draft_listings as (
    select pr.id, count(distinct l.id) filter (where l.status = 'active') as n
    from products pr
    left join product_variants pv on pv.product_id = pr.id
    left join offers o on o.variant_id = pv.id
    left join listings l on l.id = o.listing_id
    where pr.status = 'draft'
    group by pr.id
  )
  select jsonb_build_object(
    'drafts_multi_shop', (select count(*) from draft_listings where n >= 2),
    'drafts_single', (select count(*) from draft_listings where n = 1),
    'pending_matches', (select count(*) from match_candidates where decision = 'pending' or decision is null),
    'failing_listings', (select count(*) from listings
                          where status = 'active' and last_attempt_at is not null
                            and last_attempt_at > coalesce(last_observed_at, '-infinity'::timestamptz)),
    'cron_failures_24h', (select coalesce(sum(failures_24h), 0) from admin_cron_status()),
    'last_collector_at', (select max(finished_at) from collector_runs),
    'tiktok_access_expires_at', (select access_expires_at from marketplace_credentials where marketplace = 'tiktok'),
    'stale_listings', (select count(*) from listings
                        where status = 'active'
                          and (last_observed_at is null
                               or last_observed_at < now() - least(greatest(coalesce(p_stale_hours, 48), 1), 720)
                                                             * interval '1 hour'))
  )
$$;

-- 5 ---------------------------------------------------------------------------
revoke execute on function public.admin_stale_offer_rows(integer) from public, anon, authenticated, service_role;
revoke execute on function public.admin_marketplace_health(integer, integer),
                           public.admin_freshness(integer[], integer),
                           public.admin_stale_offers(integer, text, integer, integer),
                           public.admin_overview_counts(integer)
  from public, anon, authenticated;
grant execute on function public.admin_marketplace_health(integer, integer),
                          public.admin_freshness(integer[], integer),
                          public.admin_stale_offers(integer, text, integer, integer),
                          public.admin_overview_counts(integer)
  to service_role;

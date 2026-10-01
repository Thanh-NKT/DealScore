-- 0018_collector_attempts.sql: listings that keep failing (not found / per-item errors) must not
-- block the collector queue. A failed fetch records last_attempt_at (the listing stays active);
-- the candidate order counts age from the later of last_observed_at / last_attempt_at.

alter table public.listings add column if not exists last_attempt_at timestamptz;

-- The return type changes (adds last_attempt_at), so the old function must be dropped first.
drop function if exists public.collector_candidates(integer, text[]);

create or replace function public.collector_candidates(p_limit integer, p_marketplaces text[] default array['shopee'])
returns table (id uuid, marketplace text, external_item_id text, refresh_priority integer,
               last_observed_at timestamptz, last_attempt_at timestamptz, watched boolean)
language sql stable security definer set search_path = public as $$
  select l.id, l.marketplace, l.external_item_id, l.refresh_priority, l.last_observed_at, l.last_attempt_at, w.watched
  from listings l
  cross join lateral (
    select exists (
      select 1 from offers o
      join watches wt on wt.variant_id = o.variant_id and wt.status = 'active'
      where o.listing_id = l.id
    ) as watched
  ) w
  where l.marketplace = any(p_marketplaces) and l.status = 'active'
  -- greatest() ignores nulls; both null = never observed nor attempted → first.
  order by case
             when greatest(l.last_observed_at, l.last_attempt_at) is null then 1e9
             else extract(epoch from (now() - greatest(l.last_observed_at, l.last_attempt_at))) / 3600.0
                  / case when w.watched or l.refresh_priority <= 1 then 2
                         when l.refresh_priority = 2 then 6
                         else 24 end
           end desc
  limit greatest(p_limit, 0)
$$;

revoke execute on function public.collector_candidates(integer, text[]) from public, anon, authenticated;
grant execute on function public.collector_candidates(integer, text[]) to service_role;

-- 0064 — Seller price-behaviour profile (roadmap P4 item H, spec §6.1).
--
-- Facts about how one shop's listed prices behaved in the last 90 days, from DealScore's own observations,
-- computed by computeSellerProfile() (src/lib/sellers/profile.ts) with P2's fakeSaleForPrice() — the same verdict
-- the product page would have shown that day. Public read (catalog-derived, like variant_deal_scores),
-- service-role writes. NEVER read by Deal Score, search or alerts (tests/lib/insights/no-feed.test.ts).

create table if not exists public.seller_price_profiles (
  seller_id      uuid primary key references public.sellers(id) on delete cascade,
  computed_at    timestamptz not null,
  window_days    smallint not null,
  offers_tracked integer not null,
  claim_weeks    integer not null,
  claim_offers   integer not null,
  doubtful_weeks integer not null,
  hike_weeks     integer not null,
  median_swing   numeric(6,4),
  stable_offers  integer not null,
  version        text not null
);
create index if not exists idx_seller_price_profiles_computed on public.seller_price_profiles (computed_at);
alter table public.seller_price_profiles enable row level security;
drop policy if exists "seller_price_profiles_public_read" on public.seller_price_profiles;
create policy "seller_price_profiles_public_read" on public.seller_price_profiles for select using (true);
revoke all on public.seller_price_profiles from anon, authenticated;
grant select on public.seller_price_profiles to anon, authenticated;

-- Daily low (non-flash, valid, price > 0) and that day's highest list price per offer, Vietnam days, for at most
-- 50 offers. Uses idx_price_obs_offer_time.
create or replace function public.offer_daily_prices(p_offer_ids uuid[], p_from date)
returns table (offer_id uuid, day date, min_price numeric, list_price numeric, obs_count integer)
language sql stable set search_path = public as $$
  select po.offer_id,
         (po.observed_at at time zone 'Asia/Ho_Chi_Minh')::date as day,
         min(po.price),
         max(po.original_price),
         count(*)::integer
  from price_observations po
  where po.offer_id = any((coalesce(p_offer_ids, '{}'::uuid[]))[1:50])
    and po.observed_at >= (p_from::timestamp at time zone 'Asia/Ho_Chi_Minh')
    and po.is_valid and not po.is_flash_sale and po.price > 0
  group by po.offer_id, (po.observed_at at time zone 'Asia/Ho_Chi_Minh')::date
  order by po.offer_id, day
$$;

-- Sellers with an active listing seen in the last 90 days (SELLER_PROFILE_WINDOW_DAYS), with their matched
-- offers (offer_in_history rule). offer_ids and variant_ids are ALIGNED: variant_ids[i] is offer_ids[i]'s variant.
-- Keyset paging on seller_id; p_limit ≤ 50; ≤ 200 offers per seller.
create or replace function public.seller_offer_ids(p_after uuid, p_limit integer)
returns table (seller_id uuid, offer_ids uuid[], variant_ids uuid[])
language sql stable set search_path = public as $$
  with sel as (
    select distinct l.seller_id
    from listings l
    where l.seller_id is not null
      and (p_after is null or l.seller_id > p_after)
      and l.status = 'active'
      and l.last_observed_at >= now() - interval '90 days'
    order by l.seller_id
    limit least(greatest(coalesce(p_limit, 50), 1), 50)
  )
  -- Every page seller is returned (empty arrays when none of its offers count), so the caller's cursor never
  -- mistakes a page of unusable sellers for the end.
  select sel.seller_id, coalesce(x.offer_ids, '{}'::uuid[]), coalesce(x.variant_ids, '{}'::uuid[])
  from sel
  left join lateral (
    select (array_agg(o.id order by o.id))[1:200] as offer_ids,
           (array_agg(o.variant_id order by o.id))[1:200] as variant_ids
    from listings l
    join offers o on o.listing_id = l.id and o.variant_id is not null
    join product_variants v on v.id = o.variant_id
    join products p on p.id = v.product_id
    where l.seller_id = sel.seller_id
      and offer_in_history(o.match_status, p.status, l.deactivated_by)
  ) x on true
  order by sel.seller_id
$$;

revoke execute on function public.offer_daily_prices(uuid[], date), public.seller_offer_ids(uuid, integer)
  from public, anon, authenticated;
grant execute on function public.offer_daily_prices(uuid[], date), public.seller_offer_ids(uuid, integer)
  to service_role;

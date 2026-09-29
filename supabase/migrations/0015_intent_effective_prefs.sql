-- 0015_intent_effective_prefs.sql
-- Spec: docs/superpowers/specs/2026-09-28-giai-doan-3-nhom-a.md §2, §5
-- 1. product_variants.capacity_gb (parsed by f_capacity_gb, kept fresh by trigger, backfilled)
-- 2. offers.effective_price / effective_price_at (after-voucher price, filled by the refresh job)
-- 3. search_products v6 (p_capacity_gb, p_boost_terms, sort effective_asc, effective_price column)
-- 4. intent_vocab() — categories + verified brands for the query intent parser
-- 5. user_preferences (RLS: owner only)
-- 6. analytics events search_intent_applied, preferences_saved

-- ============================================================================
-- 1. product_variants.capacity_gb
-- ============================================================================
alter table public.product_variants add column if not exists capacity_gb integer;

-- Storage capacity in GB found in a variant's text ("2TB" → 2048, "512GB" → 512, "1.5TB" → 1536).
-- Several capacities that disagree by more than 3% → null (ambiguous, e.g. "2TB / 1TB").
-- Postgres ARE has no reliable lookahead, so the unit must be followed by a non-letter or the end.
create or replace function public.f_capacity_gb(s text)
returns integer language plpgsql immutable parallel safe
as $$
declare
  m      text[];
  gb     integer;
  lo     integer;
  hi     integer;
begin
  if s is null then
    return null;
  end if;
  for m in
    select regexp_matches(lower(public.f_unaccent(s)), '(\d+(?:[.,]\d+)?)\s*(tb|gb)([^a-z]|$)', 'g')
  loop
    gb := round(replace(m[1], ',', '.')::numeric * case when m[2] = 'tb' then 1024 else 1 end);
    lo := least(coalesce(lo, gb), gb);
    hi := greatest(coalesce(hi, gb), gb);
  end loop;
  if hi is null or hi = 0 then
    return null;
  end if;
  if (hi - lo)::numeric / hi > 0.03 then
    return null;
  end if;
  return hi;
end
$$;

create or replace function public.trg_variant_capacity()
returns trigger language plpgsql
as $$
begin
  new.capacity_gb := public.f_capacity_gb(new.variant_key || ' ' || coalesce(new.specs::text, ''));
  return new;
end
$$;

drop trigger if exists trg_variant_capacity on public.product_variants;
create trigger trg_variant_capacity before insert or update of variant_key, specs on public.product_variants
  for each row execute function public.trg_variant_capacity();

update public.product_variants
   set capacity_gb = public.f_capacity_gb(variant_key || ' ' || coalesce(specs::text, ''));

create index if not exists idx_variants_product_capacity on public.product_variants (product_id, capacity_gb);

-- ============================================================================
-- 2. offers.effective_price
-- ============================================================================
-- null = no applicable voucher. Written by the effective-price refresh (service role).
alter table public.offers add column if not exists effective_price    numeric(14,2);
alter table public.offers add column if not exists effective_price_at timestamptz;

-- ============================================================================
-- 3. search_products v6 — capacity, boost terms, effective price
-- ============================================================================
drop function if exists public.search_products(text, uuid, text[], numeric, numeric, text, integer, integer, numeric, boolean, boolean, text[]);

select public.word_similarity('a', 'a');

create function public.search_products(
  p_q             text    default null,
  p_category_id   uuid    default null,
  p_brands        text[]  default null,
  p_min_price     numeric default null,
  p_max_price     numeric default null,
  p_sort          text    default 'relevance',
  p_limit         integer default 24,
  p_offset        integer default 0,
  p_min_rating    numeric default null,
  p_free_shipping boolean default null,
  p_has_voucher   boolean default null,
  p_marketplaces  text[]  default null,
  p_capacity_gb   integer default null,
  p_boost_terms   text[]  default null
) returns table (
  product_id uuid, slug text, canonical_name text, brand text, image text,
  category_slug text, best_price numeric, original_price numeric,
  score smallint, recommendation text, last_observed_at timestamptz,
  relevance real, total_count bigint, effective_price numeric
) language sql stable
set pg_trgm.word_similarity_threshold = 0.4
as $$
  with norm as (
    select btrim(public.f_unaccent(lower(coalesce(p_q, '')))) as q
  ),
  tsq as (
    select case when (select q from norm) = '' then null
           else to_tsquery('simple',
                  array_to_string(
                    array(select t || ':*'
                          from regexp_split_to_table(
                                 btrim(regexp_replace((select q from norm), '[^a-z0-9]+', ' ', 'g')),
                                 '\s+') t
                          where t <> ''), ' & ')) end as tq
  ),
  matched as (
    select p.*,
           case
             when (select q from norm) = '' then 0::real
             when (select tq from tsq) is not null
                  and to_tsvector('simple', p.search_text) @@ (select tq from tsq)
               then ts_rank(to_tsvector('simple', p.search_text), (select tq from tsq)) + 1.0
             else word_similarity((select q from norm), p.search_text)
           end as rel
    from products p
    where (p_category_id is null or p.category_id = p_category_id)
      and (p_brands is null or lower(p.brand) = any(array(select lower(b) from unnest(p_brands) b)))
      and ((select q from norm) = ''
           or ((select tq from tsq) is not null
               and to_tsvector('simple', p.search_text) @@ (select tq from tsq))
           or p.search_text %> (select q from norm))
      and (p_marketplaces is null or cardinality(p_marketplaces) = 0 or exists (
             select 1
             from product_variants v
             join offers o   on o.variant_id = v.id and o.match_status in ('auto', 'manual')
             join listings l on l.id = o.listing_id and l.status = 'active'
             where v.product_id = p.id and l.marketplace = any(p_marketplaces)))
  ),
  priced as (
    select m.id, m.slug, m.canonical_name, m.brand, m.image,
           -- Boost: + 0.5 × share of boost terms found in search_text (already unaccented, lowercase).
           (m.rel + case when coalesce(cardinality(p_boost_terms), 0) = 0 then 0
                         else 0.5 * (select count(*) from unnest(p_boost_terms) t
                                     where m.search_text like '%' || lower(public.f_unaccent(t)) || '%')::real
                              / cardinality(p_boost_terms) end)::real as rel,
           c.slug as category_slug,
           rep.variant_id, rep.price, rep.original_price, rep.observed_at,
           vds.score, vds.recommendation,
           bo.free_shipping, bo.has_voucher, s.rating as seller_rating,
           case when bo.effective_price < rep.price
                 and bo.effective_price_at > now() - interval '7 days'
                then bo.effective_price end as effective_price
    from matched m
    left join categories c on c.id = m.category_id
    left join lateral (
      select v.id as variant_id, vcp.price, vcp.original_price, vcp.observed_at, vcp.best_offer_id
      from product_variants v
      join variant_current_price vcp on vcp.variant_id = v.id
      where v.product_id = m.id and vcp.price is not null
        -- Capacity-aware representative variant: within 3% of the requested capacity.
        and (p_capacity_gb is null
             or (v.capacity_gb is not null
                 and abs(v.capacity_gb - p_capacity_gb)::numeric / greatest(v.capacity_gb, p_capacity_gb) <= 0.03))
      order by vcp.in_stock desc, vcp.price asc
      limit 1
    ) rep on true
    left join variant_deal_scores vds on vds.variant_id = rep.variant_id
    left join offers bo   on bo.id = rep.best_offer_id
    left join listings bl on bl.id = bo.listing_id
    left join sellers s   on s.id = bl.seller_id
    where (p_capacity_gb is null or rep.variant_id is not null)
      and (p_min_price is null or rep.price >= p_min_price)
      and (p_max_price is null or rep.price <= p_max_price)
      and (p_min_rating is null or s.rating >= p_min_rating)
      and (p_free_shipping is null or not p_free_shipping or bo.free_shipping is true)
      and (p_has_voucher is null or not p_has_voucher or bo.has_voucher is true)
  )
  select id, slug, canonical_name, brand, image, category_slug,
         price, original_price, score, recommendation, observed_at,
         rel, count(*) over () as total_count, effective_price
  from priced
  order by
    case when p_sort = 'price_asc'     then price       end asc  nulls last,
    case when p_sort = 'price_desc'    then price       end desc nulls last,
    case when p_sort = 'deal_score'    then score       end desc nulls last,
    case when p_sort = 'updated'       then observed_at end desc nulls last,
    case when p_sort = 'relevance'     then rel         end desc nulls last,
    case when p_sort = 'effective_asc' then coalesce(effective_price, price) end asc nulls last,
    id
  limit p_limit offset p_offset
$$;

grant execute on function public.search_products(text, uuid, text[], numeric, numeric, text, integer, integer, numeric, boolean, boolean, text[], integer, text[])
  to anon, authenticated;

-- ============================================================================
-- 4. intent_vocab()
-- ============================================================================
create or replace function public.intent_vocab()
returns table (kind text, value text, label text)
language sql stable
as $$
  select 'category'::text, c.slug, c.name from public.categories c
  union all
  select distinct 'brand'::text, p.brand, p.brand
  from public.products p
  where p.status = 'verified' and p.brand is not null
$$;

grant execute on function public.intent_vocab() to anon, authenticated;

-- ============================================================================
-- 5. user_preferences
-- ============================================================================
create table if not exists public.user_preferences (
  user_id         uuid primary key references public.users(id) on delete cascade,
  brands          text[]  not null default '{}' check (cardinality(brands) <= 20),
  excluded_brands text[]  not null default '{}' check (cardinality(excluded_brands) <= 20),
  category_ids    uuid[]  not null default '{}' check (cardinality(category_ids) <= 20),
  min_price       numeric(14,2) check (min_price >= 0),
  max_price       numeric(14,2) check (max_price >= 0),
  marketplaces    text[]  not null default '{}'
                  check (marketplaces <@ array['shopee', 'tiktok', 'lazada']::text[]),
  updated_at      timestamptz not null default now(),
  constraint user_preferences_price_order check (min_price is null or max_price is null or min_price <= max_price)
);

alter table public.user_preferences enable row level security;

drop policy if exists "user_preferences_owner_select" on public.user_preferences;
create policy "user_preferences_owner_select" on public.user_preferences
  for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists "user_preferences_owner_insert" on public.user_preferences;
create policy "user_preferences_owner_insert" on public.user_preferences
  for insert to authenticated with check ((select auth.uid()) = user_id);
drop policy if exists "user_preferences_owner_update" on public.user_preferences;
create policy "user_preferences_owner_update" on public.user_preferences
  for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
drop policy if exists "user_preferences_owner_delete" on public.user_preferences;
create policy "user_preferences_owner_delete" on public.user_preferences
  for delete to authenticated using ((select auth.uid()) = user_id);

grant select, insert, update, delete on public.user_preferences to authenticated;

-- ============================================================================
-- 6. Analytics events
-- ============================================================================
alter table public.analytics_events drop constraint if exists analytics_events_name_check;
alter table public.analytics_events add constraint analytics_events_name_check check (name in (
  'signup_completed', 'login_succeeded', 'lookup_submitted', 'search_performed',
  'product_viewed', 'watch_created', 'watch_deleted', 'push_enabled',
  'deal_shared', 'share_opened', 'search_intent_applied', 'preferences_saved'));

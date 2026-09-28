-- 0014_vouchers_folders_digest.sql
-- Spec: docs/superpowers/specs/2026-09-26-voucher-thu-muc-digest-loc-san-anh-logic.md
-- 1. vouchers (catalog, public read, service-role writes)
-- 2. listings.images
-- 3. watch_folders + watches.folder_id (RLS: owner only)
-- 4. notification_settings: weekly_digest + digest_weekday
-- 5. search_products v5 (p_marketplaces) + filter_availability.marketplaces

-- ============================================================================
-- 1. vouchers
-- ============================================================================
create table if not exists public.vouchers (
  id             uuid primary key default gen_random_uuid(),
  marketplace    text not null,
  kind           text not null check (kind in ('shop', 'platform', 'shipping', 'payment')),
  seller_id      uuid references public.sellers(id) on delete cascade,
  listing_id     uuid references public.listings(id) on delete cascade,
  code           text check (code is null or code ~ '^[A-Z0-9]{3,20}$'),
  discount_type  text not null check (discount_type in ('percent', 'amount')),
  discount_value numeric(14,2) not null check (discount_value > 0),
  max_discount   numeric(14,2) check (max_discount is null or max_discount > 0),
  min_spend      numeric(14,2) not null default 0 check (min_spend >= 0),
  starts_at      timestamptz,
  expires_at     timestamptz,
  source         text not null check (source in ('api', 'extension', 'seed')),
  reporters      text[] not null default '{}',
  first_seen_at  timestamptz not null default now(),
  last_seen_at   timestamptz not null default now(),
  check (kind <> 'shop' or seller_id is not null),
  check (discount_type <> 'percent' or discount_value <= 100),
  check (cardinality(reporters) <= 20)
);

-- Natural key: the same voucher seen again only refreshes last_seen_at / reporters.
create unique index if not exists vouchers_natural_key on public.vouchers (
  marketplace, kind,
  coalesce(seller_id::text, ''), coalesce(listing_id::text, ''), coalesce(code, ''),
  discount_type, discount_value, min_spend
);
create index if not exists idx_vouchers_listing on public.vouchers (listing_id);
create index if not exists idx_vouchers_seller on public.vouchers (seller_id);
create index if not exists idx_vouchers_platform on public.vouchers (marketplace, kind) where seller_id is null and listing_id is null;

grant select on public.vouchers to anon, authenticated;

-- Upsert a batch (service role). reporter = hashed extension contributor, null for API/seed.
create or replace function public.upsert_vouchers(p_items jsonb, p_source text, p_reporter text default null)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v jsonb;
  n integer := 0;
begin
  if p_source not in ('api', 'extension', 'seed') then
    raise exception 'invalid source %', p_source;
  end if;
  for v in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) loop
    insert into vouchers as t (
      marketplace, kind, seller_id, listing_id, code, discount_type, discount_value,
      max_discount, min_spend, starts_at, expires_at, source, reporters
    ) values (
      v->>'marketplace', v->>'kind', nullif(v->>'sellerId', '')::uuid, nullif(v->>'listingId', '')::uuid,
      nullif(v->>'code', ''), v->>'discountType', (v->>'discountValue')::numeric,
      nullif(v->>'maxDiscount', '')::numeric, coalesce(nullif(v->>'minSpend', '')::numeric, 0),
      nullif(v->>'startsAt', '')::timestamptz, nullif(v->>'expiresAt', '')::timestamptz,
      p_source, case when p_reporter is null then '{}'::text[] else array[p_reporter] end
    )
    on conflict (
      marketplace, kind,
      coalesce(seller_id::text, ''), coalesce(listing_id::text, ''), coalesce(code, ''),
      discount_type, discount_value, min_spend
    ) do update set
      last_seen_at = now(),
      max_discount = coalesce(excluded.max_discount, t.max_discount),
      starts_at    = coalesce(excluded.starts_at, t.starts_at),
      expires_at   = coalesce(excluded.expires_at, t.expires_at),
      -- An API sighting outranks extension reports; never downgrade.
      source       = case when t.source = 'api' or excluded.source = 'api' then 'api' else excluded.source end,
      reporters    = case
                       when p_reporter is null or p_reporter = any(t.reporters) or cardinality(t.reporters) >= 20
                         then t.reporters
                       else t.reporters || p_reporter
                     end;
    n := n + 1;
  end loop;
  return n;
end;
$$;

revoke execute on function public.upsert_vouchers(jsonb, text, text) from public, anon, authenticated;
grant execute on function public.upsert_vouchers(jsonb, text, text) to service_role;

-- ============================================================================
-- 2. listings.images
-- ============================================================================
alter table public.listings
  add column if not exists images text[] not null default '{}';

alter table public.listings
  drop constraint if exists listings_images_max;
alter table public.listings
  add constraint listings_images_max check (cardinality(images) <= 12);

-- ============================================================================
-- 3. watch_folders + watches.folder_id
-- ============================================================================
create table if not exists public.watch_folders (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.users(id) on delete cascade,
  name       text not null check (char_length(btrim(name)) between 1 and 40),
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create unique index if not exists watch_folders_user_name on public.watch_folders (user_id, lower(btrim(name)));
create index if not exists idx_watch_folders_user on public.watch_folders (user_id, sort_order);

alter table public.watch_folders enable row level security;

drop policy if exists "watch_folders_owner_all" on public.watch_folders;
create policy "watch_folders_owner_all" on public.watch_folders
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

grant select, insert, update, delete on public.watch_folders to authenticated;

create or replace function public.watch_folders_enforce_limit()
returns trigger
language plpgsql
as $$
begin
  if (select count(*) from watch_folders where user_id = new.user_id) >= 20 then
    raise exception 'Mỗi tài khoản có tối đa 20 thư mục.' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists watch_folders_enforce_limit on public.watch_folders;
create trigger watch_folders_enforce_limit before insert on public.watch_folders
  for each row execute function public.watch_folders_enforce_limit();

alter table public.watches
  add column if not exists folder_id uuid references public.watch_folders(id) on delete set null;
create index if not exists idx_watches_folder on public.watches (folder_id);

-- A watch may only be filed into one of its owner's folders.
create or replace function public.watches_check_folder()
returns trigger
language plpgsql
as $$
begin
  if new.folder_id is not null
     and not exists (select 1 from watch_folders f where f.id = new.folder_id and f.user_id = new.user_id) then
    raise exception 'Thư mục không hợp lệ.' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists watches_check_folder on public.watches;
create trigger watches_check_folder before insert or update of folder_id on public.watches
  for each row execute function public.watches_check_folder();

grant update (folder_id) on public.watches to authenticated;

-- ============================================================================
-- 4. notification_settings: weekly digest
-- ============================================================================
alter table public.notification_settings
  drop constraint if exists notification_settings_frequency_check;
alter table public.notification_settings
  add constraint notification_settings_frequency_check
  check (frequency in ('instant', 'daily_digest', 'weekly_digest'));

-- ISO weekday, Vietnam time: 1 = Thứ Hai … 7 = Chủ nhật.
alter table public.notification_settings
  add column if not exists digest_weekday smallint not null default 1 check (digest_weekday between 1 and 7);

grant update (digest_weekday) on public.notification_settings to authenticated;

-- ============================================================================
-- 5. search_products v5 — marketplace filter
-- ============================================================================
drop function if exists public.search_products(text, uuid, text[], numeric, numeric, text, integer, integer, numeric, boolean, boolean);

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
  p_marketplaces  text[]  default null
) returns table (
  product_id uuid, slug text, canonical_name text, brand text, image text,
  category_slug text, best_price numeric, original_price numeric,
  score smallint, recommendation text, last_observed_at timestamptz,
  relevance real, total_count bigint
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
    select m.id, m.slug, m.canonical_name, m.brand, m.image, m.rel,
           c.slug as category_slug,
           rep.price, rep.original_price, rep.observed_at,
           vds.score, vds.recommendation,
           bo.free_shipping, bo.has_voucher, s.rating as seller_rating
    from matched m
    left join categories c on c.id = m.category_id
    left join lateral (
      select v.id as variant_id, vcp.price, vcp.original_price, vcp.observed_at, vcp.best_offer_id
      from product_variants v
      join variant_current_price vcp on vcp.variant_id = v.id
      where v.product_id = m.id and vcp.price is not null
      order by vcp.in_stock desc, vcp.price asc
      limit 1
    ) rep on true
    left join variant_deal_scores vds on vds.variant_id = rep.variant_id
    left join offers bo   on bo.id = rep.best_offer_id
    left join listings bl on bl.id = bo.listing_id
    left join sellers s   on s.id = bl.seller_id
    where (p_min_price is null or rep.price >= p_min_price)
      and (p_max_price is null or rep.price <= p_max_price)
      and (p_min_rating is null or s.rating >= p_min_rating)
      and (p_free_shipping is null or not p_free_shipping or bo.free_shipping is true)
      and (p_has_voucher is null or not p_has_voucher or bo.has_voucher is true)
  )
  select id, slug, canonical_name, brand, image, category_slug,
         price, original_price, score, recommendation, observed_at,
         rel, count(*) over () as total_count
  from priced
  order by
    case when p_sort = 'price_asc'  then price       end asc  nulls last,
    case when p_sort = 'price_desc' then price       end desc nulls last,
    case when p_sort = 'deal_score' then score       end desc nulls last,
    case when p_sort = 'updated'    then observed_at end desc nulls last,
    case when p_sort = 'relevance'  then rel         end desc nulls last,
    id
  limit p_limit offset p_offset
$$;

drop function if exists public.filter_availability();
create function public.filter_availability()
returns table (rating boolean, free_shipping boolean, voucher boolean, marketplaces text[])
language sql stable as $$
  select exists (select 1 from sellers where rating is not null),
         exists (select 1 from offers where free_shipping is not null),
         exists (select 1 from offers where has_voucher is not null),
         coalesce((select array_agg(distinct l.marketplace order by l.marketplace)
                   from offers o join listings l on l.id = o.listing_id
                   where o.match_status in ('auto', 'manual') and l.status = 'active'), '{}'::text[])
$$;

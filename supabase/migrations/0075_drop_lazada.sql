-- 0075 — Drop Lazada. DealScore compares Shopee and TikTok Shop only (MarketplaceId = 'shopee' | 'tiktok').
-- Lazada never had a data source; its listings could only come from seed data. Nothing is deleted:
--
-- 1. Existing Lazada listings are deactivated the admin way (admin_set_listings_inactive: status 'inactive',
--    deactivated_by 'admin'). offer_is_visible() drops them from the current price, offer_in_history() from
--    the history; the touched variants' rollups are rebuilt and one admin_audit row is written.
-- 2. Saved searches and preferences forget 'lazada'. A saved search that filtered on Lazada only is paused
--    rather than widened to every marketplace (its owner never asked for those alerts).
-- 3. ingest_listing: same as 0022, except the marketplace guard accepts shopee | tiktok only.
-- 4. saved_search_params_valid: same as 0067, except marketplaces accepts shopee | tiktok only.
-- 5. user_preferences.marketplaces: same check as 0015 without 'lazada'.

-- 1 ---------------------------------------------------------------------------
do $$
declare v_ids uuid[];
begin
  select coalesce(array_agg(id order by id), '{}') into v_ids from public.listings where marketplace = 'lazada';
  if cardinality(v_ids) > 0 then
    perform public.admin_set_listings_inactive(v_ids, '0075: Lazada không còn được hỗ trợ');
  end if;
end $$;

-- 2 ---------------------------------------------------------------------------
-- Before section 4: the rewritten params must still pass the current check.
with cleaned as (
  select s.id,
         coalesce((select jsonb_agg(m) from jsonb_array_elements(s.params->'marketplaces') m
                   where (m #>> '{}') <> 'lazada'), '[]'::jsonb) as markets
  from public.saved_searches s
  where jsonb_typeof(s.params->'marketplaces') = 'array' and s.params->'marketplaces' ? 'lazada'
)
update public.saved_searches s
   set params = case when jsonb_array_length(c.markets) = 0 then s.params - 'marketplaces'
                     else jsonb_set(s.params, '{marketplaces}', c.markets) end,
       status = case when jsonb_array_length(c.markets) = 0 then 'paused' else s.status end
  from cleaned c
 where s.id = c.id;

update public.user_preferences
   set marketplaces = array_remove(marketplaces, 'lazada')
 where 'lazada' = any(marketplaces);

-- 3 ---------------------------------------------------------------------------
create or replace function public.ingest_listing(p jsonb)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  c_auto       constant numeric := 0.95;
  c_suggest    constant numeric := 0.5;
  v_market     text := p->>'marketplace';
  v_ext        text := p->>'ext_item_id';
  v_source     text := coalesce(p->>'source', 'api');
  v_base       text := coalesce(nullif(p->>'slug_base', ''), 'san-pham');
  v_priority   integer := coalesce(nullif(p->>'refresh_priority', '')::integer, 1);
  v_draft_key  text := nullif(p->>'draft_key', '');
  v_price0     numeric := nullif(p->'models'->0->>'price', '')::numeric;
  v_cluster    boolean;
  v_now        timestamptz := now();
  v_today      date := (now() at time zone 'Asia/Ho_Chi_Minh')::date;
  v_seller_id  uuid;
  v_listing_id uuid;
  v_product_id uuid;          -- draft product, created lazily
  v_slug       text;
  v_n          integer;
  v_variant_id uuid;
  v_first_variant uuid;
  v_offer_id   uuid;
  v_price      numeric;
  v_stock      integer;
  v_status     text;
  v_conf       numeric;
  v_suggested  uuid;
  v_touched    uuid[] := '{}';
  m            jsonb;
  r            record;
begin
  -- Clustering only for a single priced model: several models = a listing with variants, unsafe to merge.
  v_cluster := v_draft_key is not null
               and jsonb_typeof(p->'models') = 'array'
               and jsonb_array_length(p->'models') = 1
               and v_price0 is not null and v_price0 > 0;

  if v_market is null or v_market not in ('shopee', 'tiktok') then
    raise exception 'ingest_listing: marketplace không hợp lệ (%)', coalesce(v_market, 'null');
  end if;
  if v_priority not between 1 and 3 then
    raise exception 'ingest_listing: refresh_priority phải từ 1 đến 3';
  end if;
  if v_ext is null or coalesce(p->>'title', '') = ''
     or jsonb_typeof(p->'models') <> 'array'
     or jsonb_array_length(p->'models') = 0 then
    raise exception 'ingest_listing: payload thiếu ext_item_id, title hoặc models';
  end if;
  if exists (select 1 from jsonb_array_elements(p->'models') x
             where coalesce(x->>'model_id', '') = '') then
    raise exception 'ingest_listing: model thiếu model_id';
  end if;

  perform pg_advisory_xact_lock(hashtext('ingest:' || v_market || ':' || v_ext));

  select o.variant_id, pr.slug as product_slug, c.slug as category_slug
    into r
  from listings l
  join offers o            on o.listing_id = l.id and o.variant_id is not null
  join product_variants v  on v.id = o.variant_id
  join products pr         on pr.id = v.product_id
  left join categories c   on c.id = pr.category_id
  where l.marketplace = v_market and l.external_item_id = v_ext
  limit 1;

  if found then
    -- A paste of an item found by sourcing upgrades its refresh rate.
    update listings set refresh_priority = least(refresh_priority, v_priority)
    where marketplace = v_market and external_item_id = v_ext;
    return jsonb_build_object('status', 'resolved', 'product_slug', r.product_slug,
                              'category_slug', r.category_slug, 'variant_id', r.variant_id);
  end if;

  insert into sellers as s (marketplace, external_seller_id, name, rating,
                            rating_count, is_official, updated_at)
  values (v_market, p->'seller'->>'external_id', p->'seller'->>'name',
          (p->'seller'->>'rating')::numeric, (p->'seller'->>'rating_count')::integer,
          coalesce((p->'seller'->>'is_official')::boolean, false), v_now)
  on conflict (marketplace, external_seller_id) do update set
    name         = excluded.name,
    rating       = excluded.rating,
    rating_count = excluded.rating_count,
    is_official  = excluded.is_official,
    updated_at   = excluded.updated_at
  returning s.id into v_seller_id;

  insert into listings as l (marketplace, external_item_id, seller_id, title, url,
                             status, refresh_priority, last_observed_at)
  values (v_market, v_ext, v_seller_id, p->>'title', p->>'url', 'active', v_priority, v_now)
  on conflict (marketplace, external_item_id) do update set
    seller_id        = excluded.seller_id,
    title            = excluded.title,
    url              = excluded.url,
    refresh_priority = least(l.refresh_priority, excluded.refresh_priority),
    last_observed_at = excluded.last_observed_at
  returning l.id into v_listing_id;

  for m in select * from jsonb_array_elements(p->'models') loop
    v_variant_id := null;
    v_conf := nullif(m->'match'->>'confidence', '')::numeric;
    v_suggested := null;

    -- The suggested variant must exist and belong to a VERIFIED product — never trust
    -- the payload to attach an offer to a draft.
    if m->'match'->>'variant_id' is not null then
      select pv.id into v_suggested
      from product_variants pv
      join products pr on pr.id = pv.product_id and pr.status = 'verified'
      where pv.id = (m->'match'->>'variant_id')::uuid;
    end if;

    if v_suggested is not null and v_conf >= c_auto then
      v_variant_id := v_suggested;
      v_status := 'auto';
    else
      -- Same unverified product sold by another shop: reuse its draft (spec §2.2).
      if v_product_id is null and v_cluster then
        perform pg_advisory_xact_lock(hashtext('draft:' || v_draft_key));
        select pr.id, fv.id
          into v_product_id, v_variant_id
        from products pr
        join lateral (
          select pv.id from product_variants pv where pv.product_id = pr.id order by pv.id limit 1
        ) fv on true
        -- Lowest / highest latest valid price per visible offer (same rule as refresh_variant_current_price).
        join lateral (
          select min(lt.price) as min_price, max(lt.price) as max_price
          from offers o
          join listings l on l.id = o.listing_id
          join lateral (
            select po.price
            from price_observations po
            where po.offer_id = o.id and po.is_valid and po.price is not null and po.price > 0
            order by po.observed_at desc
            limit 1
          ) lt on true
          where o.variant_id = fv.id
            and offer_is_visible(o.match_status, l.status, 'draft')
        ) band on band.min_price is not null
        where pr.status = 'draft'
          and pr.draft_key = v_draft_key
          and v_price0 between band.max_price * 0.5 and band.min_price * 2
        order by (select count(distinct o2.listing_id)
                  from product_variants pv2 join offers o2 on o2.variant_id = pv2.id
                  where pv2.product_id = pr.id) desc,
                 pr.created_at
        limit 1;

        -- Lock order draft:<key> → product row (same as admin_lock_product). Re-check under the row lock.
        if v_product_id is not null then
          perform 1 from products where id = v_product_id and status = 'draft' for update;
          if not found then
            v_product_id := null;
            v_variant_id := null;
          end if;
        end if;
      end if;

      if v_variant_id is null then
        if v_product_id is null then
          v_n := 1;
          loop
            v_slug := case when v_n = 1 then v_base else v_base || '-' || v_n end;
            begin
              insert into products (canonical_name, status, slug, specs, draft_key)
              values (p->>'title', 'draft', v_slug, '{}'::jsonb, case when v_cluster then v_draft_key end)
              returning id into v_product_id;
              exit;
            exception when unique_violation then
              v_n := v_n + 1;
              if v_n > 1000 then
                raise exception 'ingest_listing: không sinh được slug cho %', v_base;
              end if;
            end;
          end loop;
        end if;

        insert into product_variants (product_id, variant_key, specs)
        values (v_product_id, coalesce(nullif(m->>'name', ''), 'Tiêu chuẩn'), '{}'::jsonb)
        returning id into v_variant_id;
      end if;
      v_status := 'pending';
    end if;

    v_first_variant := coalesce(v_first_variant, v_variant_id);
    v_touched := array_append(v_touched, v_variant_id);

    insert into offers as o (listing_id, external_model_id, variant_id, match_status, match_confidence)
    values (v_listing_id, m->>'model_id', v_variant_id, v_status,
            case when v_status = 'auto' then v_conf end)
    on conflict (listing_id, external_model_id) do update set
      variant_id       = excluded.variant_id,
      match_status     = excluded.match_status,
      match_confidence = excluded.match_confidence
    returning o.id into v_offer_id;

    if v_status = 'pending' and v_suggested is not null and v_conf >= c_suggest
       and not exists (select 1 from match_candidates mc
                       where mc.offer_id = v_offer_id
                         and (mc.decision = 'pending' or mc.decision is null)) then
      insert into match_candidates (offer_id, suggested_variant_id, confidence, reason, decision)
      values (v_offer_id, v_suggested, least(v_conf, 0.9999), m->'match'->>'reason', 'pending');
    end if;

    v_price := (m->>'price')::numeric;
    v_stock := (m->>'stock')::integer;

    if v_price is not null and v_price > 0 then
      insert into price_observations (offer_id, observed_at, price, original_price,
                                      stock, is_flash_sale, is_valid, source)
      values (v_offer_id, v_now, v_price, (m->>'original_price')::numeric, v_stock,
              coalesce((m->>'is_flash_sale')::boolean, false), true, v_source);
    end if;
  end loop;

  perform refresh_variant_current_price(v_touched);
  perform refresh_variant_daily_prices(v_today, v_today, v_touched);

  select pr.slug as product_slug, c.slug as category_slug
    into r
  from product_variants v
  join products pr       on pr.id = v.product_id
  left join categories c on c.id = pr.category_id
  where v.id = v_first_variant;

  return jsonb_build_object('status', 'ingested', 'product_slug', r.product_slug,
                            'category_slug', r.category_slug, 'variant_id', v_first_variant);
end $$;

revoke execute on function public.ingest_listing(jsonb) from public, anon, authenticated;
grant execute on function public.ingest_listing(jsonb) to service_role;

-- 4 ---------------------------------------------------------------------------
create or replace function public.saved_search_params_valid(p jsonb)
returns boolean
language plpgsql immutable
set search_path = public
as $$
declare
  k text;
begin
  -- Step by step (not one boolean expression): jsonb_array_length / casts must never see the wrong type.
  if p is null or jsonb_typeof(p) <> 'object' then return false; end if;
  for k in select jsonb_object_keys(p) loop
    if k not in ('q','categorySlug','brands','minPrice','maxPrice','marketplaces','capacityGb',
                 'onlyBuy','freeShipping','hasVoucher','minRating') then
      return false;
    end if;
  end loop;
  -- must narrow: a price ceiling or "Nên mua" only
  if not ((p ? 'maxPrice') or coalesce((p->'onlyBuy') = 'true'::jsonb, false)) then return false; end if;
  -- must scope: text, category or brand
  if not ((p ? 'q') or (p ? 'categorySlug') or (p ? 'brands')) then return false; end if;
  if p ? 'q' then
    if jsonb_typeof(p->'q') <> 'string' or char_length(btrim(p->>'q')) not between 1 and 100 then return false; end if;
  end if;
  if p ? 'categorySlug' then
    if jsonb_typeof(p->'categorySlug') <> 'string' or char_length(p->>'categorySlug') not between 1 and 80 then
      return false;
    end if;
  end if;
  if p ? 'brands' then
    if jsonb_typeof(p->'brands') <> 'array' or jsonb_array_length(p->'brands') not between 1 and 10 then return false; end if;
    if exists (select 1 from jsonb_array_elements(p->'brands') b
               where jsonb_typeof(b) <> 'string' or char_length(btrim(b #>> '{}')) not between 1 and 60) then
      return false;
    end if;
  end if;
  if p ? 'marketplaces' then
    if jsonb_typeof(p->'marketplaces') <> 'array' or jsonb_array_length(p->'marketplaces') not between 1 and 3 then
      return false;
    end if;
    if exists (select 1 from jsonb_array_elements(p->'marketplaces') m
               where jsonb_typeof(m) <> 'string' or (m #>> '{}') not in ('shopee','tiktok')) then
      return false;
    end if;
  end if;
  if p ? 'minPrice' then
    if jsonb_typeof(p->'minPrice') <> 'number' or (p->>'minPrice')::numeric < 0 then return false; end if;
  end if;
  if p ? 'maxPrice' then
    if jsonb_typeof(p->'maxPrice') <> 'number' or (p->>'maxPrice')::numeric <= 0 then return false; end if;
  end if;
  if p ? 'minPrice' and p ? 'maxPrice' then
    if (p->>'minPrice')::numeric > (p->>'maxPrice')::numeric then return false; end if;
  end if;
  if p ? 'capacityGb' then
    if jsonb_typeof(p->'capacityGb') <> 'number' or (p->>'capacityGb')::numeric not between 1 and 65536
       or (p->>'capacityGb')::numeric <> trunc((p->>'capacityGb')::numeric) then
      return false;
    end if;
  end if;
  if p ? 'minRating' then
    if jsonb_typeof(p->'minRating') <> 'number' or (p->>'minRating')::numeric not in (4.5, 4.8) then return false; end if;
  end if;
  if p ? 'onlyBuy' and (p->'onlyBuy') <> 'true'::jsonb then return false; end if;
  if p ? 'freeShipping' and (p->'freeShipping') <> 'true'::jsonb then return false; end if;
  if p ? 'hasVoucher' and (p->'hasVoucher') <> 'true'::jsonb then return false; end if;
  return pg_column_size(p) <= 2048;
end $$;

-- 5 ---------------------------------------------------------------------------
alter table public.user_preferences drop constraint if exists user_preferences_marketplaces_check;
alter table public.user_preferences
  add constraint user_preferences_marketplaces_check check (marketplaces <@ array['shopee', 'tiktok']::text[]);

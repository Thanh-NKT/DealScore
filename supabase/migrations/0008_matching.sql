-- 0008_matching.sql: product matching v0 (1.9)
--
-- 1. refresh_variant_current_price(): the §6 collector contract in one place — cheapest in-stock
--    visible offer, else the most recent one marked out of stock.
-- 2. ingest_shopee_item(): each model may carry a matcher result computed by the app
--    (src/lib/matching). confidence ≥ 0.95 on a VERIFIED variant → attached automatically;
--    anything else → draft product as before, plus a match_candidates suggestion when ≥ 0.5.

-- ============================================================================
-- 1. refresh_variant_current_price
-- ============================================================================

create or replace function public.refresh_variant_current_price(p_variant_ids uuid[])
returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_variant_ids is null or cardinality(p_variant_ids) = 0 then
    return;
  end if;

  -- Visible offer = not rejected, listing still active. Latest valid observation per offer.
  with latest as (
    select distinct on (po.offer_id)
           o.variant_id, po.offer_id, po.price, po.original_price, po.stock,
           po.is_flash_sale, po.observed_at
    from offers o
    join listings l          on l.id = o.listing_id and l.status = 'active'
    join price_observations po on po.offer_id = o.id and po.is_valid
                              and po.price is not null and po.price > 0
    where o.variant_id = any(p_variant_ids)
      and o.match_status <> 'rejected'
    order by po.offer_id, po.observed_at desc
  ),
  ranked as (
    select latest.*,
           count(*) over (partition by variant_id) as n_offers,
           row_number() over (
             partition by variant_id
             order by (coalesce(stock, 1) > 0) desc,
                      case when coalesce(stock, 1) > 0 then price end asc nulls last,
                      observed_at desc
           ) as rn
    from latest
  )
  insert into variant_current_price as t (variant_id, best_offer_id, price, original_price,
                                          is_flash_sale, in_stock, offer_count, observed_at)
  select variant_id, offer_id, price, original_price, is_flash_sale,
         coalesce(stock, 1) > 0, n_offers, observed_at
  from ranked
  where rn = 1
  on conflict (variant_id) do update set
    best_offer_id  = excluded.best_offer_id,
    price          = excluded.price,
    original_price = excluded.original_price,
    is_flash_sale  = excluded.is_flash_sale,
    in_stock       = excluded.in_stock,
    offer_count    = excluded.offer_count,
    observed_at    = excluded.observed_at;

  -- No visible offer with an observation left → no current price.
  delete from variant_current_price vcp
  where vcp.variant_id = any(p_variant_ids)
    and not exists (
      select 1
      from offers o
      join listings l on l.id = o.listing_id and l.status = 'active'
      join price_observations po on po.offer_id = o.id and po.is_valid
                                and po.price is not null and po.price > 0
      where o.variant_id = vcp.variant_id and o.match_status <> 'rejected'
    );
end $$;

revoke execute on function public.refresh_variant_current_price(uuid[]) from public, anon, authenticated;
grant execute on function public.refresh_variant_current_price(uuid[]) to service_role;

-- ============================================================================
-- 2. ingest_shopee_item with matcher results
-- ============================================================================
--
-- Payload (jsonb): as in 0004, and each model may add
--   match: { variant_id, confidence, reason }
--
-- Returns: { status: 'resolved'|'ingested', product_slug, category_slug, variant_id }
-- variant_id / slugs are those of the FIRST model's variant (auto-matched or draft).
create or replace function public.ingest_shopee_item(p jsonb)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  c_auto       constant numeric := 0.95;
  c_suggest    constant numeric := 0.5;
  v_ext        text := p->>'ext_item_id';
  v_source     text := coalesce(p->>'source', 'api');
  v_base       text := coalesce(nullif(p->>'slug_base', ''), 'san-pham');
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
  if v_ext is null or coalesce(p->>'title', '') = ''
     or jsonb_typeof(p->'models') <> 'array'
     or jsonb_array_length(p->'models') = 0 then
    raise exception 'ingest_shopee_item: payload thiếu ext_item_id, title hoặc models';
  end if;
  if exists (select 1 from jsonb_array_elements(p->'models') x
             where coalesce(x->>'model_id', '') = '') then
    raise exception 'ingest_shopee_item: model thiếu model_id';
  end if;

  perform pg_advisory_xact_lock(hashtext('ingest:shopee:' || v_ext));

  select o.variant_id, pr.slug as product_slug, c.slug as category_slug
    into r
  from listings l
  join offers o            on o.listing_id = l.id and o.variant_id is not null
  join product_variants v  on v.id = o.variant_id
  join products pr         on pr.id = v.product_id
  left join categories c   on c.id = pr.category_id
  where l.marketplace = 'shopee' and l.external_item_id = v_ext
  limit 1;

  if found then
    return jsonb_build_object('status', 'resolved', 'product_slug', r.product_slug,
                              'category_slug', r.category_slug, 'variant_id', r.variant_id);
  end if;

  insert into sellers as s (marketplace, external_seller_id, name, rating,
                            rating_count, is_official, updated_at)
  values ('shopee', p->'seller'->>'external_id', p->'seller'->>'name',
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
  values ('shopee', v_ext, v_seller_id, p->>'title', p->>'url', 'active', 1, v_now)
  on conflict (marketplace, external_item_id) do update set
    seller_id        = excluded.seller_id,
    title            = excluded.title,
    url              = excluded.url,
    refresh_priority = 1,
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
      if v_product_id is null then
        v_n := 1;
        loop
          v_slug := case when v_n = 1 then v_base else v_base || '-' || v_n end;
          begin
            insert into products (canonical_name, status, slug, specs)
            values (p->>'title', 'draft', v_slug, '{}'::jsonb)
            returning id into v_product_id;
            exit;
          exception when unique_violation then
            v_n := v_n + 1;
            if v_n > 1000 then
              raise exception 'ingest_shopee_item: không sinh được slug cho %', v_base;
            end if;
          end;
        end loop;
      end if;

      insert into product_variants (product_id, variant_key, specs)
      values (v_product_id, coalesce(nullif(m->>'name', ''), 'Tiêu chuẩn'), '{}'::jsonb)
      returning id into v_variant_id;
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
  perform refresh_variant_daily_prices(v_today, v_today);

  select pr.slug as product_slug, c.slug as category_slug
    into r
  from product_variants v
  join products pr       on pr.id = v.product_id
  left join categories c on c.id = pr.category_id
  where v.id = v_first_variant;

  return jsonb_build_object('status', 'ingested', 'product_slug', r.product_slug,
                            'category_slug', r.category_slug, 'variant_id', v_first_variant);
end $$;

revoke execute on function public.ingest_shopee_item(jsonb) from public, anon, authenticated;
grant execute on function public.ingest_shopee_item(jsonb) to service_role;

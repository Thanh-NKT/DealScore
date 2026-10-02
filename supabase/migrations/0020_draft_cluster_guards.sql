-- 0020 — draft clustering guards (final review of spec 2026-10-01-tu-tim-theo-nhu-cau-gom-ban-nhap-logic).
--   1. ingest_listing v3: same as 0019, except the cluster price band is anchored on the whole cluster —
--      the new price must be within ×2 of both the lowest and the highest latest valid offer price of the
--      draft's first variant (0019 compared to variant_current_price, the cluster minimum, which drifts
--      down with every cheap member). A cluster already spread over ×4 accepts nobody.
--   2. search_products v9: same as v8 (0019); the "≥ 2 active listings" check on drafts stops at the
--      second listing instead of counting them all.

-- 1 ---------------------------------------------------------------------------
-- ingest_listing v3: same as 0019, only the cluster select changes.
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

  if v_market is null or v_market not in ('shopee', 'tiktok', 'lazada') then
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
          from (
            select distinct on (po.offer_id) po.price
            from offers o
            join listings l            on l.id = o.listing_id and l.status = 'active'
            join price_observations po on po.offer_id = o.id and po.is_valid
                                      and po.price is not null and po.price > 0
            where o.variant_id = fv.id
              and o.match_status <> 'rejected'
            order by po.offer_id, po.observed_at desc
          ) lt
        ) band on band.min_price is not null
        where pr.status = 'draft'
          and pr.draft_key = v_draft_key
          and v_price0 between band.max_price * 0.5 and band.min_price * 2
        order by (select count(distinct o2.listing_id)
                  from product_variants pv2 join offers o2 on o2.variant_id = pv2.id
                  where pv2.product_id = pr.id) desc,
                 pr.created_at
        limit 1;
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

revoke execute on function public.ingest_listing(jsonb) from public, anon, authenticated;
grant execute on function public.ingest_listing(jsonb) to service_role;


-- 2 ---------------------------------------------------------------------------
-- search_products v9: same parameters, result and behaviour as v8 (0019).
drop function if exists public.search_products(text, uuid, text[], numeric, numeric, text, integer, integer, numeric, boolean, boolean, text[], integer, text[]);

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
  relevance real, total_count bigint, effective_price numeric, variant_id uuid
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
      -- Drafts only once at least two shops sell them (spec §2.3): a lone draft is noise.
      and (p.status = 'verified' or (
             select count(*) from (
               select distinct l.id
               from product_variants v
               join offers o   on o.variant_id = v.id
               join listings l on l.id = o.listing_id and l.status = 'active'
               where v.product_id = p.id
               limit 2) two) >= 2)
  ),
  priced as (
    select m.id, m.slug, m.canonical_name, m.brand, m.image,
           -- Boost: + 0.5 × share of the non-empty boost terms found in search_text (already unaccented,
           -- lowercase). strpos, not LIKE: '%' / '_' in a term are plain characters.
           (m.rel + coalesce((
              select 0.5 * (count(*) filter (where strpos(m.search_text, bt.term) > 0))::real / nullif(count(*), 0)
              from (select btrim(lower(public.f_unaccent(t))) as term from unnest(p_boost_terms) t) bt
              where bt.term <> ''
            ), 0)
            + case when m.status = 'verified' then 0.25 else 0 end)::real as rel,
           c.slug as category_slug,
           rep.variant_id, rep.price, rep.original_price, rep.observed_at,
           vds.score, vds.recommendation,
           bo.free_shipping, bo.has_voucher, s.rating as seller_rating,
           -- Shown only when it still describes the current price: lower than it, computed from the
           -- representative's current observation or later (a newer observation = the price changed
           -- since), within 7 days, and before any voucher of the combination expires.
           case when bo.effective_price < rep.price
                 and bo.effective_price_at >= rep.observed_at
                 and bo.effective_price_at > now() - interval '7 days'
                 and (bo.effective_price_until is null or bo.effective_price_until > now())
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
         rel, count(*) over () as total_count, effective_price, variant_id
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

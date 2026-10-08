-- 0045 — P2 review M8: the price a data report records (`seen_price`) and the offer's current price in
-- the admin queue (`admin_data_reports.current_price`) no longer bypass the extension corroboration gate.
--
-- 1. offer_latest_trusted_observation(p_offer_id): the offer's latest valid, priced observation under the
--    same rule as refresh_variant_current_price (0028) — an extension-sourced observation counts only once a
--    trusted (non-extension) observation of the same offer agrees within 24h and 2%
--    (TOLERANCE / WINDOW_HOURS in src/lib/extension/corroborate.ts — keep in sync).
-- 2. submit_data_report: same as 0043, but seen_price reads the helper.
-- 3. admin_data_reports: same as 0043, but current_price / current_observed_at read the helper.
-- Signatures and grants are unchanged.

-- 1 ---------------------------------------------------------------------------
create or replace function public.offer_latest_trusted_observation(p_offer_id uuid)
returns table (price numeric, observed_at timestamptz)
language sql stable set search_path = public as $$
  select po.price, po.observed_at
  from price_observations po
  where po.offer_id = p_offer_id and po.is_valid and po.price is not null and po.price > 0
    -- Extension prices come from users' browsers: only once a trusted observation agrees.
    and (po.source <> 'extension' or exists (
          select 1 from price_observations t
          where t.offer_id = po.offer_id
            and t.source <> 'extension'
            and t.is_valid and t.price is not null and t.price > 0
            and t.observed_at between po.observed_at - interval '24 hours'
                                  and po.observed_at + interval '24 hours'
            and abs(t.price - po.price) <= 0.02 * greatest(t.price, po.price)))
  order by po.observed_at desc
  limit 1
$$;
revoke execute on function public.offer_latest_trusted_observation(uuid) from public, anon, authenticated;
grant execute on function public.offer_latest_trusted_observation(uuid) to service_role;

-- 2 ---------------------------------------------------------------------------
create or replace function public.submit_data_report(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uuid_re    constant text := '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
  v_product    uuid;
  v_variant    uuid;
  v_offer      uuid;
  v_user       uuid;
  v_kind       text := p->>'kind';
  v_message    text := nullif(btrim(coalesce(p->>'message', '')), '');
  v_hours      integer := least(greatest(coalesce((p->>'dedup_hours')::integer, 24), 1), 168);
  v_offer_var  uuid;
  v_seen       numeric;
  v_existing   uuid;
  v_id         uuid;
begin
  if coalesce(p->>'product_id', '') !~ v_uuid_re
     or (p ? 'variant_id' and p->>'variant_id' is not null and p->>'variant_id' !~ v_uuid_re)
     or (p ? 'offer_id' and p->>'offer_id' is not null and p->>'offer_id' !~ v_uuid_re)
     or (p ? 'user_id' and p->>'user_id' is not null and p->>'user_id' !~ v_uuid_re) then
    raise exception 'submit_data_report: mã không hợp lệ';
  end if;
  v_product := (p->>'product_id')::uuid;
  v_variant := (p->>'variant_id')::uuid;
  v_offer   := (p->>'offer_id')::uuid;
  v_user    := (p->>'user_id')::uuid;

  if v_kind is null or v_kind not in ('wrong_price', 'wrong_match', 'stock', 'other') then
    raise exception 'submit_data_report: loại góp ý không hợp lệ';
  end if;
  if v_message is not null and char_length(v_message) > 500 then
    raise exception 'submit_data_report: mô tả dài quá 500 ký tự';
  end if;
  if v_kind = 'other' and v_message is null then
    raise exception 'submit_data_report: cần mô tả cho góp ý loại Khác';
  end if;

  if not exists (select 1 from products where id = v_product) then
    raise exception 'submit_data_report: sản phẩm không tồn tại';
  end if;
  if v_variant is not null
     and not exists (select 1 from product_variants where id = v_variant and product_id = v_product) then
    raise exception 'submit_data_report: phân loại không thuộc sản phẩm này';
  end if;
  if v_offer is not null then
    select o.variant_id into v_offer_var
    from offers o join product_variants v on v.id = o.variant_id
    where o.id = v_offer and v.product_id = v_product;
    if v_offer_var is null or (v_variant is not null and v_offer_var <> v_variant) then
      raise exception 'submit_data_report: tin bán không thuộc sản phẩm này';
    end if;
  end if;

  -- What the reporter was looking at: the offer's latest trusted price (0045 gate), else the variant's
  -- current price (already gated by refresh_variant_current_price).
  if v_offer is not null then
    select t.price into v_seen from offer_latest_trusted_observation(v_offer) t;
  end if;
  if v_seen is null and v_variant is not null then
    select vcp.price into v_seen from variant_current_price vcp where vcp.variant_id = v_variant;
  end if;

  -- Members: one open report per (product, kind, offer) per window. Guests are never de-duplicated
  -- (nothing identifies them here); their volume is capped by the action's rate limits.
  if v_user is not null then
    perform pg_advisory_xact_lock(hashtext('data_report:' || v_user::text || ':' || v_product::text || ':' || v_kind));
    select r.id into v_existing
    from data_reports r
    where r.user_id = v_user
      and r.product_id = v_product
      and r.kind = v_kind
      and r.offer_id is not distinct from v_offer
      and r.status = 'open'
      and r.created_at > now() - make_interval(hours => v_hours)
    order by r.created_at desc
    limit 1;
    if v_existing is not null then
      return jsonb_build_object('id', v_existing, 'duplicate', true);
    end if;
  end if;

  insert into data_reports (product_id, variant_id, offer_id, kind, message, seen_price, user_id)
  values (v_product, v_variant, v_offer, v_kind, v_message, v_seen, v_user)
  returning id into v_id;

  return jsonb_build_object('id', v_id, 'duplicate', false);
end $$;

-- 3 ---------------------------------------------------------------------------
create or replace function public.admin_data_reports(
  p_status     text    default 'open',
  p_kind       text    default null,
  p_product_id uuid    default null,
  p_limit      integer default 50,
  p_offset     integer default 0
) returns table (
  id uuid, created_at timestamptz, kind text, status text, message text, reporter text, seen_price numeric,
  product_id uuid, product_name text, product_slug text, product_status text, category_slug text,
  variant_id uuid, variant_key text, offer_id uuid, listing_id uuid, marketplace text, listing_title text,
  listing_url text, listing_status text, seller_name text, current_price numeric, current_observed_at timestamptz,
  same_open_count integer, reviewed_at timestamptz, review_note text, total_count bigint
) language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
begin
  if p_status is null or p_status not in ('open', 'resolved', 'dismissed', 'all')
     or (p_kind is not null and p_kind not in ('wrong_price', 'wrong_match', 'stock', 'other')) then
    raise exception 'admin_data_reports: bộ lọc không hợp lệ';
  end if;

  return query
  with picked as (
    select r.*,
           (select count(*)::integer from data_reports o
            where o.status = 'open' and o.product_id = r.product_id and o.kind = r.kind and o.id <> r.id) as same_open,
           count(*) over () as total
    from data_reports r
    where (p_status = 'all' or r.status = p_status)
      and (p_kind is null or r.kind = p_kind)
      and (p_product_id is null or r.product_id = p_product_id)
  ),
  page as (
    select * from picked pk
    order by (pk.status = 'open') desc,
             case when pk.status = 'open' then pk.same_open end desc nulls last,
             case when pk.status = 'open' then pk.created_at end asc nulls last,
             case when pk.status <> 'open' then coalesce(pk.reviewed_at, pk.created_at) end desc nulls last,
             pk.id
    limit least(greatest(coalesce(p_limit, 50), 1), 100)
    offset least(greatest(coalesce(p_offset, 0), 0), 100000)
  )
  select pg.id, pg.created_at, pg.kind, pg.status, pg.message,
         case when pg.user_id is null then 'guest' else 'member' end,
         pg.seen_price,
         pr.id, pr.canonical_name, pr.slug, pr.status, c.slug,
         pv.id, pv.variant_key,
         pg.offer_id, l.id, l.marketplace, l.title, l.url, l.status, s.name,
         cur.price, cur.observed_at,
         pg.same_open, pg.reviewed_at, pg.review_note, pg.total
  from page pg
  join products pr on pr.id = pg.product_id
  left join categories c on c.id = pr.category_id
  left join product_variants pv on pv.id = pg.variant_id
  left join offers o on o.id = pg.offer_id
  left join listings l on l.id = o.listing_id
  left join sellers s on s.id = l.seller_id
  left join lateral (
    select t.price, t.observed_at from offer_latest_trusted_observation(pg.offer_id) t
    where pg.offer_id is not null
  ) cur on true
  order by (pg.status = 'open') desc,
           case when pg.status = 'open' then pg.same_open end desc nulls last,
           case when pg.status = 'open' then pg.created_at end asc nulls last,
           case when pg.status <> 'open' then coalesce(pg.reviewed_at, pg.created_at) end desc nulls last,
           pg.id;
end $$;

-- Grants unchanged (create or replace keeps them); restated for a fresh database.
revoke execute on function public.submit_data_report(jsonb),
                           public.admin_data_reports(text, text, uuid, integer, integer)
  from public, anon, authenticated;
grant execute on function public.submit_data_report(jsonb),
                          public.admin_data_reports(text, text, uuid, integer, integer)
  to service_role;

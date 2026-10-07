-- 0043 — "Góp ý dữ liệu" (roadmap P2 item 6): user reports about wrong data, and the admin review queue.
--
-- 1. data_reports: one row per report. No IP or IP hash is stored (the rate-limit key hash lives only in
--    rate_counters, see src/actions/report.ts). RLS on, no policy, nothing granted to anon / authenticated:
--    every read and write goes through the service-role RPCs below.
-- 2. submit_data_report(p jsonb): checks product / variant / offer belong together, records the price the
--    reporter saw, and de-duplicates a member's repeated report (same product, kind, offer) inside a window.
-- 3. Admin RPCs (Admin-DealScore "/reports"): admin_data_reports (paged list, reporter shown only as
--    member / guest), admin_data_report_counts, admin_resolve_data_reports (one admin_audit row per changed
--    report, in the same transaction). All service_role only.

-- 1 ---------------------------------------------------------------------------
create table if not exists public.data_reports (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  product_id  uuid not null references public.products(id) on delete cascade,
  variant_id  uuid references public.product_variants(id) on delete set null,
  offer_id    uuid references public.offers(id) on delete set null,
  kind        text not null check (kind in ('wrong_price', 'wrong_match', 'stock', 'other')),
  message     text check (char_length(message) <= 500),
  seen_price  numeric(14,2),
  user_id     uuid references public.users(id) on delete set null,
  status      text not null default 'open' check (status in ('open', 'resolved', 'dismissed')),
  reviewed_at timestamptz,
  review_note text check (char_length(review_note) <= 500)
);

create index if not exists data_reports_status_created_idx on public.data_reports (status, created_at desc);
create index if not exists data_reports_open_product_kind_idx on public.data_reports (product_id, kind) where status = 'open';
-- Dedup lookup and account export / erasure by user.
create index if not exists data_reports_user_idx on public.data_reports (user_id) where user_id is not null;

alter table public.data_reports enable row level security;
revoke all on public.data_reports from anon, authenticated;

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

  -- What the reporter was looking at: the offer's latest valid price, else the variant's current price.
  if v_offer is not null then
    select po.price into v_seen
    from price_observations po
    where po.offer_id = v_offer and po.is_valid and po.price is not null
    order by po.observed_at desc
    limit 1;
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
    select po.price, po.observed_at
    from price_observations po
    where pg.offer_id is not null and po.offer_id = pg.offer_id and po.is_valid
    order by po.observed_at desc
    limit 1
  ) cur on true
  order by (pg.status = 'open') desc,
           case when pg.status = 'open' then pg.same_open end desc nulls last,
           case when pg.status = 'open' then pg.created_at end asc nulls last,
           case when pg.status <> 'open' then coalesce(pg.reviewed_at, pg.created_at) end desc nulls last,
           pg.id;
end $$;

create or replace function public.admin_data_report_counts()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'open', count(*) filter (where status = 'open'),
    'open_by_kind', jsonb_build_object(
      'wrong_price', count(*) filter (where status = 'open' and kind = 'wrong_price'),
      'wrong_match', count(*) filter (where status = 'open' and kind = 'wrong_match'),
      'stock',       count(*) filter (where status = 'open' and kind = 'stock'),
      'other',       count(*) filter (where status = 'open' and kind = 'other')),
    'resolved_7d',  count(*) filter (where status = 'resolved' and reviewed_at > now() - interval '7 days'),
    'dismissed_7d', count(*) filter (where status = 'dismissed' and reviewed_at > now() - interval '7 days'),
    'oldest_open_at', min(created_at) filter (where status = 'open'))
  from data_reports
$$;

create or replace function public.admin_resolve_data_reports(p_ids uuid[], p_status text, p_note text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_note   text := nullif(btrim(coalesce(p_note, '')), '');
  v_ids    uuid[];
  v_action text;
  v_row    data_reports%rowtype;
  v_after  data_reports%rowtype;
  v_done   uuid[] := '{}';
begin
  if p_status is null or p_status not in ('resolved', 'dismissed', 'open') then
    raise exception 'admin_resolve_data_reports: trạng thái không hợp lệ';
  end if;
  if p_ids is null or coalesce(cardinality(p_ids), 0) < 1 or cardinality(p_ids) > 100 then
    raise exception 'admin_resolve_data_reports: chọn từ 1 đến 100 góp ý';
  end if;
  if v_note is not null and char_length(v_note) > 500 then
    raise exception 'admin_resolve_data_reports: ghi chú dài quá 500 ký tự';
  end if;
  v_ids := array(select distinct x from unnest(p_ids) x where x is not null);
  v_action := case p_status when 'resolved' then 'data_report.resolve'
                            when 'dismissed' then 'data_report.dismiss'
                            else 'data_report.reopen' end;

  for v_row in
    select * from data_reports where id = any(v_ids) order by id for update
  loop
    continue when v_row.status = p_status; -- repeating an action is a no-op: no write, no audit row
    update data_reports set
      status      = p_status,
      reviewed_at = case when p_status = 'open' then null else now() end,
      review_note = case when p_status = 'open' and v_note is null then v_row.review_note else v_note end
    where id = v_row.id
    returning * into v_after;
    perform admin_log(v_action, 'data_report', v_row.id::text,
      jsonb_build_object('status', v_row.status, 'review_note', v_row.review_note,
                         'product_id', v_row.product_id, 'kind', v_row.kind),
      jsonb_build_object('status', v_after.status, 'review_note', v_after.review_note,
                         'product_id', v_after.product_id, 'kind', v_after.kind),
      v_note);
    v_done := v_done || v_row.id;
  end loop;

  return jsonb_build_object('updated', cardinality(v_done),
                            'skipped', cardinality(v_ids) - cardinality(v_done),
                            'ids', to_jsonb(v_done));
end $$;

revoke execute on function public.submit_data_report(jsonb),
                           public.admin_data_reports(text, text, uuid, integer, integer),
                           public.admin_data_report_counts(),
                           public.admin_resolve_data_reports(uuid[], text, text)
  from public, anon, authenticated;
grant execute on function public.submit_data_report(jsonb),
                          public.admin_data_reports(text, text, uuid, integer, integer),
                          public.admin_data_report_counts(),
                          public.admin_resolve_data_reports(uuid[], text, text)
  to service_role;

-- ============================================================================
-- 0004 — Siết quyền ghi, ingest nguyên tử, rate limit nguyên tử, search dùng index
--
-- 1. Quyền. Supabase mặc định cấp ALL trên mọi bảng trong schema public cho
--    anon/authenticated. Bảng nào không bật RLS thì anon key (công khai trong
--    browser) ghi được thẳng — kể cả affiliate_offers.short_link, tức là chiếm
--    được đích redirect của /go. Catalog chỉ được ghi qua service role.
-- 2. ingest_shopee_item(): toàn bộ ingest trong MỘT transaction (spec §11).
-- 3. lookup_begin() / lookup_begin_ingest(): kiểm hạn mức + ghi nhận nguyên tử.
-- 4. search_products(): lọc sơ bộ bằng index, giá và điểm lấy từ CÙNG một
--    variant, brand so khớp không phân biệt hoa thường.
-- ============================================================================

-- ============================================================================
-- 1. Quyền
-- ============================================================================

-- Bảng catalog / giá / vận hành: chỉ đọc với anon & authenticated.
revoke insert, update, delete, truncate, references, trigger
  on public.products, public.product_variants, public.sellers, public.listings,
     public.offers, public.price_observations, public.match_candidates,
     public.affiliate_offers, public.conversions, public.collector_runs,
     public.categories, public.variant_current_price,
     public.variant_daily_prices, public.variant_deal_scores,
     public.lookup_requests
  from anon, authenticated;

-- Dữ liệu nội bộ, không có lý do gì để public đọc.
revoke select on public.conversions, public.collector_runs, public.match_candidates,
                 public.lookup_requests
  from anon, authenticated;

-- affiliate_offers: trang sản phẩm chỉ cần biết offer có đủ điều kiện affiliate
-- hay không. Link affiliate, hoa hồng, campaign chỉ /go (service role) đọc.
revoke select on public.affiliate_offers from anon, authenticated;
grant select (offer_id, eligible) on public.affiliate_offers to anon, authenticated;

-- Bảng TẠO SAU migration này cũng không tự động mở quyền ghi cho anon.
-- Hệ quả: bảng thuộc người dùng mới (kiểu watches) phải GRANT tường minh
-- quyền ghi cho authenticated, cùng với policy RLS.
alter default privileges in schema public
  revoke insert, update, delete, truncate, references, trigger on tables
  from anon, authenticated;

-- Hàm security definer chạy bằng quyền chủ sở hữu — không để anon gọi.
-- (Postgres mặc định cấp EXECUTE cho PUBLIC.)
revoke execute on function public.refresh_variant_daily_prices(date, date)
  from public, anon, authenticated;
grant execute on function public.refresh_variant_daily_prices(date, date)
  to service_role;

-- ============================================================================
-- 2. Ràng buộc dữ liệu cho ingest
-- ============================================================================

-- Mỗi model của một listing là MỘT offer. Thiếu ràng buộc này thì mỗi lần
-- ingest lại một listing sinh thêm offer trùng.
create unique index if not exists uq_offers_listing_model
  on public.offers (listing_id, external_model_id);

-- 'seed' = dữ liệu không có thật (seed-dev, Shopee client giả lập ở dev).
-- Tách khỏi 'api' để không bao giờ lẫn với giá thật khi phân tích.
alter table public.price_observations
  drop constraint if exists price_observations_source_check;
alter table public.price_observations
  add constraint price_observations_source_check
  check (source in ('api', 'extension', 'seed'));

-- ============================================================================
-- 3. ingest_shopee_item — toàn bộ ingest trong một transaction
-- ============================================================================
--
-- Payload (jsonb):
--   { ext_item_id, url, title, slug_base, source: 'api'|'seed',
--     seller: { external_id, name, rating, rating_count, is_official },
--     models: [ { model_id, name, price, original_price, stock, is_flash_sale } ] }
--
-- slug_base do tầng ứng dụng sinh bằng slugify() — cùng một hàm bỏ dấu tiếng
-- Việt với mọi slug khác của hệ thống.
--
-- Trả về: { status: 'resolved'|'ingested', product_slug, category_slug, variant_id }
--
-- Chưa làm matcher v0 (spec §11 bước 7): mọi offer đi thẳng vào product
-- draft (bước 8). Admin (1.8) sẽ merge draft vào product đã verify.
create or replace function public.ingest_shopee_item(p jsonb)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_ext        text := p->>'ext_item_id';
  v_source     text := coalesce(p->>'source', 'api');
  v_base       text := coalesce(nullif(p->>'slug_base', ''), 'san-pham');
  v_now        timestamptz := now();
  v_today      date := (now() at time zone 'Asia/Ho_Chi_Minh')::date;
  v_seller_id  uuid;
  v_listing_id uuid;
  v_product_id uuid;
  v_slug       text;
  v_n          integer := 1;
  v_variant_id uuid;
  v_first_variant uuid;
  v_offer_id   uuid;
  v_price      numeric;
  v_stock      integer;
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

  -- Hai request đồng thời cho cùng một item: request sau chờ request trước
  -- xong rồi đi nhánh 'resolved' bên dưới, không tạo product trùng.
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

  -- Slug chống trùng. Bắt unique_violation thay vì kiểm-rồi-chèn: hai item
  -- khác nhau cùng tiêu đề có thể ingest đồng thời.
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

  for m in select * from jsonb_array_elements(p->'models') loop
    insert into product_variants (product_id, variant_key, specs)
    values (v_product_id, coalesce(nullif(m->>'name', ''), 'Tiêu chuẩn'), '{}'::jsonb)
    returning id into v_variant_id;
    v_first_variant := coalesce(v_first_variant, v_variant_id);

    -- Offer có thể đã tồn tại mà chưa ghép variant (vd admin từ chối ghép):
    -- gắn nó vào variant draft mới thay vì tạo offer thứ hai.
    insert into offers as o (listing_id, external_model_id, variant_id, match_status)
    values (v_listing_id, m->>'model_id', v_variant_id, 'pending')
    on conflict (listing_id, external_model_id) do update set
      variant_id   = excluded.variant_id,
      match_status = 'pending'
    returning o.id into v_offer_id;

    v_price := (m->>'price')::numeric;
    v_stock := (m->>'stock')::integer;

    if v_price is not null and v_price > 0 then
      insert into price_observations (offer_id, observed_at, price, original_price,
                                      stock, is_flash_sale, is_valid, source)
      values (v_offer_id, v_now, v_price, (m->>'original_price')::numeric, v_stock,
              coalesce((m->>'is_flash_sale')::boolean, false), true, v_source);

      insert into variant_current_price as t (variant_id, best_offer_id, price,
                                              original_price, is_flash_sale, in_stock,
                                              offer_count, observed_at)
      values (v_variant_id, v_offer_id, v_price, (m->>'original_price')::numeric,
              coalesce((m->>'is_flash_sale')::boolean, false),
              coalesce(v_stock, 1) > 0, 1, v_now)
      on conflict (variant_id) do update set
        best_offer_id  = excluded.best_offer_id,
        price          = excluded.price,
        original_price = excluded.original_price,
        is_flash_sale  = excluded.is_flash_sale,
        in_stock       = excluded.in_stock,
        offer_count    = excluded.offer_count,
        observed_at    = excluded.observed_at;
    end if;
  end loop;

  perform refresh_variant_daily_prices(v_today, v_today);

  return jsonb_build_object('status', 'ingested', 'product_slug', v_slug,
                            'category_slug', null, 'variant_id', v_first_variant);
end $$;

revoke execute on function public.ingest_shopee_item(jsonb) from public, anon, authenticated;
grant execute on function public.ingest_shopee_item(jsonb) to service_role;

-- ============================================================================
-- 4. Rate limit nguyên tử
-- ============================================================================
--
-- Kiểm-rồi-ghi ở tầng ứng dụng không chặn được một loạt request đồng thời:
-- tất cả cùng đếm thấy 0 rồi cùng qua. Ở đây kiểm và ghi nằm trong một
-- transaction, dưới advisory lock theo IP (và lock toàn cục cho ingest).
--
-- Một lượt tra cứu = MỘT dòng lookup_requests:
--   lookup_begin()        → dòng 'pending', kiểm hạn mức chống quét
--   lookup_begin_ingest() → đánh dấu is_ingest, kiểm hạn mức ingest
--   tầng ứng dụng UPDATE outcome khi xong.

alter table public.lookup_requests
  add column if not exists is_ingest boolean not null default false;
alter table public.lookup_requests
  drop constraint if exists lookup_requests_outcome_check;
alter table public.lookup_requests
  add constraint lookup_requests_outcome_check
  check (outcome in ('pending','resolved','ingested','rejected','error'));

create index if not exists idx_lookup_req_user
  on public.lookup_requests (user_id, created_at desc) where user_id is not null;
create index if not exists idx_lookup_req_ingest_time
  on public.lookup_requests (created_at desc) where is_ingest;

-- Hạn mức (spec §10): tra cứu 120/giờ/IP.
create or replace function public.lookup_begin(p_ip_hash text, p_user_id uuid)
returns table (allowed boolean, reason text, request_id bigint)
language plpgsql set search_path = public as $$
declare v_count integer; v_id bigint;
begin
  perform pg_advisory_xact_lock(hashtext('lookup:ip:' || p_ip_hash));

  select count(*) into v_count from lookup_requests
  where ip_hash = p_ip_hash and created_at >= now() - interval '1 hour';

  if v_count >= 120 then
    insert into lookup_requests (ip_hash, user_id, outcome)
    values (p_ip_hash, p_user_id, 'rejected');
    return query select false, 'ip_hourly'::text, null::bigint;
    return;
  end if;

  insert into lookup_requests (ip_hash, user_id, outcome)
  values (p_ip_hash, p_user_id, 'pending')
  returning id into v_id;
  return query select true, null::text, v_id;
end $$;

-- Hạn mức ingest mới (spec §10): khách 10/giờ/IP · user 60/giờ · toàn hệ thống
-- p_global_cap/ngày. Lượt đang chạy ('pending') cũng tính.
create or replace function public.lookup_begin_ingest(p_request_id bigint, p_global_cap integer)
returns table (allowed boolean, reason text)
language plpgsql set search_path = public as $$
declare v_req lookup_requests%rowtype; v_count integer;
begin
  select * into v_req from lookup_requests where id = p_request_id;
  if not found then
    raise exception 'lookup_begin_ingest: không có lookup_requests.id = %', p_request_id;
  end if;

  perform pg_advisory_xact_lock(hashtext('lookup:ingest:global'));

  select count(*) into v_count from lookup_requests
  where is_ingest and outcome in ('pending','ingested')
    and created_at >= now() - interval '1 day';
  if v_count >= p_global_cap then
    update lookup_requests set outcome = 'rejected' where id = p_request_id;
    return query select false, 'global_daily'::text;
    return;
  end if;

  if v_req.user_id is not null then
    select count(*) into v_count from lookup_requests
    where user_id = v_req.user_id and is_ingest and outcome in ('pending','ingested')
      and created_at >= now() - interval '1 hour';
    if v_count >= 60 then
      update lookup_requests set outcome = 'rejected' where id = p_request_id;
      return query select false, 'user_hourly'::text;
      return;
    end if;
  else
    select count(*) into v_count from lookup_requests
    where ip_hash = v_req.ip_hash and is_ingest and outcome in ('pending','ingested')
      and created_at >= now() - interval '1 hour';
    if v_count >= 10 then
      update lookup_requests set outcome = 'rejected' where id = p_request_id;
      return query select false, 'ip_hourly'::text;
      return;
    end if;
  end if;

  update lookup_requests set is_ingest = true where id = p_request_id;
  return query select true, null::text;
end $$;

revoke execute on function public.lookup_begin(text, uuid) from public, anon, authenticated;
revoke execute on function public.lookup_begin_ingest(bigint, integer) from public, anon, authenticated;
grant execute on function public.lookup_begin(text, uuid) to service_role;
grant execute on function public.lookup_begin_ingest(bigint, integer) to service_role;

-- ============================================================================
-- 5. search_products v3
-- ============================================================================
--
-- So với 0003:
--  * Lọc sơ bộ bằng @@ (index FTS) hoặc %> (index trigram) TRƯỚC khi chạy các
--    lateral giá/điểm. Bản cũ tính to_tsvector + word_similarity + 2 lateral
--    cho MỌI dòng products ở mỗi lần gõ phím.
--  * Giá và Deal Score lấy từ CÙNG một variant đại diện (còn hàng, rẻ nhất).
--    Bản cũ lấy giá của variant rẻ nhất cạnh điểm của variant điểm cao nhất —
--    card hiện "Nên mua 85" cạnh một mức giá không phải giá được chấm.
--  * Brand so khớp không phân biệt hoa thường.
--  * Token có '-' hoặc '.' (wh-1000xm5, m.2) được tách thay vì bị bỏ hẳn.
--
-- Hàm cũ bị DROP trước vì Postgres không cho đổi hàm qua create or replace
-- khi kèm thuộc tính SET khác.
drop function if exists public.search_products(text, uuid, text[], numeric, numeric, text, integer, integer);

-- Gọi một hàm của pg_trgm để nạp thư viện: khi chưa nạp, tham số
-- pg_trgm.word_similarity_threshold chỉ là placeholder và role không phải
-- superuser bị từ chối quyền đặt nó trong mệnh đề SET bên dưới.
select public.show_limit();

create function public.search_products(
  p_q           text    default null,
  p_category_id uuid    default null,
  p_brands      text[]  default null,
  p_min_price   numeric default null,
  p_max_price   numeric default null,
  p_sort        text    default 'relevance',
  p_limit       integer default 24,
  p_offset      integer default 0
) returns table (
  product_id uuid, slug text, canonical_name text, brand text, image text,
  category_slug text, best_price numeric, original_price numeric,
  score smallint, recommendation text, last_observed_at timestamptz,
  relevance real, total_count bigint
) language sql stable
-- Ngưỡng của toán tử %> — cùng ngưỡng 0.4 đã đo ở 0003.
set pg_trgm.word_similarity_threshold = 0.4
as $$
  with norm as (
    select btrim(public.f_unaccent(lower(coalesce(p_q, '')))) as q
  ),
  tsq as (
    -- Ghép tsquery AN TOÀN: thay mọi ký tự ngoài [a-z0-9] bằng khoảng trắng,
    -- tách token, thêm :* rồi nối bằng &. Không bao giờ nối thẳng chuỗi
    -- người dùng vào to_tsquery.
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
             -- word_similarity(<truy vấn>, <tài liệu>) — thứ tự tham số quan trọng.
             else word_similarity((select q from norm), p.search_text)
           end as rel
    from products p
    where (p_category_id is null or p.category_id = p_category_id)
      and (p_brands is null or lower(p.brand) = any(array(select lower(b) from unnest(p_brands) b)))
      and ((select q from norm) = ''
           or ((select tq from tsq) is not null
               and to_tsvector('simple', p.search_text) @@ (select tq from tsq))
           or p.search_text %> (select q from norm))
  ),
  priced as (
    select m.id, m.slug, m.canonical_name, m.brand, m.image, m.rel,
           c.slug as category_slug,
           rep.price, rep.original_price, rep.observed_at,
           vds.score, vds.recommendation
    from matched m
    left join categories c on c.id = m.category_id
    left join lateral (
      -- Variant đại diện: còn hàng trước, rồi rẻ nhất.
      select v.id as variant_id, vcp.price, vcp.original_price, vcp.observed_at
      from product_variants v
      join variant_current_price vcp on vcp.variant_id = v.id
      where v.product_id = m.id and vcp.price is not null
      order by vcp.in_stock desc, vcp.price asc
      limit 1
    ) rep on true
    left join variant_deal_scores vds on vds.variant_id = rep.variant_id
    where (p_min_price is null or rep.price >= p_min_price)
      and (p_max_price is null or rep.price <= p_max_price)
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

-- Danh sách brand distinct cho bộ lọc. Đọc cả cột brand về tầng ứng dụng thì
-- bị PostgREST cắt âm thầm ở 1000 dòng.
create or replace function public.product_brands()
returns table (brand text) language sql stable as $$
  select distinct p.brand from products p where p.brand is not null order by 1
$$;

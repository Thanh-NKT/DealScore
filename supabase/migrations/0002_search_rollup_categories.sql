-- ============================================================================
-- 0002 — Nền cho 1.1 Tra cứu & 1.2 Trang sản phẩm
-- ============================================================================

create extension if not exists pg_trgm;
create extension if not exists unaccent;

-- unaccent() KHÔNG immutable → không dùng trực tiếp trong index/generated column.
create or replace function public.f_unaccent(text)
returns text language sql immutable parallel safe strict
as $$ select public.unaccent('public.unaccent', $1) $$;

-- ---------------------------------------------------------------- categories
create table if not exists public.categories (
  id         uuid primary key default gen_random_uuid(),
  slug       text not null unique,
  name       text not null,
  parent_id  uuid references public.categories(id) on delete set null,
  sort_order integer not null default 0,
  constraint categories_slug_format check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  -- URL sản phẩm là /{category}/{product}; các slug này đã bị route khác chiếm.
  constraint categories_slug_reserved check (
    slug not in ('tim-kiem','brand','danh-muc','go','api','share-target',
                 'admin','auth','watch','tai-khoan')
  )
);

alter table public.products
  drop constraint if exists products_category_fk;
alter table public.products
  add constraint products_category_fk
  foreign key (category_id) references public.categories(id) on delete set null;

-- ------------------------------------------------------------ products.slug
alter table public.products add column if not exists slug text;
create unique index if not exists idx_products_slug on public.products (slug);

-- ----------------------------------------------------- products.search_text
alter table public.products add column if not exists search_text text
  generated always as (
    public.f_unaccent(lower(
      coalesce(canonical_name,'') || ' ' || coalesce(brand,'') || ' ' ||
      coalesce(model,'')          || ' ' || coalesce(gtin,'')
    ))
  ) stored;

create index if not exists idx_products_search_trgm
  on public.products using gin (search_text gin_trgm_ops);
create index if not exists idx_products_search_fts
  on public.products using gin (to_tsvector('simple', search_text));

-- ------------------------------------------------- variant_current_price
create table if not exists public.variant_current_price (
  variant_id     uuid primary key references public.product_variants(id) on delete cascade,
  best_offer_id  uuid references public.offers(id) on delete set null,
  price          numeric(14,2),
  original_price numeric(14,2),
  is_flash_sale  boolean not null default false,
  in_stock       boolean not null default true,
  offer_count    integer not null default 0,
  observed_at    timestamptz not null
);
create index if not exists idx_vcp_price on public.variant_current_price (price);

-- -------------------------------------------------- variant_daily_prices
create table if not exists public.variant_daily_prices (
  variant_id      uuid not null references public.product_variants(id) on delete cascade,
  day             date not null,
  min_price       numeric(14,2),   -- thấp nhất trong ngày, ĐÃ loại flash sale
  median_price    numeric(14,2),
  max_price       numeric(14,2),
  obs_count       integer not null default 0,
  offer_count     integer not null default 0,
  has_flash_sale  boolean not null default false,
  flash_min_price numeric(14,2),
  primary key (variant_id, day)
);
create index if not exists idx_vdp_variant_day
  on public.variant_daily_prices (variant_id, day desc);

-- --------------------------------------------------- variant_deal_scores
create table if not exists public.variant_deal_scores (
  variant_id       uuid primary key references public.product_variants(id) on delete cascade,
  score            smallint,
  recommendation   text not null
                   check (recommendation in ('insufficient_data','buy','wait','avoid')),
  price_at_compute numeric(14,2),
  computed_at      timestamptz not null default now()
);
create index if not exists idx_vds_score
  on public.variant_deal_scores (score desc nulls last);

-- -------------------------------------------------------- lookup_requests
create table if not exists public.lookup_requests (
  id         bigint generated always as identity primary key,
  ip_hash    text not null,                     -- sha256(ip || salt), KHÔNG lưu IP thô
  user_id    uuid references public.users(id) on delete set null,
  outcome    text not null
             check (outcome in ('resolved','ingested','rejected','error')),
  created_at timestamptz not null default now()
);
create index if not exists idx_lookup_req_ip
  on public.lookup_requests (ip_hash, created_at desc);
create index if not exists idx_lookup_req_time
  on public.lookup_requests (created_at desc);

-- Dữ liệu vận hành: chỉ service role đụng tới. Bật RLS, KHÔNG tạo policy nào.
alter table public.lookup_requests enable row level security;

-- ============================================================================
-- Hàm
-- ============================================================================

-- Rollup giá theo ngày. Gọi sau mỗi collector run cho (hôm qua, hôm nay).
create or replace function public.refresh_variant_daily_prices(p_from date, p_to date)
returns integer language plpgsql security definer set search_path = public as $$
declare v_rows integer;
begin
  insert into variant_daily_prices as t (
    variant_id, day, min_price, median_price, max_price,
    obs_count, offer_count, has_flash_sale, flash_min_price
  )
  select
    o.variant_id,
    (po.observed_at at time zone 'Asia/Ho_Chi_Minh')::date,
    min(po.price)               filter (where not po.is_flash_sale),
    percentile_cont(0.5) within group (order by po.price)
                                filter (where not po.is_flash_sale),
    max(po.price)               filter (where not po.is_flash_sale),
    count(*)                    filter (where not po.is_flash_sale),
    count(distinct po.offer_id) filter (where not po.is_flash_sale),
    bool_or(po.is_flash_sale),
    min(po.price)               filter (where po.is_flash_sale)
  from price_observations po
  join offers o on o.id = po.offer_id
  where po.is_valid
    and po.price is not null and po.price > 0
    and o.variant_id is not null
    and (po.observed_at at time zone 'Asia/Ho_Chi_Minh')::date between p_from and p_to
  group by 1, 2
  on conflict (variant_id, day) do update set
    min_price       = excluded.min_price,
    median_price    = excluded.median_price,
    max_price       = excluded.max_price,
    obs_count       = excluded.obs_count,
    offer_count     = excluded.offer_count,
    has_flash_sale  = excluded.has_flash_sale,
    flash_min_price = excluded.flash_min_price;
  get diagnostics v_rows = row_count;
  return v_rows;
end $$;

-- Quan sát mới nhất của TỪNG offer thuộc variant.
create or replace function public.latest_price_per_offer(p_variant_id uuid)
returns table (offer_id uuid, price numeric, original_price numeric,
               stock integer, is_flash_sale boolean, observed_at timestamptz)
language sql stable as $$
  select distinct on (po.offer_id)
         po.offer_id, po.price, po.original_price,
         po.stock, po.is_flash_sale, po.observed_at
  from price_observations po
  join offers o on o.id = po.offer_id
  where o.variant_id = p_variant_id and po.is_valid
  order by po.offer_id, po.observed_at desc
$$;

-- Ngày theo dõi đầu tiên — KHÔNG cắt theo cửa sổ 90 ngày.
create or replace function public.variant_tracking_since(p_variant_id uuid)
returns date language sql stable as $$
  select min(day) from variant_daily_prices where variant_id = p_variant_id
$$;

-- Tìm kiếm: FTS prefix, fallback trigram khi ít kết quả.
create or replace function public.search_products(
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
) language sql stable as $$
  with norm as (
    select public.f_unaccent(lower(coalesce(p_q, ''))) as q
  ),
  tsq as (
    -- Ghép tsquery an toàn: chỉ giữ [a-z0-9], mỗi token thêm :* rồi nối bằng &.
    select case when (select q from norm) = '' then null
           else to_tsquery('simple',
                  array_to_string(
                    array(select t || ':*'
                          from regexp_split_to_table((select q from norm), '\s+') t
                          where t ~ '^[a-z0-9]+$'), ' & ')) end as tq
  ),
  base as (
    select p.id, p.slug, p.canonical_name, p.brand, p.image, p.search_text,
           c.slug as category_slug,
           vcp.price, vcp.original_price, vcp.observed_at,
           vds.score, vds.recommendation
    from products p
    left join categories c on c.id = p.category_id
    left join lateral (
      select vcp.price, vcp.original_price, vcp.observed_at
      from product_variants v
      join variant_current_price vcp on vcp.variant_id = v.id
      where v.product_id = p.id and vcp.price is not null
      order by vcp.price asc limit 1
    ) vcp on true
    left join lateral (
      select vds.score, vds.recommendation
      from product_variants v
      join variant_deal_scores vds on vds.variant_id = v.id
      where v.product_id = p.id
      order by vds.score desc nulls last limit 1
    ) vds on true
    where (p_category_id is null or p.category_id = p_category_id)
      and (p_brands     is null or p.brand = any(p_brands))
      and (p_min_price  is null or vcp.price >= p_min_price)
      and (p_max_price  is null or vcp.price <= p_max_price)
  ),
  scored as (
    select b.*,
           case
             when (select tq from tsq) is null then 0::real
             when to_tsvector('simple', b.search_text) @@ (select tq from tsq)
               then ts_rank(to_tsvector('simple', b.search_text), (select tq from tsq)) + 1.0
             else similarity(b.search_text, (select q from norm))
           end as rel
    from base b
  ),
  filtered as (
    select * from scored
    where (select q from norm) = '' or rel > 0.25
  )
  select id, slug, canonical_name, brand, image, category_slug,
         price, original_price, score, recommendation, observed_at,
         rel, count(*) over () as total_count
  from filtered
  order by
    case when p_sort = 'price_asc'   then price      end asc  nulls last,
    case when p_sort = 'price_desc'  then price      end desc nulls last,
    case when p_sort = 'deal_score'  then score      end desc nulls last,
    case when p_sort = 'updated'     then observed_at end desc nulls last,
    case when p_sort = 'relevance'   then rel        end desc nulls last,
    id
  limit p_limit offset p_offset
$$;

# Nền tảng giá & tìm kiếm — Implementation Plan (Plan 1/2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dựng toàn bộ tầng logic cho 1.1 Tra cứu và 1.2 Trang sản phẩm — schema, engine giá, tìm kiếm, tầng đọc dữ liệu — chạy và test được mà không cần Shopee API.

**Architecture:** Migration `0002` thêm `categories`, slug, index tìm kiếm và ba bảng phái sinh (`variant_current_price`, `variant_daily_prices`, `variant_deal_scores`). Tầng lib là các hàm thuần bọc quanh `src/lib/deal-score.ts` (không sửa file đó): `price-history` giãn rollup ngày thành chuỗi quan sát, `variant-pricing` lắp ráp toàn bộ dữ liệu trang sản phẩm, `chart-series` chuẩn bị dữ liệu vẽ. `seed-dev` sinh 120 ngày dữ liệu giả để kiểm chứng trước khi có collector thật.

**Tech Stack:** Next.js 16 (App Router, `src/proxy.ts` thay middleware) · React 19 · TypeScript · Supabase (PostgreSQL, `pg_trgm`, `unaccent`) · vitest · pnpm

**Spec:** [docs/superpowers/specs/2026-09-22-tra-cuu-trang-san-pham-logic.md](../specs/2026-09-22-tra-cuu-trang-san-pham-logic.md)

**Phạm vi:** Plan này làm §1–§6, §10 (một phần), §13–§15, §7 (`parse-url`), §12 (`/go`) của spec.
**Plan 2** làm phần phụ thuộc Shopee API: `resolve-redirect`, `shopee/client`, `rate-limit`, `ingest`, `/api/lookup`. Lý do tách: spec §9 ghi rõ `ShopeeItemDetail` là interface phỏng đoán, chờ spike Giai đoạn 0 xác nhận — đặc biệt là **có trường `originalPrice` hay không**.

---

## Global Constraints

Mọi task đều phải tuân thủ, không nhắc lại trong từng task:

- **Ngôn ngữ:** comment và chuỗi hiển thị viết **tiếng Việt**.
- **Path alias:** `@/*` → `./src/*`. Import nội bộ dùng `@/lib/...`.
- **Không sửa `src/lib/deal-score.ts`.** File này thuần hàm để backtest được. Mọi thứ khác bọc quanh nó.
- **Không cài đặt lại logic tính điểm bằng SQL.** Mọi nơi cần điểm đều `import { computeDealScore } from "@/lib/deal-score"`.
- **Ba Supabase client, chọn sai là lỗi bảo mật:** `@/lib/supabase/client` (browser, anon+RLS) · `@/lib/supabase/server` (server, anon+RLS) · `@/lib/supabase/admin` (**service role, bỏ qua RLS** — chỉ route handler ghi, `@/lib/ingest`, `scripts/`). `admin` **không bao giờ** import vào Client Component.
- **Múi giờ:** `Asia/Ho_Chi_Minh` cho mọi phép quy đổi timestamp → ngày. UTC+7, không có DST.
- **Tiền tệ:** VND, số nguyên, không phần thập phân.
- **Next.js 16:** `params` và `searchParams` của page là `Promise`, phải `await`.
- **Commit:** mỗi commit kết thúc bằng dòng
  `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`
- **Chạy trước khi commit:** `pnpm test` và `pnpm lint` phải xanh.

---

## Cấu trúc file

| File | Trách nhiệm |
|---|---|
| `vitest.config.ts` | Cấu hình test, alias `@` |
| `supabase/migrations/0002_search_rollup_categories.sql` | Schema + 4 hàm SQL |
| `src/lib/format.ts` | Định dạng tiền, %, ngày giờ VN |
| `src/lib/slug.ts` | Sinh slug tiếng Việt, chống trùng |
| `src/lib/price-history.ts` | Rollup ngày → `PriceObservation[]`, trung vị cửa sổ |
| `src/lib/variant-pricing.ts` | Lắp ráp toàn bộ dữ liệu 1.2 cho một variant |
| `src/lib/chart-series.ts` | Cắt theo range, ngắt đoạn, marker flash sale |
| `src/lib/product-page-data.ts` | Tầng đọc dữ liệu trang sản phẩm |
| `src/lib/search.ts` | Parse/serialize tham số URL, gọi RPC tìm kiếm |
| `src/lib/shopee/parse-url.ts` | Parse URL Shopee (hàm thuần, không gọi mạng) |
| `src/app/api/autocomplete/route.ts` | Gợi ý tìm kiếm |
| `src/app/go/[marketplace]/[offerId]/route.ts` | Redirect affiliate + ghi click |
| `scripts/seed-dev.ts` | Dữ liệu giả 120 ngày |
| `scripts/recompute-deal-scores.ts` | Job ghi cache điểm |

Test đặt ở `tests/` gương theo `src/`: `tests/lib/format.test.ts`, …

---

## Task 1: Dựng vitest

**Files:**
- Create: `vitest.config.ts`
- Create: `tests/setup.test.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: không
- Produces: lệnh `pnpm test` chạy mọi file `tests/**/*.test.ts`; alias `@/` hoạt động trong test

- [ ] **Step 1: Cài vitest**

```bash
pnpm add -D vitest
```

- [ ] **Step 2: Tạo `vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, "src") },
  },
});
```

- [ ] **Step 3: Thêm script vào `package.json`**

Trong `"scripts"`, thêm hai dòng:

```json
"test": "vitest run",
"test:watch": "vitest"
```

- [ ] **Step 4: Viết test khói kiểm chứng alias**

`tests/setup.test.ts` — test này tồn tại để chứng minh alias `@/` hoạt động, nếu không thì mọi task sau sẽ hỏng vì lý do không liên quan tới code của chúng.

```ts
import { describe, expect, it } from "vitest";
import { MIN_DAYS_FOR_SCORE, RECOMMENDATION_LABEL } from "@/lib/deal-score";

describe("cấu hình vitest", () => {
  it("phân giải được alias @/ tới src/", () => {
    expect(MIN_DAYS_FOR_SCORE).toBe(14);
  });

  it("import được hằng số từ deal-score", () => {
    expect(RECOMMENDATION_LABEL.buy).toContain("Nên mua");
  });
});
```

- [ ] **Step 5: Chạy test**

Run: `pnpm test`
Expected: PASS, 2 tests.

- [ ] **Step 6: Commit**

```bash
git add vitest.config.ts tests/setup.test.ts package.json pnpm-lock.yaml
git commit -m "$(cat <<'EOF'
chore: dựng vitest với alias @/ tới src

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Migration 0002 — bảng, cột, index

**Files:**
- Create: `supabase/migrations/0002_search_rollup_categories.sql`

**Interfaces:**
- Consumes: schema từ `0001_init.sql`
- Produces: bảng `categories`, `variant_current_price`, `variant_daily_prices`, `variant_deal_scores`, `lookup_requests`; cột `products.slug`, `products.search_text`

- [ ] **Step 1: Tạo file migration, phần extension và bảng**

`supabase/migrations/0002_search_rollup_categories.sql`:

```sql
-- ============================================================================
-- 0002 — Nền cho 1.1 Tra cứu & 1.2 Trang sản phẩm
-- ============================================================================

create extension if not exists pg_trgm;
create extension if not exists unaccent;

-- unaccent() KHÔNG immutable → không dùng trực tiếp trong index hay generated
-- column. Bọc lại với dictionary chỉ rõ schema để khai báo immutable an toàn.
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

alter table public.products drop constraint if exists products_category_fk;
alter table public.products
  add constraint products_category_fk
  foreign key (category_id) references public.categories(id) on delete set null;

-- ------------------------------------------------- products.slug, search_text
alter table public.products add column if not exists slug text;
create unique index if not exists idx_products_slug on public.products (slug);

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

-- ------------------------------------------------------ variant_current_price
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

-- ------------------------------------------------------- variant_daily_prices
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

-- -------------------------------------------------------- variant_deal_scores
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

-- ------------------------------------------------------------ lookup_requests
create table if not exists public.lookup_requests (
  id         bigint generated always as identity primary key,
  ip_hash    text not null,          -- sha256(ip || salt), KHÔNG lưu IP thô
  user_id    uuid references public.users(id) on delete set null,
  outcome    text not null
             check (outcome in ('resolved','ingested','rejected','error')),
  created_at timestamptz not null default now()
);
create index if not exists idx_lookup_req_ip
  on public.lookup_requests (ip_hash, created_at desc);
create index if not exists idx_lookup_req_time
  on public.lookup_requests (created_at desc);

-- Dữ liệu vận hành: chỉ service role đụng tới.
-- Bật RLS và KHÔNG tạo policy nào → anon key không đọc được gì.
alter table public.lookup_requests enable row level security;
```

- [ ] **Step 2: Áp dụng migration**

Theo `supabase/README.md`, cách nhanh nhất: Supabase Dashboard → **SQL Editor** → dán toàn bộ file → **Run**.
Hoặc: `supabase db push`.

- [ ] **Step 3: Kiểm chứng bằng tay**

Chạy trong SQL Editor, cả 5 truy vấn phải thành công:

```sql
-- 1. generated column hoạt động (f_unaccent phải immutable, nếu không sẽ lỗi ở Step 2)
insert into public.categories (slug, name) values ('ssd', 'Ổ cứng SSD');
insert into public.products (canonical_name, brand, model, slug, category_id)
  values ('Ổ cứng SSD Samsung 990 PRO 2TB', 'Samsung', '990 PRO', 'samsung-990-pro-2tb',
          (select id from public.categories where slug = 'ssd'));
select search_text from public.products where slug = 'samsung-990-pro-2tb';
-- Kỳ vọng: 'o cung ssd samsung 990 pro 2tb samsung 990 pro ' (đã bỏ dấu, lowercase)

-- 2. slug dành riêng bị chặn
insert into public.categories (slug, name) values ('brand', 'X');
-- Kỳ vọng: LỖI vi phạm categories_slug_reserved

-- 3. slug sai định dạng bị chặn
insert into public.categories (slug, name) values ('O Cung', 'X');
-- Kỳ vọng: LỖI vi phạm categories_slug_format

-- 4. index tìm kiếm tồn tại
select indexname from pg_indexes
 where tablename = 'products' and indexname like 'idx_products_search%';
-- Kỳ vọng: 2 dòng

-- 5. lookup_requests khóa với anon
select relrowsecurity from pg_class where relname = 'lookup_requests';
-- Kỳ vọng: true
```

Dọn dữ liệu thử:

```sql
delete from public.products where slug = 'samsung-990-pro-2tb';
delete from public.categories where slug = 'ssd';
```

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/0002_search_rollup_categories.sql
git commit -m "$(cat <<'EOF'
feat(db): thêm categories, slug, index tìm kiếm và ba bảng phái sinh giá

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Migration 0002 — bốn hàm SQL

**Files:**
- Modify: `supabase/migrations/0002_search_rollup_categories.sql` (nối tiếp vào cuối)

**Interfaces:**
- Consumes: bảng từ Task 2
- Produces: `refresh_variant_daily_prices(date, date) → integer` · `latest_price_per_offer(uuid) → table` · `variant_tracking_since(uuid) → date` · `search_products(...) → table`

- [ ] **Step 1: Nối phần hàm vào cuối file migration**

```sql
-- ============================================================================
-- Hàm
-- ============================================================================

-- Rollup giá theo ngày. Gọi sau mỗi collector run cho (hôm qua, hôm nay).
--
-- MÚI GIỜ LÀ BẮT BUỘC: observed_at là timestamptz; ép sang date mà không chỉ
-- rõ múi giờ sẽ dùng TimeZone của session, khiến biên ngày trôi giữa dev và
-- production và làm lệch chart một ngày.
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
-- variant_current_price chỉ có giá rẻ nhất; danh sách offer cần giá từng dòng.
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

-- Ngày theo dõi đầu tiên — KHÔNG cắt theo cửa sổ 90 ngày. Sản phẩm theo dõi
-- 8 tháng phải hiện 8 tháng.
create or replace function public.variant_tracking_since(p_variant_id uuid)
returns date language sql stable as $$
  select min(day) from variant_daily_prices where variant_id = p_variant_id
$$;

-- Tìm kiếm: FTS prefix, fallback trigram khi khớp yếu (chỗ chịu lỗi gõ sai).
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
    -- Ghép tsquery AN TOÀN: chỉ giữ token [a-z0-9], thêm :* rồi nối bằng &.
    -- Nối thẳng chuỗi người dùng vào to_tsquery sẽ ném lỗi với ! & ( ...
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
    case when p_sort = 'price_asc'  then price       end asc  nulls last,
    case when p_sort = 'price_desc' then price       end desc nulls last,
    case when p_sort = 'deal_score' then score       end desc nulls last,
    case when p_sort = 'updated'    then observed_at end desc nulls last,
    case when p_sort = 'relevance'  then rel         end desc nulls last,
    id
  limit p_limit offset p_offset
$$;
```

- [ ] **Step 2: Áp dụng lại migration**

Chạy phần vừa thêm trong SQL Editor (các `create or replace` an toàn khi chạy lại).

- [ ] **Step 3: Kiểm chứng biên ngày không phụ thuộc session**

Đây là ca dễ sai nhất và im lặng nhất. Chạy trong SQL Editor:

```sql
-- Dữ liệu thử: một quan sát lúc 23:30 giờ VN ngày 2026-03-10,
-- tức 16:30Z cùng ngày. Theo giờ VN phải rơi vào ngày 2026-03-10.
-- Nếu hàm dùng UTC thì cũng ra 2026-03-10 → chưa phân biệt được.
-- Nên dùng mốc 00:30 giờ VN ngày 11 = 17:30Z ngày 10:
-- theo giờ VN là ngày 11, theo UTC là ngày 10.

create temporary table tz_probe as select 1;   -- giữ chỗ, xem ghi chú bên dưới

set TimeZone = 'UTC';
select (timestamptz '2026-03-10 17:30:00+00' at time zone 'Asia/Ho_Chi_Minh')::date;
-- Kỳ vọng: 2026-03-11

set TimeZone = 'Asia/Ho_Chi_Minh';
select (timestamptz '2026-03-10 17:30:00+00' at time zone 'Asia/Ho_Chi_Minh')::date;
-- Kỳ vọng: 2026-03-11  (GIỐNG HỆT dòng trên)

reset TimeZone;
```

Hai kết quả **phải bằng nhau**. Khác nhau nghĩa là ở đâu đó trong hàm còn thiếu `at time zone`.

- [ ] **Step 4: Kiểm chứng sanitize tsquery không ném lỗi**

```sql
select count(*) from public.search_products(p_q => 'samsung & ! ( 990');
-- Kỳ vọng: chạy được, trả về số (0 cũng được). KHÔNG được ném lỗi cú pháp tsquery.

select count(*) from public.search_products(p_q => '   ');
-- Kỳ vọng: chạy được.

select count(*) from public.search_products(p_q => null);
-- Kỳ vọng: chạy được, liệt kê sản phẩm không lọc theo từ khóa.
```

- [ ] **Step 5: Sinh lại `src/lib/database.types.ts`**

**Bỏ qua bước này là hỏng Task 13, 14, 15.** File type hiện viết tay và chưa biết gì về 5 bảng mới; `db.from("variant_current_price")` sẽ không biên dịch được.

```bash
npx supabase gen types typescript --project-id <project-ref> --schema public > src/lib/database.types.ts
```

Không có Supabase CLI thì thêm thủ công vào `Database["public"]["Tables"]` các khóa `categories`, `variant_current_price`, `variant_daily_prices`, `variant_deal_scores`, `lookup_requests` (theo đúng cột ở Task 2), thêm `slug: string | null` và `search_text: string | null` vào `products.Row`, và khai báo 4 hàm trong `Database["public"]["Functions"]`.

Kiểm chứng:

```bash
npx tsc --noEmit
```
Expected: không lỗi.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/0002_search_rollup_categories.sql src/lib/database.types.ts
git commit -m "$(cat <<'EOF'
feat(db): thêm rollup giá theo ngày, RPC giá theo offer và search_products

Rollup ép ngày theo Asia/Ho_Chi_Minh để biên ngày không phụ thuộc
TimeZone của session. search_products sanitize tsquery trước khi ghép.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: `src/lib/format.ts`

**Files:**
- Create: `src/lib/format.ts`
- Test: `tests/lib/format.test.ts`

**Interfaces:**
- Consumes: không
- Produces:
  - `formatVnd(value: number | null | undefined): string`
  - `discountPercent(current: number | null, listed: number | null): number | null`
  - `toVnDate(d: Date | string): string` → `'YYYY-MM-DD'`
  - `daysBetween(a: Date | string, b: Date | string): number`

- [ ] **Step 1: Viết test thất bại**

`tests/lib/format.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { daysBetween, discountPercent, formatVnd, toVnDate } from "@/lib/format";

describe("formatVnd", () => {
  it("định dạng theo kiểu Việt Nam", () => {
    //   là non-breaking space do Intl chèn trước ký hiệu tiền tệ.
    expect(formatVnd(1234000).replace(/ /g, " ")).toBe("1.234.000 ₫");
  });

  it("làm tròn về số nguyên", () => {
    expect(formatVnd(1000.6).replace(/ /g, " ")).toBe("1.001 ₫");
  });

  it("trả dấu gạch khi không có giá trị", () => {
    expect(formatVnd(null)).toBe("—");
    expect(formatVnd(undefined)).toBe("—");
    expect(formatVnd(Number.NaN)).toBe("—");
  });
});

describe("discountPercent", () => {
  it("tính phần trăm giảm", () => {
    expect(discountPercent(80, 100)).toBe(20);
  });

  it("làm tròn XUỐNG, không bao giờ làm tròn lên một con số khuyến mãi", () => {
    expect(discountPercent(99, 100)).toBe(1);
  });

  it("trả null khi làm tròn xuống ra 0", () => {
    expect(discountPercent(999, 1000)).toBeNull();
  });

  it("trả null khi không giảm hoặc đắt hơn niêm yết", () => {
    expect(discountPercent(100, 100)).toBeNull();
    expect(discountPercent(120, 100)).toBeNull();
  });

  it("trả null khi thiếu dữ liệu", () => {
    expect(discountPercent(null, 100)).toBeNull();
    expect(discountPercent(100, null)).toBeNull();
  });
});

describe("toVnDate", () => {
  it("dùng giờ Việt Nam chứ không phải UTC", () => {
    // 17:30Z ngày 10 = 00:30 ngày 11 giờ VN.
    expect(toVnDate("2026-03-10T17:30:00Z")).toBe("2026-03-11");
  });

  it("giữ nguyên ngày khi còn trong ngày theo giờ VN", () => {
    expect(toVnDate("2026-03-10T05:00:00Z")).toBe("2026-03-10");
  });
});

describe("daysBetween", () => {
  it("trả số ngày dương bất kể thứ tự", () => {
    expect(daysBetween("2026-03-10T00:00:00Z", "2026-03-12T00:00:00Z")).toBe(2);
    expect(daysBetween("2026-03-12T00:00:00Z", "2026-03-10T00:00:00Z")).toBe(2);
  });
});
```

- [ ] **Step 2: Chạy test để xác nhận nó thất bại**

Run: `pnpm test format`
Expected: FAIL — `Failed to resolve import "@/lib/format"`.

- [ ] **Step 3: Viết cài đặt tối thiểu**

`src/lib/format.ts`:

```ts
/** Định dạng hiển thị dùng chung. Không chứa logic nghiệp vụ. */

const VND = new Intl.NumberFormat("vi-VN", {
  style: "currency",
  currency: "VND",
  maximumFractionDigits: 0,
});

/** "1.234.000 ₫". Thiếu dữ liệu trả "—", không bao giờ trả "0 ₫". */
export function formatVnd(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return VND.format(Math.round(value));
}

/**
 * % giảm so với giá niêm yết, LÀM TRÒN XUỐNG.
 * Trả null khi thiếu giá, khi niêm yết không cao hơn giá hiện tại,
 * hoặc khi làm tròn xuống ra 0 — hiển thị "−0%" là vô nghĩa.
 */
export function discountPercent(
  current: number | null | undefined,
  listed: number | null | undefined,
): number | null {
  if (current == null || listed == null) return null;
  if (!Number.isFinite(current) || !Number.isFinite(listed)) return null;
  if (current <= 0 || listed <= current) return null;
  const pct = Math.floor(((listed - current) / listed) * 100);
  return pct > 0 ? pct : null;
}

// en-CA cho ra đúng định dạng YYYY-MM-DD.
const VN_DATE = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Ho_Chi_Minh",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** 'YYYY-MM-DD' theo giờ Việt Nam. */
export function toVnDate(d: Date | string): string {
  return VN_DATE.format(typeof d === "string" ? new Date(d) : d);
}

/** Số ngày giữa hai mốc, luôn dương. */
export function daysBetween(a: Date | string, b: Date | string): number {
  const ta = (typeof a === "string" ? new Date(a) : a).getTime();
  const tb = (typeof b === "string" ? new Date(b) : b).getTime();
  return Math.abs(ta - tb) / 86_400_000;
}
```

- [ ] **Step 4: Chạy test để xác nhận nó xanh**

Run: `pnpm test format`
Expected: PASS, 13 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/format.ts tests/lib/format.test.ts
git commit -m "$(cat <<'EOF'
feat(lib): thêm format tiền tệ, % giảm và ngày theo giờ Việt Nam

discountPercent làm tròn xuống và trả null thay vì 0 để không hiện "−0%".

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: `src/lib/slug.ts`

**Files:**
- Create: `src/lib/slug.ts`
- Test: `tests/lib/slug.test.ts`

**Interfaces:**
- Consumes: không
- Produces:
  - `slugify(input: string, maxLength?: number): string`
  - `uniqueSlug(base: string, exists: (slug: string) => Promise<boolean>): Promise<string>`

- [ ] **Step 1: Viết test thất bại**

`tests/lib/slug.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { slugify, uniqueSlug } from "@/lib/slug";

describe("slugify", () => {
  it("bỏ dấu tiếng Việt", () => {
    expect(slugify("Ổ cứng SSD Samsung 990 PRO 2TB")).toBe(
      "o-cung-ssd-samsung-990-pro-2tb",
    );
  });

  it("xử lý chữ Đ/đ — NFD KHÔNG phân rã được chữ này", () => {
    expect(slugify("Đĩa cứng")).toBe("dia-cung");
    expect(slugify("đèn")).toBe("den");
  });

  it("gộp ký tự lạ và dấu gạch liền nhau", () => {
    expect(slugify("A  --  B")).toBe("a-b");
    expect(slugify("Bàn phím (cơ) 100%!")).toBe("ban-phim-co-100");
  });

  it("cắt theo maxLength và không để lại gạch ở cuối", () => {
    expect(slugify("aaaa bbbb cccc", 10)).toBe("aaaa-bbbb");
  });

  it("trả chuỗi rỗng khi không còn ký tự hợp lệ", () => {
    expect(slugify("!!!")).toBe("");
  });
});

describe("uniqueSlug", () => {
  it("trả nguyên slug khi chưa tồn tại", async () => {
    const taken = new Set<string>();
    expect(await uniqueSlug("a", async (s) => taken.has(s))).toBe("a");
  });

  it("thêm hậu tố cho tới khi trống", async () => {
    const taken = new Set(["a", "a-2"]);
    expect(await uniqueSlug("a", async (s) => taken.has(s))).toBe("a-3");
  });
});
```

- [ ] **Step 2: Chạy test để xác nhận nó thất bại**

Run: `pnpm test slug`
Expected: FAIL — `Failed to resolve import "@/lib/slug"`.

- [ ] **Step 3: Viết cài đặt tối thiểu**

`src/lib/slug.ts`:

```ts
/** Sinh slug cho URL sản phẩm và danh mục. */

/**
 * Bỏ dấu tiếng Việt, lowercase, thay mọi ký tự khác bằng '-'.
 *
 * Lưu ý: NFD phân rã được hầu hết nguyên âm có dấu, NHƯNG KHÔNG phân rã
 * được Đ/đ — phải thay riêng, nếu không "Đĩa" sẽ thành "ia".
 */
export function slugify(input: string, maxLength = 80): string {
  const s = input
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[Đđ]/g, "d")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return s.slice(0, maxLength).replace(/-+$/g, "");
}

/**
 * Sinh slug chưa trùng. `exists` trả true nếu slug đã có trong DB.
 * Trùng thì thêm hậu tố -2, -3, … cho tới khi trống.
 */
export async function uniqueSlug(
  base: string,
  exists: (slug: string) => Promise<boolean>,
): Promise<string> {
  if (!(await exists(base))) return base;
  for (let i = 2; i < 1000; i++) {
    const candidate = `${base}-${i}`;
    if (!(await exists(candidate))) return candidate;
  }
  throw new Error(`Không sinh được slug duy nhất từ "${base}"`);
}
```

- [ ] **Step 4: Chạy test để xác nhận nó xanh**

Run: `pnpm test slug`
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/slug.ts tests/lib/slug.test.ts
git commit -m "$(cat <<'EOF'
feat(lib): thêm slugify tiếng Việt và uniqueSlug chống trùng

NFD không phân rã được Đ/đ nên phải thay riêng.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: `src/lib/price-history.ts` — hạt nhân

Đây là task quan trọng nhất của plan. Nó quyết định nghĩa của hai ngưỡng dữ liệu trong `deal-score.ts`.

**Files:**
- Create: `src/lib/price-history.ts`
- Test: `tests/lib/price-history.test.ts`

**Interfaces:**
- Consumes: `PriceObservation` từ `@/lib/deal-score` · `toVnDate` từ `@/lib/format`
- Produces:
  - `interface DailyPriceRow { day: string; min_price: number | null; median_price: number | null; max_price: number | null; obs_count: number; offer_count: number; has_flash_sale: boolean; flash_min_price: number | null }`
  - `expandRollup(rows: DailyPriceRow[]): PriceObservation[]`
  - `medianWindow(rows: DailyPriceRow[], fromDaysAgo: number, toDaysAgo: number, now?: Date): { value: number | null; dayCount: number }`

- [ ] **Step 1: Viết test thất bại**

`tests/lib/price-history.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { computeDealScore } from "@/lib/deal-score";
import { expandRollup, medianWindow, type DailyPriceRow } from "@/lib/price-history";

const NOW = new Date("2026-03-20T03:00:00Z"); // 10:00 giờ VN ngày 20

/** Tạo n ngày rollup liên tiếp kết thúc ở dayBefore ngày trước NOW. */
function makeRows(
  n: number,
  price: (i: number) => number | null,
  endDaysAgo = 0,
): DailyPriceRow[] {
  const rows: DailyPriceRow[] = [];
  for (let i = 0; i < n; i++) {
    const daysAgo = endDaysAgo + (n - 1 - i);
    const d = new Date(NOW.getTime() - daysAgo * 86_400_000);
    rows.push({
      day: d.toISOString().slice(0, 10),
      min_price: price(i),
      median_price: price(i),
      max_price: price(i),
      obs_count: price(i) == null ? 0 : 1,
      offer_count: price(i) == null ? 0 : 1,
      has_flash_sale: false,
      flash_min_price: null,
    });
  }
  return rows;
}

describe("expandRollup", () => {
  it("sinh đúng một quan sát cho mỗi ngày có dữ liệu", () => {
    const obs = expandRollup(makeRows(5, () => 1000));
    expect(obs).toHaveLength(5);
  });

  it("bỏ qua ngày không có min_price", () => {
    const obs = expandRollup(makeRows(5, (i) => (i === 2 ? null : 1000)));
    expect(obs).toHaveLength(4);
  });

  it("đặt observed_at tại 12:00 giờ Việt Nam = 05:00Z", () => {
    const obs = expandRollup([
      {
        day: "2026-03-10",
        min_price: 1000,
        median_price: 1000,
        max_price: 1000,
        obs_count: 1,
        offer_count: 1,
        has_flash_sale: false,
        flash_min_price: null,
      },
    ]);
    expect(obs[0].observed_at).toBe("2026-03-10T05:00:00.000Z");
  });

  it("đánh dấu quan sát là hợp lệ và không phải flash sale", () => {
    const obs = expandRollup(makeRows(1, () => 1000));
    expect(obs[0].is_valid).toBe(true);
    expect(obs[0].is_flash_sale).toBe(false);
  });
});

describe("ngưỡng dữ liệu của deal-score khi đi qua rollup", () => {
  it("13 ngày đầy đủ vẫn là chưa đủ dữ liệu (ngưỡng 14 ngày)", () => {
    const r = computeDealScore({
      price: 1000,
      history: expandRollup(makeRows(13, () => 1000)),
    });
    expect(r.recommendation).toBe("insufficient_data");
    expect(r.score).toBeNull();
  });

  it("trải 14 ngày nhưng chỉ 9 ngày có dữ liệu là chưa đủ (ngưỡng 10 quan sát)", () => {
    // 14 ngày, cứ ngày chẵn mới có giá → 7 ngày có dữ liệu; thêm 2 ngày nữa = 9.
    const rows = makeRows(14, (i) => (i % 2 === 0 || i === 1 || i === 3 ? 1000 : null));
    const withData = rows.filter((r) => r.min_price != null).length;
    expect(withData).toBe(9);
    const r = computeDealScore({ price: 1000, history: expandRollup(rows) });
    expect(r.recommendation).toBe("insufficient_data");
  });

  it("trải 15 ngày và 10 ngày có dữ liệu thì chấm được điểm", () => {
    const rows = makeRows(15, (i) => (i < 10 ? 1000 + i : null));
    expect(rows.filter((r) => r.min_price != null)).toHaveLength(10);
    const r = computeDealScore({ price: 900, history: expandRollup(rows) });
    expect(r.recommendation).not.toBe("insufficient_data");
    expect(r.score).not.toBeNull();
  });
});

describe("medianWindow", () => {
  it("trả rỗng khi cửa sổ không có dữ liệu", () => {
    expect(medianWindow([], 30, 0, NOW)).toEqual({ value: null, dayCount: 0 });
  });

  it("chỉ đếm ngày thực sự có min_price", () => {
    const rows = makeRows(10, (i) => (i < 4 ? null : 2000));
    const w = medianWindow(rows, 30, 0, NOW);
    expect(w.dayCount).toBe(6);
    expect(w.value).toBe(2000);
  });

  it("cửa sổ là [from, to) — loại trừ mốc to, nên (30,0) không gồm hôm nay", () => {
    const rows = makeRows(3, () => 1000); // gồm cả hôm nay
    const w = medianWindow(rows, 30, 0, NOW);
    expect(w.dayCount).toBe(2);
  });

  it("cửa sổ [-74,-14) không giao với [-14,0)", () => {
    const recent = makeRows(14, () => 1000, 0);
    const older = makeRows(60, () => 2000, 14);
    const rows = [...older, ...recent];
    expect(medianWindow(rows, 14, 0, NOW).value).toBe(1000);
    expect(medianWindow(rows, 74, 14, NOW).value).toBe(2000);
  });
});
```

- [ ] **Step 2: Chạy test để xác nhận nó thất bại**

Run: `pnpm test price-history`
Expected: FAIL — `Failed to resolve import "@/lib/price-history"`.

- [ ] **Step 3: Viết cài đặt tối thiểu**

`src/lib/price-history.ts`:

```ts
/**
 * Cầu nối giữa bảng rollup `variant_daily_prices` và `computeDealScore()`.
 *
 * `deal-score.ts` nhận chuỗi quan sát thô. Ta không đưa thẳng
 * `price_observations` vào vì 90 ngày × nhiều offer là quá nặng, nên dùng
 * rollup theo ngày. Việc giãn lại diễn ra ở đây.
 */

import type { PriceObservation } from "@/lib/deal-score";
import { toVnDate } from "@/lib/format";

export interface DailyPriceRow {
  day: string; // 'YYYY-MM-DD'
  min_price: number | null;
  median_price: number | null;
  max_price: number | null;
  obs_count: number;
  offer_count: number;
  has_flash_sale: boolean;
  flash_min_price: number | null;
}

/**
 * Giãn rollup ngày thành chuỗi quan sát cho computeDealScore().
 *
 * Mỗi ngày đóng góp ĐÚNG MỘT quan sát: min_price, vốn đã loại flash sale ở
 * tầng SQL. Ngày không có min_price (chỉ có flash sale, hoặc collector hụt)
 * bị bỏ qua.
 *
 * Hệ quả CÓ CHỦ ĐÍCH với hai ngưỡng trong deal-score.ts:
 *   MIN_DAYS_FOR_SCORE (14)        → khoảng cách từ ngày đầu tới nay
 *   MIN_OBSERVATIONS_FOR_SCORE (10) → số NGÀY thực sự có dữ liệu
 * Hai ngưỡng vẫn phân biệt: ngưỡng sau nghĩa là collector không được hụt
 * quá 4 ngày trong 14. Đừng gộp chúng lại.
 *
 * observed_at đặt tại 12:00 giờ Việt Nam (= 05:00Z) để phép daysBetween
 * trong deal-score không lệch một ngày do biên nửa đêm.
 */
export function expandRollup(rows: DailyPriceRow[]): PriceObservation[] {
  return rows
    .filter((r) => r.min_price != null && r.min_price > 0)
    .map((r) => ({
      observed_at: `${r.day}T05:00:00.000Z`,
      price: r.min_price as number,
      is_flash_sale: false,
      is_valid: true,
    }));
}

/**
 * Trung vị min_price trong cửa sổ [now - fromDaysAgo, now - toDaysAgo).
 * Mốc `to` bị LOẠI TRỪ, nên medianWindow(rows, 30, 0) phủ ngày -30..-1 và
 * KHÔNG gồm hôm nay — đúng ý "so giá hôm nay với 30 ngày trước đó".
 *
 * dayCount = số ngày thực sự có min_price, dùng để quyết định có đủ dữ liệu
 * mà chạy heuristic Fake Sale hay không.
 */
export function medianWindow(
  rows: DailyPriceRow[],
  fromDaysAgo: number,
  toDaysAgo: number,
  now: Date = new Date(),
): { value: number | null; dayCount: number } {
  const from = toVnDate(new Date(now.getTime() - fromDaysAgo * 86_400_000));
  const to = toVnDate(new Date(now.getTime() - toDaysAgo * 86_400_000));

  const values = rows
    .filter(
      (r) =>
        r.day >= from && r.day < to && r.min_price != null && r.min_price > 0,
    )
    .map((r) => r.min_price as number)
    .sort((a, b) => a - b);

  if (values.length === 0) return { value: null, dayCount: 0 };

  const mid = Math.floor(values.length / 2);
  const value =
    values.length % 2 === 0 ? (values[mid - 1] + values[mid]) / 2 : values[mid];
  return { value, dayCount: values.length };
}
```

- [ ] **Step 4: Chạy test để xác nhận nó xanh**

Run: `pnpm test price-history`
Expected: PASS, 11 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/price-history.ts tests/lib/price-history.test.ts
git commit -m "$(cat <<'EOF'
feat(lib): giãn rollup ngày thành chuỗi quan sát cho deal-score

Mỗi ngày đóng góp một quan sát tại 12:00 giờ VN. Ngưỡng 10 quan sát của
deal-score nhờ đó mang nghĩa "collector không hụt quá 4 ngày trong 14".

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: `variant-pricing.ts` — lọc, sắp xếp, giá từng offer

**Files:**
- Create: `src/lib/variant-pricing.ts`
- Test: `tests/lib/variant-pricing.test.ts`

**Interfaces:**
- Consumes: `discountPercent` từ `@/lib/format`
- Produces:
  - `interface OfferRow { offerId: string; listingUrl: string | null; listingStatus: string; matchStatus: "auto" | "manual" | "rejected" | "pending"; sellerName: string | null; sellerRating: number | null; sellerRatingCount: number | null; sellerIsOfficial: boolean; affiliateEligible: boolean; price: number | null; originalPrice: number | null; stock: number | null; isFlashSale: boolean; observedAt: string }`
  - `interface PricedOffer extends OfferRow { inStock: boolean; discountPercent: number | null; dealScore: DealScoreResult | null }`
  - `isOfferVisible(offer: OfferRow, isDraftProduct: boolean): boolean`
  - `sortOffers(offers: PricedOffer[]): PricedOffer[]`

- [ ] **Step 1: Viết test thất bại**

`tests/lib/variant-pricing.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  isOfferVisible,
  sortOffers,
  type OfferRow,
  type PricedOffer,
} from "@/lib/variant-pricing";

function offer(over: Partial<OfferRow> = {}): OfferRow {
  return {
    offerId: "o1",
    listingUrl: "https://shopee.vn/x",
    listingStatus: "active",
    matchStatus: "auto",
    sellerName: "Shop A",
    sellerRating: 4.8,
    sellerRatingCount: 120,
    sellerIsOfficial: false,
    affiliateEligible: true,
    price: 1000,
    originalPrice: null,
    stock: 5,
    isFlashSale: false,
    observedAt: "2026-03-20T03:00:00Z",
    ...over,
  };
}

function priced(over: Partial<PricedOffer> = {}): PricedOffer {
  return {
    ...offer(),
    inStock: true,
    discountPercent: null,
    dealScore: null,
    ...over,
  };
}

describe("isOfferVisible", () => {
  it("hiện offer đã ghép tự động hoặc thủ công", () => {
    expect(isOfferVisible(offer({ matchStatus: "auto" }), false)).toBe(true);
    expect(isOfferVisible(offer({ matchStatus: "manual" }), false)).toBe(true);
  });

  it("ẩn offer pending trên sản phẩm đã verify — chưa chắc thì không khẳng định", () => {
    expect(isOfferVisible(offer({ matchStatus: "pending" }), false)).toBe(false);
  });

  it("hiện offer pending trên sản phẩm draft do ingest sinh ra", () => {
    expect(isOfferVisible(offer({ matchStatus: "pending" }), true)).toBe(true);
  });

  it("ẩn offer đã bị từ chối, kể cả trên sản phẩm draft", () => {
    expect(isOfferVisible(offer({ matchStatus: "rejected" }), true)).toBe(false);
  });

  it("ẩn offer thuộc listing không còn hoạt động", () => {
    expect(isOfferVisible(offer({ listingStatus: "inactive" }), true)).toBe(false);
  });
});

describe("sortOffers", () => {
  it("còn hàng lên trước, trong nhóm thì giá tăng dần", () => {
    const out = sortOffers([
      priced({ offerId: "b", price: 900, inStock: false }),
      priced({ offerId: "c", price: 1200 }),
      priced({ offerId: "a", price: 1000 }),
    ]);
    expect(out.map((o) => o.offerId)).toEqual(["a", "c", "b"]);
  });

  it("offer không có giá xuống cuối cùng", () => {
    const out = sortOffers([
      priced({ offerId: "x", price: null }),
      priced({ offerId: "y", price: 1000 }),
    ]);
    expect(out.map((o) => o.offerId)).toEqual(["y", "x"]);
  });

  it("so sánh nhất quán khi cả hai đều không có giá", () => {
    const out = sortOffers([
      priced({ offerId: "x", price: null }),
      priced({ offerId: "y", price: null }),
    ]);
    expect(out).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Chạy test để xác nhận nó thất bại**

Run: `pnpm test variant-pricing`
Expected: FAIL — `Failed to resolve import "@/lib/variant-pricing"`.

- [ ] **Step 3: Viết cài đặt tối thiểu**

`src/lib/variant-pricing.ts`:

```ts
/**
 * Lắp ráp toàn bộ dữ liệu giá của một variant cho trang sản phẩm (1.2).
 * Component chỉ nhận kết quả của file này, không tự tính lại gì.
 */

import type { DealScoreResult } from "@/lib/deal-score";
import { discountPercent } from "@/lib/format";

export interface OfferRow {
  offerId: string;
  listingUrl: string | null;
  listingStatus: string;
  matchStatus: "auto" | "manual" | "rejected" | "pending";
  sellerName: string | null;
  sellerRating: number | null;
  sellerRatingCount: number | null;
  sellerIsOfficial: boolean;
  affiliateEligible: boolean;
  price: number | null;
  originalPrice: number | null;
  stock: number | null;
  isFlashSale: boolean;
  observedAt: string;
}

export interface PricedOffer extends OfferRow {
  inStock: boolean;
  discountPercent: number | null;
  /** Điểm riêng của offer này so với offer rẻ nhất. */
  dealScore: DealScoreResult | null;
}

/**
 * Offer nào được phép hiện cho người dùng.
 *
 * Offer `pending` trên sản phẩm đã verify KHÔNG được hiện: matching chưa chắc
 * thì không được khẳng định "đây cùng một sản phẩm".
 * Ngoại lệ duy nhất là sản phẩm `draft` do luồng dán URL sinh ra — offer của
 * nó trỏ vào chính variant draft đó nên luôn đúng.
 */
export function isOfferVisible(offer: OfferRow, isDraftProduct: boolean): boolean {
  if (offer.listingStatus !== "active") return false;
  if (offer.matchStatus === "auto" || offer.matchStatus === "manual") return true;
  if (offer.matchStatus === "pending" && isDraftProduct) return true;
  return false;
}

/** stock null nghĩa là sàn không cho biết — coi như còn hàng. */
export function isInStock(offer: OfferRow): boolean {
  return offer.stock === null || offer.stock > 0;
}

/** Còn hàng theo giá tăng dần, rồi hết hàng, offer không có giá xuống cuối. */
export function sortOffers(offers: PricedOffer[]): PricedOffer[] {
  return [...offers].sort((a, b) => {
    if (a.inStock !== b.inStock) return a.inStock ? -1 : 1;
    if (a.price == null && b.price == null) return 0;
    if (a.price == null) return 1;
    if (b.price == null) return -1;
    return a.price - b.price;
  });
}

/** Gắn các trường phái sinh không phụ thuộc lịch sử giá. */
export function toPricedOffer(offer: OfferRow): PricedOffer {
  return {
    ...offer,
    inStock: isInStock(offer),
    discountPercent: discountPercent(offer.price, offer.originalPrice),
    dealScore: null,
  };
}
```

- [ ] **Step 4: Chạy test để xác nhận nó xanh**

Run: `pnpm test variant-pricing`
Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/variant-pricing.ts tests/lib/variant-pricing.test.ts
git commit -m "$(cat <<'EOF'
feat(lib): lọc và sắp xếp offer cho trang sản phẩm

Offer pending chỉ hiện trên sản phẩm draft — matching chưa chắc thì không
khẳng định là cùng một sản phẩm.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: `variant-pricing.ts` — điểm đầu trang và Fake Sale

Task này chứa hai cái bẫy đắt nhất của cả dự án. Đọc kỹ phần ghi chú trong code.

**Files:**
- Modify: `src/lib/variant-pricing.ts`
- Modify: `tests/lib/variant-pricing.test.ts`

**Interfaces:**
- Consumes: `computeDealScore`, `detectFakeSale` từ `@/lib/deal-score` · `expandRollup`, `medianWindow`, `DailyPriceRow` từ `@/lib/price-history` · `daysBetween` từ `@/lib/format` · `isOfferVisible`, `sortOffers`, `toPricedOffer` từ Task 7
- Produces:
  - `interface VariantPricing { offers: PricedOffer[]; cheapest: PricedOffer | null; headline: DealScoreResult | null; fakeSaleMessage: string | null; trackingSince: string | null; updatedAt: string | null; isStale: boolean }`
  - `buildVariantPricing(input: { offers: OfferRow[]; history: DailyPriceRow[]; trackingSince: string | null; isDraftProduct: boolean; now?: Date }): VariantPricing`

- [ ] **Step 1: Viết test thất bại**

Trong `tests/lib/variant-pricing.test.ts`, **sửa dòng import sẵn có** thành (import trùng tên binding hai lần là SyntaxError, không phải cảnh báo):

```ts
import { describe, expect, it } from "vitest";
import { computeDealScore } from "@/lib/deal-score";
import { expandRollup, type DailyPriceRow } from "@/lib/price-history";
import {
  buildVariantPricing,
  isOfferVisible,
  sortOffers,
  type OfferRow,
  type PricedOffer,
} from "@/lib/variant-pricing";
```

Rồi nối phần dưới đây vào cuối file:

```ts
const NOW2 = new Date("2026-03-20T03:00:00Z");

function history(
  n: number,
  price: (i: number) => number,
  extra: Partial<DailyPriceRow> = {},
): DailyPriceRow[] {
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(NOW2.getTime() - (n - 1 - i) * 86_400_000);
    return {
      day: d.toISOString().slice(0, 10),
      min_price: price(i),
      median_price: price(i),
      max_price: price(i),
      obs_count: 1,
      offer_count: 1,
      has_flash_sale: false,
      flash_min_price: null,
      ...extra,
    };
  });
}

describe("buildVariantPricing — điểm đầu trang (quyết định Đ7)", () => {
  const hist = history(60, (i) => 1000 + (i % 10) * 20);

  it("KHÔNG truyền bestOffer, nên điểm thấp hơn khi truyền bestOffer = chính nó", () => {
    const out = buildVariantPricing({
      offers: [offer({ price: 950 })],
      history: hist,
      trackingSince: "2026-01-20",
      isDraftProduct: false,
      now: NOW2,
    });

    const inflated = computeDealScore({
      price: 950,
      history: expandRollup(hist),
      bestOffer: 950, // cBetween luôn = 100 → cộng khống +20
    });

    expect(out.headline).not.toBeNull();
    expect(out.headline!.score).toBeLessThan(inflated.score!);
  });

  it("chấm điểm cho offer còn hàng rẻ nhất", () => {
    const out = buildVariantPricing({
      offers: [
        offer({ offerId: "a", price: 1200 }),
        offer({ offerId: "b", price: 900 }),
      ],
      history: hist,
      trackingSince: null,
      isDraftProduct: false,
      now: NOW2,
    });
    expect(out.cheapest?.offerId).toBe("b");
  });

  it("bỏ qua offer hết hàng khi chọn offer rẻ nhất", () => {
    const out = buildVariantPricing({
      offers: [
        offer({ offerId: "a", price: 800, stock: 0 }),
        offer({ offerId: "b", price: 900 }),
      ],
      history: hist,
      trackingSince: null,
      isDraftProduct: false,
      now: NOW2,
    });
    expect(out.cheapest?.offerId).toBe("b");
  });

  it("không chấm điểm khi mọi offer đều hết hàng", () => {
    const out = buildVariantPricing({
      offers: [offer({ price: 900, stock: 0 })],
      history: hist,
      trackingSince: null,
      isDraftProduct: false,
      now: NOW2,
    });
    expect(out.cheapest).toBeNull();
    expect(out.headline).toBeNull();
  });

  it("điểm riêng từng offer CÓ truyền bestOffer", () => {
    const out = buildVariantPricing({
      offers: [
        offer({ offerId: "a", price: 900 }),
        offer({ offerId: "b", price: 1500 }),
      ],
      history: hist,
      trackingSince: null,
      isDraftProduct: false,
      now: NOW2,
    });
    const a = out.offers.find((o) => o.offerId === "a")!;
    const b = out.offers.find((o) => o.offerId === "b")!;
    expect(a.dealScore!.score).toBeGreaterThan(b.dealScore!.score!);
  });
});

describe("buildVariantPricing — Fake Sale chỉ chạy khi đủ dữ liệu", () => {
  it("không ra nhãn khi lịch sử quá ngắn", () => {
    const out = buildVariantPricing({
      offers: [offer({ price: 900, originalPrice: 2000 })],
      history: history(5, () => 1000),
      trackingSince: null,
      isDraftProduct: false,
      now: NOW2,
    });
    expect(out.fakeSaleMessage).toBeNull();
  });

  it("không ra nhãn khi thiếu giá niêm yết", () => {
    const out = buildVariantPricing({
      offers: [offer({ price: 1000, originalPrice: null })],
      history: history(40, () => 1000),
      trackingSince: null,
      isDraftProduct: false,
      now: NOW2,
    });
    expect(out.fakeSaleMessage).toBeNull();
  });

  it("ra nhãn khi giảm niêm yết lớn mà giá vẫn quanh mức thường ngày", () => {
    const out = buildVariantPricing({
      offers: [offer({ price: 1000, originalPrice: 2000 })], // giảm 50%
      history: history(40, () => 1000), // nhưng vẫn đúng bằng median
      trackingSince: null,
      isDraftProduct: false,
      now: NOW2,
    });
    expect(out.fakeSaleMessage).not.toBeNull();
  });
});

describe("buildVariantPricing — độ tươi dữ liệu", () => {
  it("đánh dấu cũ khi quan sát mới nhất quá 48 giờ", () => {
    const out = buildVariantPricing({
      offers: [offer({ observedAt: "2026-03-17T03:00:00Z" })], // 3 ngày trước
      history: history(30, () => 1000),
      trackingSince: null,
      isDraftProduct: false,
      now: NOW2,
    });
    expect(out.isStale).toBe(true);
  });

  it("không đánh dấu cũ khi dữ liệu trong 48 giờ", () => {
    const out = buildVariantPricing({
      offers: [offer({ observedAt: "2026-03-19T03:00:00Z" })],
      history: history(30, () => 1000),
      trackingSince: null,
      isDraftProduct: false,
      now: NOW2,
    });
    expect(out.isStale).toBe(false);
  });
});
```

- [ ] **Step 2: Chạy test để xác nhận nó thất bại**

Run: `pnpm test variant-pricing`
Expected: FAIL — `buildVariantPricing is not exported`.

- [ ] **Step 3: Viết cài đặt tối thiểu**

Nối vào cuối `src/lib/variant-pricing.ts`:

```ts
import { computeDealScore, detectFakeSale } from "@/lib/deal-score";
import { daysBetween } from "@/lib/format";
import { expandRollup, medianWindow, type DailyPriceRow } from "@/lib/price-history";

export interface VariantPricing {
  /** Đã lọc và sắp xếp. Tầng hiển thị KHÔNG lọc lại, KHÔNG sắp lại. */
  offers: PricedOffer[];
  /** Offer còn hàng rẻ nhất. null khi mọi offer đều hết hàng. */
  cheapest: PricedOffer | null;
  /** Điểm hiển thị đầu trang. Xem ghi chú Đ7 bên dưới. */
  headline: DealScoreResult | null;
  fakeSaleMessage: string | null;
  trackingSince: string | null;
  updatedAt: string | null;
  /** Quan sát mới nhất cũ hơn 48 giờ. */
  isStale: boolean;
}

const STALE_AFTER_DAYS = 2;

export function buildVariantPricing(input: {
  offers: OfferRow[];
  history: DailyPriceRow[];
  trackingSince: string | null;
  isDraftProduct: boolean;
  now?: Date;
}): VariantPricing {
  const { offers, history, trackingSince, isDraftProduct } = input;
  const now = input.now ?? new Date();

  const visible = offers
    .filter((o) => isOfferVisible(o, isDraftProduct))
    .map(toPricedOffer);
  const sorted = sortOffers(visible);

  const cheapest = sorted.find((o) => o.inStock && o.price != null) ?? null;
  const observations = expandRollup(history);

  // ---------------------------------------------------------------- Đ7
  // Điểm đầu trang chấm cho offer rẻ nhất và KHÔNG truyền bestOffer.
  //
  // Truyền bestOffer = chính nó thì thành phần 3 của computeDealScore luôn
  // bằng 100 (vì cheapest <= cheapest), cộng khống tới +20 điểm. Ngưỡng
  // "Nên mua >= 75" sẽ mất ý nghĩa và cổng backtest >= 80% sang G2 chắc trượt.
  //
  // computeDealScore đã có sẵn nhánh reweight 62.5/37.5 cho đúng tình huống
  // thiếu dữ liệu so sánh có nghĩa này — dùng nó.
  const headline =
    cheapest?.price != null
      ? computeDealScore({ price: cheapest.price, history: observations })
      : null;

  // Điểm riêng từng offer: ĐÂY là chỗ duy nhất truyền bestOffer, vì so sánh
  // một offer với offer rẻ nhất là phép so sánh có thật.
  if (cheapest?.price != null) {
    for (const o of sorted) {
      if (o.price == null) continue;
      o.dealScore = computeDealScore({
        price: o.price,
        history: observations,
        bestOffer: cheapest.price,
      });
    }
  }

  const updatedAt =
    sorted.length > 0
      ? sorted.map((o) => o.observedAt).sort().at(-1) ?? null
      : null;

  return {
    offers: sorted,
    cheapest,
    headline,
    fakeSaleMessage: buildFakeSaleMessage(cheapest, history, now),
    trackingSince,
    updatedAt,
    isStale: updatedAt ? daysBetween(now, updatedAt) > STALE_AFTER_DAYS : false,
  };
}

/**
 * Nhãn "Giảm giá chưa thực chất".
 *
 * Nhãn này là MỘT PHÁT NGÔN VỀ NGƯỜI BÁN. Báo nhầm vì thiếu dữ liệu vừa làm
 * mất niềm tin vào sản phẩm, vừa là rủi ro pháp lý. Thà bỏ sót còn hơn.
 * Vì vậy mỗi heuristic chỉ được bật khi cửa sổ của nó đủ dày.
 */
function buildFakeSaleMessage(
  cheapest: PricedOffer | null,
  history: DailyPriceRow[],
  now: Date,
): string | null {
  if (!cheapest || cheapest.price == null) return null;

  const m30 = medianWindow(history, 30, 0, now);
  const m14 = medianWindow(history, 14, 0, now);
  const m60 = medianWindow(history, 74, 14, now);

  // Heuristic 1 (giảm niêm yết ảo) cần: 14 ngày dữ liệu trong 30 ngày,
  // có trung vị, VÀ có giá niêm yết thật.
  //
  // Nếu để lọt median30d = 0 vào detectFakeSale thì điều kiện
  // `currentPrice >= median30d * 0.95` luôn đúng → cảnh báo sai hàng loạt.
  const h1Ok =
    m30.dayCount >= 14 && m30.value != null && (cheapest.originalPrice ?? 0) > 0;

  // Heuristic 2 (tăng giá trước sale) cần cả hai cửa sổ đủ dày.
  const h2Ok = m14.dayCount >= 10 && m60.dayCount >= 30;

  if (!h1Ok && !h2Ok) return null;

  return detectFakeSale({
    currentPrice: cheapest.price,
    listedPrice: h1Ok ? (cheapest.originalPrice as number) : 0,
    median30d: h1Ok ? (m30.value as number) : 0,
    median14dBeforeSale: h2Ok ? (m14.value ?? undefined) : undefined,
    median60dBefore: h2Ok ? (m60.value ?? undefined) : undefined,
  });
}
```

- [ ] **Step 4: Chạy test để xác nhận nó xanh**

Run: `pnpm test variant-pricing`
Expected: PASS, 18 tests.

- [ ] **Step 5: Chạy toàn bộ test và lint**

Run: `pnpm test && pnpm lint`
Expected: tất cả PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/variant-pricing.ts tests/lib/variant-pricing.test.ts
git commit -m "$(cat <<'EOF'
feat(lib): tính điểm đầu trang và nhãn Fake Sale cho variant

Điểm đầu trang KHÔNG truyền bestOffer (quyết định Đ7): chấm offer rẻ nhất
mà truyền bestOffer = chính nó sẽ cộng khống +20 điểm.

Fake Sale chỉ chạy khi cửa sổ đủ dày, và chặn median30d = 0 lọt vào
detectFakeSale — nếu không sẽ cảnh báo sai hàng loạt.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: `src/lib/chart-series.ts`

**Files:**
- Create: `src/lib/chart-series.ts`
- Test: `tests/lib/chart-series.test.ts`

**Interfaces:**
- Consumes: `DailyPriceRow` từ `@/lib/price-history` · `toVnDate` từ `@/lib/format`
- Produces:
  - `interface ChartPoint { day: string; price: number }`
  - `interface FlashMarker { day: string; price: number }`
  - `interface ChartSeries { segments: ChartPoint[][]; flashMarkers: FlashMarker[]; min: number | null; max: number | null; renderable: boolean }`
  - `buildChartSeries(rows: DailyPriceRow[], rangeDays: 7 | 30 | 90, now?: Date): ChartSeries`

- [ ] **Step 1: Viết test thất bại**

`tests/lib/chart-series.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { buildChartSeries } from "@/lib/chart-series";
import type { DailyPriceRow } from "@/lib/price-history";

const NOW = new Date("2026-03-20T03:00:00Z");

function rows(prices: Array<number | null>, flash: number[] = []): DailyPriceRow[] {
  return prices.map((p, i) => {
    const daysAgo = prices.length - 1 - i;
    const d = new Date(NOW.getTime() - daysAgo * 86_400_000);
    return {
      day: d.toISOString().slice(0, 10),
      min_price: p,
      median_price: p,
      max_price: p,
      obs_count: p == null ? 0 : 1,
      offer_count: p == null ? 0 : 1,
      has_flash_sale: flash.includes(i),
      flash_min_price: flash.includes(i) ? 500 : null,
    };
  });
}

describe("buildChartSeries", () => {
  it("gom các ngày liên tiếp thành một đoạn", () => {
    const s = buildChartSeries(rows([1000, 1100, 1200]), 7, NOW);
    expect(s.segments).toHaveLength(1);
    expect(s.segments[0]).toHaveLength(3);
  });

  it("NGẮT đoạn ở ngày thiếu dữ liệu — không nội suy qua chỗ trống", () => {
    const s = buildChartSeries(rows([1000, null, 1200]), 7, NOW);
    expect(s.segments).toHaveLength(2);
    expect(s.segments[0]).toHaveLength(1);
    expect(s.segments[1]).toHaveLength(1);
  });

  it("ngắt đoạn cả khi dòng ngày đó vắng mặt hoàn toàn", () => {
    const all = rows([1000, 1100, 1200]);
    const withHole = [all[0], all[2]]; // bỏ hẳn ngày giữa
    const s = buildChartSeries(withHole, 7, NOW);
    expect(s.segments).toHaveLength(2);
  });

  it("cắt theo rangeDays", () => {
    const s = buildChartSeries(rows(Array(40).fill(1000)), 7, NOW);
    expect(s.segments.flat().length).toBeLessThanOrEqual(8);
  });

  it("không vẽ được khi có dưới 2 điểm", () => {
    expect(buildChartSeries(rows([1000]), 7, NOW).renderable).toBe(false);
    expect(buildChartSeries([], 7, NOW).renderable).toBe(false);
  });

  it("tính min và max trên các điểm trong cửa sổ", () => {
    const s = buildChartSeries(rows([1000, 1500, 800]), 7, NOW);
    expect(s.min).toBe(800);
    expect(s.max).toBe(1500);
  });

  it("sinh marker cho ngày có flash sale", () => {
    const s = buildChartSeries(rows([1000, 1100, 1200], [1]), 7, NOW);
    expect(s.flashMarkers).toHaveLength(1);
    expect(s.flashMarkers[0].price).toBe(500);
  });

  it("không sinh marker khi thiếu flash_min_price", () => {
    const r = rows([1000, 1100]);
    r[1].has_flash_sale = true;
    r[1].flash_min_price = null;
    expect(buildChartSeries(r, 7, NOW).flashMarkers).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Chạy test để xác nhận nó thất bại**

Run: `pnpm test chart-series`
Expected: FAIL — `Failed to resolve import "@/lib/chart-series"`.

- [ ] **Step 3: Viết cài đặt tối thiểu**

`src/lib/chart-series.ts`:

```ts
/**
 * Chuẩn bị dữ liệu cho biểu đồ giá. KHÔNG vẽ gì — việc vẽ thuộc tầng UI.
 */

import { toVnDate } from "@/lib/format";
import type { DailyPriceRow } from "@/lib/price-history";

export interface ChartPoint {
  day: string;
  price: number;
}

export interface FlashMarker {
  day: string;
  price: number;
}

export interface ChartSeries {
  /** Các đoạn liên tục. Ngày thiếu dữ liệu NGẮT đoạn — vẽ liền qua chỗ trống là bịa số liệu. */
  segments: ChartPoint[][];
  flashMarkers: FlashMarker[];
  min: number | null;
  max: number | null;
  /** false khi có dưới 2 điểm — chưa đủ để vẽ đường. */
  renderable: boolean;
}

/** Số ngày giữa hai chuỗi 'YYYY-MM-DD'. */
function dayDiff(a: string, b: string): number {
  return Math.round(
    (Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000,
  );
}

/**
 * rangeDays CHỈ cắt biểu đồ. Cửa sổ tính Deal Score luôn là 90 ngày —
 * nếu để range chi phối cửa sổ tính điểm thì bấm tab "7 ngày" sẽ làm đổi điểm.
 */
export function buildChartSeries(
  rows: DailyPriceRow[],
  rangeDays: 7 | 30 | 90,
  now: Date = new Date(),
): ChartSeries {
  const from = toVnDate(new Date(now.getTime() - rangeDays * 86_400_000));

  const inRange = rows
    .filter((r) => r.day >= from)
    .sort((a, b) => a.day.localeCompare(b.day));

  const segments: ChartPoint[][] = [];
  let current: ChartPoint[] = [];
  let prevDay: string | null = null;

  const flush = () => {
    if (current.length > 0) segments.push(current);
    current = [];
  };

  for (const r of inRange) {
    if (r.min_price == null || r.min_price <= 0) {
      flush();
      prevDay = null;
      continue;
    }
    // Dòng của ngày ở giữa có thể vắng mặt hoàn toàn, không chỉ là null.
    if (prevDay !== null && dayDiff(prevDay, r.day) > 1) flush();
    current.push({ day: r.day, price: r.min_price });
    prevDay = r.day;
  }
  flush();

  const flashMarkers: FlashMarker[] = inRange
    .filter((r) => r.has_flash_sale && r.flash_min_price != null)
    .map((r) => ({ day: r.day, price: r.flash_min_price as number }));

  const prices = segments.flat().map((p) => p.price);

  return {
    segments,
    flashMarkers,
    min: prices.length > 0 ? Math.min(...prices) : null,
    max: prices.length > 0 ? Math.max(...prices) : null,
    renderable: prices.length >= 2,
  };
}
```

- [ ] **Step 4: Chạy test để xác nhận nó xanh**

Run: `pnpm test chart-series`
Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/chart-series.ts tests/lib/chart-series.test.ts
git commit -m "$(cat <<'EOF'
feat(lib): chuẩn bị dữ liệu biểu đồ giá, ngắt đoạn ở ngày thiếu dữ liệu

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 10: `src/lib/shopee/parse-url.ts`

Hàm thuần, không gọi mạng — nên thuộc Plan 1 dù liên quan Shopee.

**Files:**
- Create: `src/lib/shopee/parse-url.ts`
- Test: `tests/lib/shopee/parse-url.test.ts`

**Interfaces:**
- Consumes: không
- Produces:
  - `type ParsedShopeeUrl = { ok: true; shopId: string; itemId: string } | { ok: false; reason: "not_a_url" | "not_shopee" | "unrecognized_format" | "needs_redirect" }`
  - `parseShopeeUrl(raw: string): ParsedShopeeUrl`
  - `externalItemId(shopId: string, itemId: string): string`
  - `extractFirstUrl(text: string): string | null`

- [ ] **Step 1: Viết test thất bại**

`tests/lib/shopee/parse-url.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  extractFirstUrl,
  externalItemId,
  parseShopeeUrl,
} from "@/lib/shopee/parse-url";

describe("parseShopeeUrl", () => {
  it("đọc được dạng canonical", () => {
    expect(parseShopeeUrl("https://shopee.vn/product/123456/789012")).toEqual({
      ok: true,
      shopId: "123456",
      itemId: "789012",
    });
  });

  it("đọc được dạng slug -i.shopid.itemid", () => {
    expect(
      parseShopeeUrl("https://shopee.vn/O-cung-SSD-Samsung-i.123456.789012"),
    ).toEqual({ ok: true, shopId: "123456", itemId: "789012" });
  });

  it("bỏ qua query rác", () => {
    expect(
      parseShopeeUrl("https://shopee.vn/product/123456/789012?sp_atk=x&xptdk=y"),
    ).toEqual({ ok: true, shopId: "123456", itemId: "789012" });
  });

  it("chấp nhận www và khoảng trắng thừa", () => {
    expect(parseShopeeUrl("  https://www.shopee.vn/product/1/2  ")).toEqual({
      ok: true,
      shopId: "1",
      itemId: "2",
    });
  });

  it("báo cần theo redirect với link rút gọn", () => {
    expect(parseShopeeUrl("https://shope.ee/abcXYZ")).toEqual({
      ok: false,
      reason: "needs_redirect",
    });
    expect(parseShopeeUrl("https://s.shopee.vn/abcXYZ")).toEqual({
      ok: false,
      reason: "needs_redirect",
    });
  });

  it("phân biệt sàn khác với chuỗi không phải URL", () => {
    expect(parseShopeeUrl("https://lazada.vn/abc")).toEqual({
      ok: false,
      reason: "not_shopee",
    });
    expect(parseShopeeUrl("ssd samsung 2tb")).toEqual({
      ok: false,
      reason: "not_a_url",
    });
  });

  it("chặn host giả mạo dạng shopee.vn.evil.com", () => {
    expect(parseShopeeUrl("https://shopee.vn.evil.com/product/1/2")).toEqual({
      ok: false,
      reason: "not_shopee",
    });
  });

  it("báo không đọc được với đường dẫn Shopee lạ", () => {
    expect(parseShopeeUrl("https://shopee.vn/mall")).toEqual({
      ok: false,
      reason: "unrecognized_format",
    });
  });
});

describe("externalItemId", () => {
  it("dùng chung quy ước với collector", () => {
    expect(externalItemId("123", "456")).toBe("123_456");
  });
});

describe("extractFirstUrl", () => {
  it("rút URL ra khỏi văn bản chia sẻ", () => {
    expect(extractFirstUrl("Xem sản phẩm này nè https://shope.ee/abc hay lắm")).toBe(
      "https://shope.ee/abc",
    );
  });

  it("trả null khi không có URL", () => {
    expect(extractFirstUrl("không có link")).toBeNull();
  });
});
```

- [ ] **Step 2: Chạy test để xác nhận nó thất bại**

Run: `pnpm test parse-url`
Expected: FAIL — `Failed to resolve import "@/lib/shopee/parse-url"`.

- [ ] **Step 3: Viết cài đặt tối thiểu**

`src/lib/shopee/parse-url.ts`:

```ts
/**
 * Parse URL sản phẩm Shopee. Hàm thuần, KHÔNG gọi mạng — import được cả vào
 * Client Component để nhận diện URL ngay trong ô tìm kiếm.
 */

const SHOPEE_HOSTS = new Set(["shopee.vn", "www.shopee.vn"]);
const SHORT_HOSTS = new Set(["shope.ee", "s.shopee.vn"]);

export type ParsedShopeeUrl =
  | { ok: true; shopId: string; itemId: string }
  | {
      ok: false;
      reason: "not_a_url" | "not_shopee" | "unrecognized_format" | "needs_redirect";
    };

export function parseShopeeUrl(raw: string): ParsedShopeeUrl {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return { ok: false, reason: "not_a_url" };
  }

  // So khớp host CHÍNH XÁC. endsWith('shopee.vn') sẽ cho lọt shopee.vn.evil.com.
  const host = u.hostname.toLowerCase();
  if (SHORT_HOSTS.has(host)) return { ok: false, reason: "needs_redirect" };
  if (!SHOPEE_HOSTS.has(host)) return { ok: false, reason: "not_shopee" };

  const canonical = u.pathname.match(/^\/product\/(\d+)\/(\d+)\/?$/);
  if (canonical) return { ok: true, shopId: canonical[1], itemId: canonical[2] };

  const slug = u.pathname.match(/-i\.(\d+)\.(\d+)\/?$/);
  if (slug) return { ok: true, shopId: slug[1], itemId: slug[2] };

  return { ok: false, reason: "unrecognized_format" };
}

/** Quy ước khóa ngoại dùng chung với collector: listings.external_item_id. */
export function externalItemId(shopId: string, itemId: string): string {
  return `${shopId}_${itemId}`;
}

/** Rút URL đầu tiên ra khỏi một đoạn text (cho PWA share target). */
export function extractFirstUrl(text: string): string | null {
  const m = text.match(/https?:\/\/[^\s<>"']+/i);
  return m ? m[0] : null;
}
```

- [ ] **Step 4: Chạy test để xác nhận nó xanh**

Run: `pnpm test parse-url`
Expected: PASS, 11 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/shopee/parse-url.ts tests/lib/shopee/parse-url.test.ts
git commit -m "$(cat <<'EOF'
feat(lib): parse URL Shopee, so khớp host chính xác

Chặn host giả mạo dạng shopee.vn.evil.com bằng so khớp tập host thay vì endsWith.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 11: `src/lib/search.ts` — parse/serialize tham số URL

**Files:**
- Create: `src/lib/search.ts`
- Test: `tests/lib/search.test.ts`

**Interfaces:**
- Consumes: không (phần gọi DB ở Task 12)
- Produces:
  - `type SortKey = "relevance" | "deal_score" | "price_asc" | "price_desc" | "updated"`
  - `interface SearchParams { q?: string; categoryId?: string; brands?: string[]; minPrice?: number; maxPrice?: number; sort: SortKey; page: number }`
  - `const PAGE_SIZE = 24`
  - `parseSearchParams(sp: URLSearchParams): SearchParams`
  - `toSearchParams(p: SearchParams): URLSearchParams`

- [ ] **Step 1: Viết test thất bại**

`tests/lib/search.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { parseSearchParams, toSearchParams } from "@/lib/search";

const parse = (qs: string) => parseSearchParams(new URLSearchParams(qs));

describe("parseSearchParams", () => {
  it("mặc định sort là relevance khi có từ khóa", () => {
    expect(parse("q=ssd").sort).toBe("relevance");
  });

  it("mặc định sort là updated khi không có từ khóa", () => {
    expect(parse("").sort).toBe("updated");
  });

  it("nhận nhiều brand", () => {
    expect(parse("brand=samsung&brand=wd").brands).toEqual(["samsung", "wd"]);
  });

  it("hoán đổi khi min lớn hơn max", () => {
    const p = parse("min=500&max=100");
    expect(p.minPrice).toBe(100);
    expect(p.maxPrice).toBe(500);
  });

  it("ép page về 1 khi nhỏ hơn 1 hoặc không phải số", () => {
    expect(parse("page=0").page).toBe(1);
    expect(parse("page=-3").page).toBe(1);
    expect(parse("page=abc").page).toBe(1);
  });

  it("bỏ qua sort lạ và quay về mặc định", () => {
    expect(parse("q=ssd&sort=hacker").sort).toBe("relevance");
  });

  it("bỏ qua giá không phải số", () => {
    const p = parse("min=abc");
    expect(p.minPrice).toBeUndefined();
  });
});

describe("round-trip parse ↔ serialize", () => {
  it("giữ nguyên mọi tham số — điều kiện để filter chia sẻ được qua URL", () => {
    const original =
      "q=ssd+samsung&cat=11111111-1111-1111-1111-111111111111&brand=samsung&brand=wd&min=100&max=500&sort=price_asc&page=3";
    const once = parseSearchParams(new URLSearchParams(original));
    const twice = parseSearchParams(toSearchParams(once));
    expect(twice).toEqual(once);
  });

  it("không ghi tham số mặc định vào URL", () => {
    const qs = toSearchParams(parse("q=ssd")).toString();
    expect(qs).not.toContain("page=");
    expect(qs).not.toContain("sort=");
  });
});
```

- [ ] **Step 2: Chạy test để xác nhận nó thất bại**

Run: `pnpm test search`
Expected: FAIL — `Failed to resolve import "@/lib/search"`.

- [ ] **Step 3: Viết cài đặt tối thiểu**

`src/lib/search.ts`:

```ts
/**
 * Tham số tìm kiếm nằm trong URL để chia sẻ được, back/forward đúng và SSR được.
 * parseSearchParams và toSearchParams phải round-trip được — đó là điều kiện
 * để bộ lọc dựng bằng <Link> hoạt động.
 */

export type SortKey =
  | "relevance"
  | "deal_score"
  | "price_asc"
  | "price_desc"
  | "updated";

const SORT_KEYS: readonly SortKey[] = [
  "relevance",
  "deal_score",
  "price_asc",
  "price_desc",
  "updated",
];

export const PAGE_SIZE = 24;

export interface SearchParams {
  q?: string;
  categoryId?: string;
  brands?: string[];
  minPrice?: number;
  maxPrice?: number;
  sort: SortKey;
  page: number;
}

function toNumber(raw: string | null): number | undefined {
  if (raw == null || raw.trim() === "") return undefined;
  const n = Number(raw);
  return Number.isFinite(n) ? n : undefined;
}

export function parseSearchParams(sp: URLSearchParams): SearchParams {
  const q = sp.get("q")?.trim() || undefined;

  let minPrice = toNumber(sp.get("min"));
  let maxPrice = toNumber(sp.get("max"));
  if (minPrice != null && maxPrice != null && minPrice > maxPrice) {
    [minPrice, maxPrice] = [maxPrice, minPrice];
  }

  const rawSort = sp.get("sort") as SortKey | null;
  const sort: SortKey =
    rawSort && SORT_KEYS.includes(rawSort) ? rawSort : q ? "relevance" : "updated";

  const rawPage = toNumber(sp.get("page"));
  const page = rawPage != null && rawPage >= 1 ? Math.floor(rawPage) : 1;

  const brands = sp.getAll("brand").filter((b) => b.trim() !== "");

  return {
    q,
    categoryId: sp.get("cat") || undefined,
    brands: brands.length > 0 ? brands : undefined,
    minPrice,
    maxPrice,
    sort,
    page,
  };
}

export function toSearchParams(p: SearchParams): URLSearchParams {
  const sp = new URLSearchParams();
  if (p.q) sp.set("q", p.q);
  if (p.categoryId) sp.set("cat", p.categoryId);
  for (const b of p.brands ?? []) sp.append("brand", b);
  if (p.minPrice != null) sp.set("min", String(p.minPrice));
  if (p.maxPrice != null) sp.set("max", String(p.maxPrice));

  // Không ghi giá trị mặc định vào URL — giữ link sạch và tránh trùng lặp SEO.
  const defaultSort: SortKey = p.q ? "relevance" : "updated";
  if (p.sort !== defaultSort) sp.set("sort", p.sort);
  if (p.page > 1) sp.set("page", String(p.page));

  return sp;
}
```

- [ ] **Step 4: Chạy test để xác nhận nó xanh**

Run: `pnpm test search`
Expected: PASS, 9 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/search.ts tests/lib/search.test.ts
git commit -m "$(cat <<'EOF'
feat(lib): parse và serialize tham số tìm kiếm, round-trip qua URL

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 12: `searchProducts()` — gọi RPC

**Files:**
- Modify: `src/lib/search.ts`

**Interfaces:**
- Consumes: `parseSearchParams`, `PAGE_SIZE` từ Task 11 · RPC `search_products` từ Task 3 · `createClient` từ `@/lib/supabase/server`
- Produces:
  - `interface SearchItem { productId: string; slug: string; name: string; brand: string | null; image: string | null; categorySlug: string | null; bestPrice: number | null; originalPrice: number | null; score: number | null; recommendation: string | null; lastObservedAt: string | null }`
  - `interface SearchResult { items: SearchItem[]; total: number; page: number; pageSize: number }`
  - `searchProducts(p: SearchParams): Promise<SearchResult>`

- [ ] **Step 1: Nối cài đặt vào `src/lib/search.ts`**

Không có unit test cho hàm này: nó chỉ ánh xạ tên trường quanh một lời gọi RPC, mock Supabase để test việc đổi tên trường thì chỉ kiểm chứng chính cái mock. Kiểm chứng ở Step 2 bằng dữ liệu thật.

```ts
import { createClient } from "@/lib/supabase/server";

export interface SearchItem {
  productId: string;
  slug: string;
  name: string;
  brand: string | null;
  image: string | null;
  categorySlug: string | null;
  bestPrice: number | null;
  originalPrice: number | null;
  score: number | null;
  recommendation: string | null;
  lastObservedAt: string | null;
}

export interface SearchResult {
  items: SearchItem[];
  total: number;
  page: number;
  pageSize: number;
}

/**
 * Dữ liệu catalog là public-read nên dùng anon client.
 * Lọc, sắp xếp và phân trang làm hết trong SQL — một round trip.
 */
export async function searchProducts(p: SearchParams): Promise<SearchResult> {
  const supabase = await createClient();

  const { data, error } = await supabase.rpc("search_products", {
    p_q: p.q ?? null,
    p_category_id: p.categoryId ?? null,
    p_brands: p.brands ?? null,
    p_min_price: p.minPrice ?? null,
    p_max_price: p.maxPrice ?? null,
    p_sort: p.sort,
    p_limit: PAGE_SIZE,
    p_offset: (p.page - 1) * PAGE_SIZE,
  });

  if (error) throw new Error(`Tìm kiếm thất bại: ${error.message}`);

  const rows = (data ?? []) as Array<Record<string, unknown>>;

  return {
    items: rows.map((r) => ({
      productId: r.product_id as string,
      slug: r.slug as string,
      name: r.canonical_name as string,
      brand: (r.brand as string) ?? null,
      image: (r.image as string) ?? null,
      categorySlug: (r.category_slug as string) ?? null,
      bestPrice: (r.best_price as number) ?? null,
      originalPrice: (r.original_price as number) ?? null,
      score: (r.score as number) ?? null,
      recommendation: (r.recommendation as string) ?? null,
      lastObservedAt: (r.last_observed_at as string) ?? null,
    })),
    total: rows.length > 0 ? Number(rows[0].total_count) : 0,
    page: p.page,
    pageSize: PAGE_SIZE,
  };
}
```

- [ ] **Step 2: Kiểm chứng bằng SQL trực tiếp**

Hoãn kiểm chứng đầy đủ tới Task 13 (sau khi có `seed-dev`). Bây giờ chỉ cần chắc RPC gọi được:

```sql
select product_id, canonical_name, best_price, total_count
from public.search_products(p_sort => 'updated', p_limit => 5);
```

Kỳ vọng: chạy được (0 dòng cũng đạt, vì DB còn rỗng).

- [ ] **Step 3: Kiểm tra biên dịch và lint**

Run: `pnpm lint && npx tsc --noEmit`
Expected: không lỗi.

- [ ] **Step 4: Commit**

```bash
git add src/lib/search.ts
git commit -m "$(cat <<'EOF'
feat(lib): gọi RPC search_products qua anon client

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 13: `scripts/seed-dev.ts`

Từ task này trở đi mới kiểm chứng được bằng dữ liệu thật. Đây là thứ gỡ phụ thuộc chặn vào Giai đoạn 0.

**Files:**
- Create: `scripts/seed-dev.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: `slugify` từ `@/lib/slug` · `createAdminClient` từ `@/lib/supabase/admin` · RPC `refresh_variant_daily_prices` từ Task 3
- Produces: DB có ~8 category, ~60 product (có cả `draft`), ~150 variant, ~400 offer, 120 ngày `price_observations`, rollup đã tính; lệnh `pnpm seed:dev`

- [ ] **Step 1: Cài công cụ chạy TypeScript**

```bash
pnpm add -D tsx dotenv
```

- [ ] **Step 2: Thêm script**

Trong `package.json`, thêm vào `"scripts"`:

```json
"seed:dev": "tsx --env-file=.env.local scripts/seed-dev.ts"
```

- [ ] **Step 3: Viết script**

`scripts/seed-dev.ts`:

```ts
/**
 * Sinh dữ liệu giả để dựng và kiểm chứng 1.1/1.2 trước khi có Shopee API
 * và collector thật (Giai đoạn 0).
 *
 * Chạy: pnpm seed:dev
 * CẢNH BÁO: xóa sạch catalog hiện có. Chỉ dùng trên DB phát triển.
 */

import { createClient } from "@supabase/supabase-js";
import { slugify } from "../src/lib/slug";
import type { Database } from "../src/lib/database.types";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  throw new Error("Thiếu NEXT_PUBLIC_SUPABASE_URL hoặc SUPABASE_SERVICE_ROLE_KEY");
}
const db = createClient<Database>(url, key, { auth: { persistSession: false } });

const DAYS = 120;
const CATEGORIES = [
  ["ssd", "Ổ cứng SSD"],
  ["ban-phim", "Bàn phím"],
  ["chuot", "Chuột"],
  ["man-hinh", "Màn hình"],
  ["tai-nghe", "Tai nghe"],
  ["ram", "RAM"],
  ["sac-du-phong", "Sạc dự phòng"],
  ["webcam", "Webcam"],
] as const;
const BRANDS = ["Samsung", "WD", "Logitech", "Keychron", "Dell", "Sony", "Anker", "Kingston"];

/** PRNG có hạt giống cố định → mỗi lần seed ra cùng dữ liệu, dễ so sánh. */
function makeRng(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}
const rnd = makeRng(20260922);
const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(rnd() * xs.length)];

async function main() {
  console.log("Xóa catalog cũ…");
  // products xóa cascade xuống variants → offers → price_observations.
  await db.from("products").delete().neq("id", "00000000-0000-0000-0000-000000000000");
  await db.from("categories").delete().neq("id", "00000000-0000-0000-0000-000000000000");

  console.log("Tạo categories…");
  const { data: cats, error: catErr } = await db
    .from("categories")
    .insert(CATEGORIES.map(([slug, name], i) => ({ slug, name, sort_order: i })))
    .select();
  if (catErr) throw catErr;

  console.log("Tạo sellers…");
  const { data: sellers, error: sellerErr } = await db
    .from("sellers")
    .upsert(
      Array.from({ length: 12 }, (_, i) => ({
        marketplace: "shopee",
        external_seller_id: `seed-shop-${i}`,
        name: `Shop Demo ${i + 1}`,
        rating: 4 + rnd(),
        rating_count: Math.floor(rnd() * 5000),
        is_official: i < 3,
      })),
      { onConflict: "marketplace,external_seller_id" },
    )
    .select();
  if (sellerErr) throw sellerErr;

  const today = new Date();
  let productCount = 0;

  for (let p = 0; p < 60; p++) {
    const brand = pick(BRANDS);
    const cat = pick(cats!);
    const model = `${pick(["Pro", "Plus", "Air", "Max", "Lite"])} ${100 + p}`;
    const name = `${cat.name} ${brand} ${model}`;
    // 10% sản phẩm để trạng thái draft, mô phỏng hàng do ingest sinh ra.
    const isDraft = p % 10 === 9;

    const { data: prod, error: prodErr } = await db
      .from("products")
      .insert({
        canonical_name: name,
        brand,
        model,
        category_id: cat.id,
        slug: `${slugify(`${brand} ${model}`)}-${p}`,
        status: isDraft ? "draft" : "verified",
      })
      .select()
      .single();
    if (prodErr) throw prodErr;
    productCount++;

    const variantCount = 2 + Math.floor(rnd() * 3);
    for (let v = 0; v < variantCount; v++) {
      const { data: variant, error: vErr } = await db
        .from("product_variants")
        .insert({
          product_id: prod.id,
          variant_key: `dung-luong=${[512, 1024, 2048][v % 3]}GB`,
        })
        .select()
        .single();
      if (vErr) throw vErr;

      const basePrice = 500_000 + Math.floor(rnd() * 4_500_000);
      const offerCount = 1 + Math.floor(rnd() * 4);
      const observations: Database["public"]["Tables"]["price_observations"]["Insert"][] = [];

      for (let o = 0; o < offerCount; o++) {
        const seller = pick(sellers!);
        const { data: listing, error: lErr } = await db
          .from("listings")
          .insert({
            marketplace: "shopee",
            external_item_id: `seed_${p}_${v}_${o}`,
            seller_id: seller.id,
            title: name,
            url: `https://shopee.vn/product/${1000 + p}/${2000 + v * 10 + o}`,
            status: "active",
          })
          .select()
          .single();
        if (lErr) throw lErr;

        const { data: offerRow, error: oErr } = await db
          .from("offers")
          .insert({
            listing_id: listing.id,
            variant_id: variant.id,
            match_confidence: isDraft ? 0.4 : 0.98,
            match_status: isDraft ? "pending" : "auto",
          })
          .select()
          .single();
        if (oErr) throw oErr;

        // Giá của offer này lệch 0–8% so với giá gốc của variant.
        const offerBase = Math.round(basePrice * (1 + rnd() * 0.08));

        for (let d = DAYS - 1; d >= 0; d--) {
          // Vài ngày hụt dữ liệu — để kiểm chứng ngắt đoạn chart và ngưỡng
          // 10 quan sát của deal-score.
          if (d % 17 === 3) continue;

          const at = new Date(today.getTime() - d * 86_400_000);
          at.setUTCHours(5, 0, 0, 0);

          const trend = 1 - (DAYS - d) * 0.0006;      // giảm nhẹ theo thời gian
          const noise = 1 + (rnd() - 0.5) * 0.04;
          const isFlash = d % 29 === 0;
          const price = Math.round(
            offerBase * trend * noise * (isFlash ? 0.82 : 1),
          );

          observations.push({
            offer_id: offerRow.id,
            observed_at: at.toISOString(),
            price,
            original_price: rnd() < 0.5 ? Math.round(price * 1.35) : null,
            stock: rnd() < 0.08 ? 0 : 10 + Math.floor(rnd() * 90),
            is_flash_sale: isFlash,
            is_valid: true,
            source: "api",
          });
        }
      }

      // Chèn theo lô để không vượt giới hạn payload.
      for (let i = 0; i < observations.length; i += 500) {
        const { error } = await db
          .from("price_observations")
          .insert(observations.slice(i, i + 500));
        if (error) throw error;
      }

      // variant_current_price: giá rẻ nhất trong các quan sát mới nhất.
      const latest = observations.filter(
        (x) => x.observed_at === observations.at(-1)?.observed_at,
      );
      const best = latest.reduce((a, b) => ((a.price ?? 0) <= (b.price ?? 0) ? a : b));
      const { error: vcpErr } = await db.from("variant_current_price").upsert({
        variant_id: variant.id,
        best_offer_id: best.offer_id,
        price: best.price,
        original_price: best.original_price ?? null,
        is_flash_sale: best.is_flash_sale ?? false,
        in_stock: (best.stock ?? 0) > 0,
        offer_count: offerCount,
        observed_at: best.observed_at!,
      });
      if (vcpErr) throw vcpErr;
    }
  }

  console.log("Tính rollup theo ngày…");
  const from = new Date(today.getTime() - DAYS * 86_400_000)
    .toISOString()
    .slice(0, 10);
  const to = today.toISOString().slice(0, 10);
  const { error: rollupErr } = await db.rpc("refresh_variant_daily_prices", {
    p_from: from,
    p_to: to,
  });
  if (rollupErr) throw rollupErr;

  console.log(`Xong: ${productCount} sản phẩm, ${DAYS} ngày dữ liệu.`);
  console.log("Chạy tiếp: pnpm scores:recompute");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
```

- [ ] **Step 4: Chạy seed**

Run: `pnpm seed:dev`
Expected: in ra "Xong: 60 sản phẩm, 120 ngày dữ liệu."

- [ ] **Step 5: Kiểm chứng trong SQL Editor**

```sql
select count(*) from public.products;                     -- ~60
select count(*) from public.price_observations;           -- vài trăm nghìn
select count(*) from public.variant_daily_prices;         -- > 0

-- Rollup phải loại flash sale khỏi min_price nhưng vẫn ghi nhận nó
select count(*) from public.variant_daily_prices where has_flash_sale;   -- > 0
select count(*) from public.variant_daily_prices where min_price is null; -- có thể 0

-- Tìm kiếm chịu lỗi gõ sai (trigram)
select canonical_name from public.search_products(p_q => 'samsng', p_limit => 5);
-- Kỳ vọng: vẫn ra sản phẩm Samsung

-- Tìm kiếm không dấu
select canonical_name from public.search_products(p_q => 'o cung', p_limit => 5);
-- Kỳ vọng: ra các sản phẩm "Ổ cứng"
```

- [ ] **Step 6: Commit**

```bash
git add scripts/seed-dev.ts package.json pnpm-lock.yaml
git commit -m "$(cat <<'EOF'
feat(scripts): sinh 120 ngày dữ liệu giả để dựng 1.1/1.2 trước Giai đoạn 0

Có ngày hụt dữ liệu và sản phẩm draft để kiểm chứng ngắt đoạn chart,
ngưỡng 10 quan sát và nhánh isOfferVisible.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 14: `scripts/recompute-deal-scores.ts`

**Files:**
- Create: `scripts/recompute-deal-scores.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: `computeDealScore` từ `@/lib/deal-score` · `expandRollup` từ `@/lib/price-history` · bảng `variant_daily_prices`, `variant_current_price`
- Produces: bảng `variant_deal_scores` được lấp đầy; lệnh `pnpm scores:recompute`

- [ ] **Step 1: Thêm script vào `package.json`**

```json
"scores:recompute": "tsx --env-file=.env.local scripts/recompute-deal-scores.ts"
```

- [ ] **Step 2: Viết script**

`scripts/recompute-deal-scores.ts`:

```ts
/**
 * Ghi cache Deal Score cho danh sách tìm kiếm (quyết định Đ5).
 *
 * Trang chi tiết vẫn tính live từ rollup và là nguồn sự thật; bảng này chỉ tồn
 * tại vì không thể sort theo điểm trước khi phân trang nếu điểm chỉ có trong Node.
 *
 * BẮT BUỘC dùng computeDealScore() từ @/lib/deal-score. Cấm cài đặt lại logic
 * tính điểm bằng SQL — hai bản cài đặt sẽ trôi khỏi nhau.
 *
 * Chạy sau mỗi collector run: pnpm scores:recompute
 */

import { createClient } from "@supabase/supabase-js";
import { computeDealScore } from "../src/lib/deal-score";
import { expandRollup, type DailyPriceRow } from "../src/lib/price-history";
import type { Database } from "../src/lib/database.types";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  throw new Error("Thiếu NEXT_PUBLIC_SUPABASE_URL hoặc SUPABASE_SERVICE_ROLE_KEY");
}
const db = createClient<Database>(url, key, { auth: { persistSession: false } });

async function main() {
  const { data: current, error: curErr } = await db
    .from("variant_current_price")
    .select("variant_id, price");
  if (curErr) throw curErr;

  const since = new Date(Date.now() - 90 * 86_400_000).toISOString().slice(0, 10);
  const rows: Database["public"]["Tables"]["variant_deal_scores"]["Insert"][] = [];

  for (const v of current ?? []) {
    if (v.price == null) continue;

    const { data: history, error: hErr } = await db
      .from("variant_daily_prices")
      .select("*")
      .eq("variant_id", v.variant_id)
      .gte("day", since)
      .order("day", { ascending: true });
    if (hErr) throw hErr;

    // KHÔNG truyền bestOffer — giống hệt điểm đầu trang (quyết định Đ7),
    // nếu khác thì danh sách và trang chi tiết sẽ hiện hai con số khác nhau.
    const result = computeDealScore({
      price: v.price,
      history: expandRollup((history ?? []) as DailyPriceRow[]),
    });

    rows.push({
      variant_id: v.variant_id,
      score: result.score,
      recommendation: result.recommendation,
      price_at_compute: v.price,
      computed_at: new Date().toISOString(),
    });
  }

  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await db
      .from("variant_deal_scores")
      .upsert(rows.slice(i, i + 500), { onConflict: "variant_id" });
    if (error) throw error;
  }

  console.log(`Đã tính điểm cho ${rows.length} variant.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
```

- [ ] **Step 3: Chạy job**

Run: `pnpm scores:recompute`
Expected: in ra "Đã tính điểm cho N variant." với N > 0.

- [ ] **Step 4: Kiểm chứng sort theo điểm hoạt động**

```sql
select recommendation, count(*)
from public.variant_deal_scores group by 1;
-- Kỳ vọng: có cả buy/wait/avoid, và insufficient_data nếu variant nào thiếu dữ liệu

select canonical_name, score, recommendation
from public.search_products(p_sort => 'deal_score', p_limit => 10);
-- Kỳ vọng: score giảm dần, dòng score null (nếu có) nằm CUỐI
```

- [ ] **Step 5: Commit**

```bash
git add scripts/recompute-deal-scores.ts package.json
git commit -m "$(cat <<'EOF'
feat(scripts): ghi cache Deal Score cho sort ở trang tìm kiếm

Gọi đúng computeDealScore() và cũng không truyền bestOffer, để danh sách và
trang chi tiết không hiện hai con số khác nhau.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 15: `src/lib/product-page-data.ts`

**Files:**
- Create: `src/lib/product-page-data.ts`

**Interfaces:**
- Consumes: `buildVariantPricing`, `OfferRow`, `VariantPricing` từ Task 7–8 · `DailyPriceRow` từ Task 6 · RPC `latest_price_per_offer`, `variant_tracking_since` từ Task 3 · `createClient` từ `@/lib/supabase/server`
- Produces:
  - `interface ProductPageData { product: {...}; variants: Array<{...}>; selectedVariantId: string; pricing: VariantPricing; history: DailyPriceRow[] }`
  - `loadProductPageData(params: { productSlug: string; variantId?: string }): Promise<ProductPageData | null>`

- [ ] **Step 1: Viết file**

```ts
/**
 * Tầng đọc dữ liệu cho trang sản phẩm (1.2).
 * Component KHÔNG tự truy vấn và KHÔNG tự tính — chỉ nhận kết quả của hàm này.
 */

import { createClient } from "@/lib/supabase/server";
import { buildVariantPricing, type OfferRow, type VariantPricing } from "@/lib/variant-pricing";
import type { DailyPriceRow } from "@/lib/price-history";

export interface ProductPageData {
  product: {
    id: string;
    slug: string;
    name: string;
    brand: string | null;
    model: string | null;
    image: string | null;
    isDraft: boolean;
    categorySlug: string | null;
    categoryName: string | null;
  };
  variants: Array<{
    id: string;
    variantKey: string;
    price: number | null;
    inStock: boolean;
  }>;
  selectedVariantId: string;
  pricing: VariantPricing;
  /** LUÔN 90 ngày. Chart tự cắt theo range; cửa sổ tính điểm không đổi. */
  history: DailyPriceRow[];
}

const HISTORY_DAYS = 90;

export async function loadProductPageData(params: {
  productSlug: string;
  variantId?: string;
}): Promise<ProductPageData | null> {
  const supabase = await createClient();

  const { data: product } = await supabase
    .from("products")
    .select(
      `id, slug, canonical_name, brand, model, image, status,
       categories ( slug, name ),
       product_variants ( id, variant_key, variant_current_price ( price, in_stock ) )`,
    )
    .eq("slug", params.productSlug)
    .maybeSingle();

  if (!product) return null;

  type VariantJoin = {
    id: string;
    variant_key: string;
    variant_current_price: { price: number | null; in_stock: boolean } | null;
  };
  const rawVariants = (product.product_variants ?? []) as unknown as VariantJoin[];

  const variants = rawVariants.map((v) => ({
    id: v.id,
    variantKey: v.variant_key,
    price: v.variant_current_price?.price ?? null,
    inStock: v.variant_current_price?.in_stock ?? false,
  }));

  if (variants.length === 0) return null;

  // Mặc định: variant còn hàng rẻ nhất. Không có variant nào còn hàng thì lấy
  // variant rẻ nhất bất kể tồn kho, để trang vẫn hiện được lịch sử giá.
  const selected =
    variants.find((v) => v.id === params.variantId) ??
    [...variants]
      .sort((a, b) => {
        if (a.inStock !== b.inStock) return a.inStock ? -1 : 1;
        if (a.price == null && b.price == null) return 0;
        if (a.price == null) return 1;
        if (b.price == null) return -1;
        return a.price - b.price;
      })
      .at(0)!;

  const since = new Date(Date.now() - HISTORY_DAYS * 86_400_000)
    .toISOString()
    .slice(0, 10);

  const [offersRes, historyRes, pricesRes, sinceRes] = await Promise.all([
    supabase
      .from("offers")
      .select(
        `id, match_status,
         listings ( url, status, sellers ( name, rating, rating_count, is_official ) ),
         affiliate_offers ( eligible )`,
      )
      .eq("variant_id", selected.id),
    supabase
      .from("variant_daily_prices")
      .select("*")
      .eq("variant_id", selected.id)
      .gte("day", since)
      .order("day", { ascending: true }),
    supabase.rpc("latest_price_per_offer", { p_variant_id: selected.id }),
    supabase.rpc("variant_tracking_since", { p_variant_id: selected.id }),
  ]);

  type PriceRpc = {
    offer_id: string;
    price: number | null;
    original_price: number | null;
    stock: number | null;
    is_flash_sale: boolean;
    observed_at: string;
  };
  const priceByOffer = new Map<string, PriceRpc>(
    ((pricesRes.data ?? []) as PriceRpc[]).map((r) => [r.offer_id, r]),
  );

  type OfferJoin = {
    id: string;
    match_status: OfferRow["matchStatus"];
    listings: {
      url: string | null;
      status: string;
      sellers: {
        name: string | null;
        rating: number | null;
        rating_count: number | null;
        is_official: boolean;
      } | null;
    } | null;
    affiliate_offers: { eligible: boolean } | null;
  };

  const offers: OfferRow[] = ((offersRes.data ?? []) as unknown as OfferJoin[])
    .map((o) => {
      const p = priceByOffer.get(o.id);
      return {
        offerId: o.id,
        listingUrl: o.listings?.url ?? null,
        listingStatus: o.listings?.status ?? "inactive",
        matchStatus: o.match_status,
        sellerName: o.listings?.sellers?.name ?? null,
        sellerRating: o.listings?.sellers?.rating ?? null,
        sellerRatingCount: o.listings?.sellers?.rating_count ?? null,
        sellerIsOfficial: o.listings?.sellers?.is_official ?? false,
        affiliateEligible: o.affiliate_offers?.eligible ?? false,
        price: p?.price ?? null,
        originalPrice: p?.original_price ?? null,
        stock: p?.stock ?? null,
        isFlashSale: p?.is_flash_sale ?? false,
        observedAt: p?.observed_at ?? new Date(0).toISOString(),
      };
    })
    // Offer chưa từng có quan sát nào thì không có giá để hiển thị.
    .filter((o) => o.price != null);

  const history = (historyRes.data ?? []) as DailyPriceRow[];
  const isDraft = product.status === "draft";

  const category = product.categories as unknown as
    | { slug: string; name: string }
    | null;

  return {
    product: {
      id: product.id,
      slug: product.slug as string,
      name: product.canonical_name,
      brand: product.brand,
      model: product.model,
      image: product.image,
      isDraft,
      categorySlug: category?.slug ?? null,
      categoryName: category?.name ?? null,
    },
    variants,
    selectedVariantId: selected.id,
    pricing: buildVariantPricing({
      offers,
      history,
      trackingSince: (sinceRes.data as string | null) ?? null,
      isDraftProduct: isDraft,
    }),
    history,
  };
}
```

- [ ] **Step 2: Viết script kiểm chứng tạm**

`scripts/check-product-page.ts`:

```ts
/** Kiểm chứng nhanh loadProductPageData trên dữ liệu seed. Xóa sau khi có trang thật. */
import { createClient } from "@supabase/supabase-js";
import type { Database } from "../src/lib/database.types";

const db = createClient<Database>(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
);

const { data } = await db.from("products").select("slug").limit(3);
console.log("Slug để thử trên trang:", data?.map((p) => p.slug));
```

Run: `pnpm tsx --env-file=.env.local scripts/check-product-page.ts`
Expected: in ra 3 slug.

- [ ] **Step 3: Kiểm tra biên dịch**

Run: `pnpm lint && npx tsc --noEmit && pnpm test`
Expected: không lỗi, mọi test xanh.

- [ ] **Step 4: Commit**

```bash
git add src/lib/product-page-data.ts scripts/check-product-page.ts
git commit -m "$(cat <<'EOF'
feat(lib): tầng đọc dữ liệu trang sản phẩm, 4 truy vấn song song

Luôn lấy 90 ngày rollup: range chỉ cắt biểu đồ, không đổi cửa sổ tính điểm.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 16: `GET /api/autocomplete`

**Files:**
- Create: `src/app/api/autocomplete/route.ts`

**Interfaces:**
- Consumes: `searchProducts`, `parseSearchParams` từ Task 11–12
- Produces: `GET /api/autocomplete?q=` → `Array<{ productId, slug, categorySlug, name, brand, image, bestPrice }>`

- [ ] **Step 1: Viết route handler**

```ts
import { NextResponse } from "next/server";
import { parseSearchParams, searchProducts } from "@/lib/search";

/** Gợi ý cho ô tìm kiếm. Bỏ qua mọi filter, tối đa 8 dòng. */
export async function GET(request: Request) {
  const q = new URL(request.url).searchParams.get("q")?.trim() ?? "";

  // Dưới 2 ký tự thì gợi ý vô nghĩa và tốn truy vấn.
  if (q.length < 2) {
    return NextResponse.json([], {
      headers: { "Cache-Control": "public, max-age=60" },
    });
  }

  const params = parseSearchParams(new URLSearchParams({ q }));
  const result = await searchProducts(params);

  return NextResponse.json(
    result.items.slice(0, 8).map((i) => ({
      productId: i.productId,
      slug: i.slug,
      categorySlug: i.categorySlug,
      name: i.name,
      brand: i.brand,
      image: i.image,
      bestPrice: i.bestPrice,
    })),
    { headers: { "Cache-Control": "public, max-age=60" } },
  );
}
```

- [ ] **Step 2: Kiểm chứng bằng tay**

Run: `pnpm dev` ở một terminal, rồi:

```bash
curl -s 'http://localhost:3000/api/autocomplete?q=a' 
```
Expected: `[]`

```bash
curl -s 'http://localhost:3000/api/autocomplete?q=samsung'
```
Expected: mảng JSON có `slug` và `bestPrice`, tối đa 8 phần tử.

```bash
curl -s 'http://localhost:3000/api/autocomplete?q=samsng'
```
Expected: vẫn ra Samsung — đây là fallback trigram hoạt động.

```bash
curl -s 'http://localhost:3000/api/autocomplete?q=%26%20!%20('
```
Expected: JSON hợp lệ, KHÔNG phải lỗi 500 — sanitize tsquery hoạt động.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/autocomplete/route.ts
git commit -m "$(cat <<'EOF'
feat(api): gợi ý tìm kiếm, tối thiểu 2 ký tự và tối đa 8 dòng

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 17: `GET /go/{marketplace}/{offerId}`

**Files:**
- Create: `src/app/go/[marketplace]/[offerId]/route.ts`

**Interfaces:**
- Consumes: `createAdminClient` từ `@/lib/supabase/admin` · `createClient` từ `@/lib/supabase/server` (đọc phiên đăng nhập)
- Produces: route redirect 302, ghi `click_events`

- [ ] **Step 1: Viết route handler**

```ts
import { NextResponse } from "next/server";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

const SOURCES = new Set(["web", "extension", "email", "push"]);

/**
 * Redirect affiliate + ghi nhận click để đối soát hoa hồng.
 *
 * Ghi click_events cần service role (bảng có RLS, người dùng chỉ đọc click của
 * chính mình). Đọc phiên đăng nhập thì dùng server client.
 */
export async function GET(
  request: Request,
  ctx: { params: Promise<{ marketplace: string; offerId: string }> },
) {
  const { offerId } = await ctx.params;
  const url = new URL(request.url);

  const rawSource = url.searchParams.get("src") ?? "web";
  const source = SOURCES.has(rawSource) ? rawSource : "web";
  const watchId = url.searchParams.get("watch");

  const admin = createAdminClient();

  const { data: offer } = await admin
    .from("offers")
    .select(`id, listings ( url ), affiliate_offers ( short_link, affiliate_url )`)
    .eq("id", offerId)
    .maybeSingle();

  if (!offer) {
    return NextResponse.json({ error: "Không tìm thấy offer" }, { status: 404 });
  }

  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: click } = await admin
    .from("click_events")
    .insert({
      user_id: user?.id ?? null,
      offer_id: offerId,
      source: source as "web" | "extension" | "email" | "push",
      watch_id: watchId,
      session_id: null,
    })
    .select("id")
    .single();

  const affiliate = offer.affiliate_offers as unknown as
    | { short_link: string | null; affiliate_url: string | null }
    | null;
  const listing = offer.listings as unknown as { url: string | null } | null;

  const target =
    affiliate?.short_link ?? affiliate?.affiliate_url ?? listing?.url;

  if (!target) {
    return NextResponse.json(
      { error: "Offer chưa có đường dẫn mua hàng" },
      { status: 404 },
    );
  }

  // sub_id = click_events.id, dùng để đối soát với conversions.click_ref.
  const destination = new URL(target);
  if (click?.id && (affiliate?.short_link || affiliate?.affiliate_url)) {
    destination.searchParams.set("sub_id", click.id);
  }

  return NextResponse.redirect(destination.toString(), {
    status: 302,
    headers: { "Cache-Control": "no-store" },
  });
}
```

- [ ] **Step 2: Kiểm chứng bằng tay**

Lấy một `offer_id` từ DB:

```sql
select id from public.offers limit 1;
```

Rồi:

```bash
curl -s -o /dev/null -w '%{http_code} %{redirect_url}\n' 'http://localhost:3000/go/shopee/<offer_id>'
```
Expected: `302 https://shopee.vn/product/...`

```bash
curl -s -o /dev/null -w '%{http_code}\n' 'http://localhost:3000/go/shopee/00000000-0000-0000-0000-000000000000'
```
Expected: `404`

Kiểm chứng click được ghi:

```sql
select count(*) from public.click_events;   -- tăng sau mỗi lần curl thành công
```

- [ ] **Step 3: Chạy toàn bộ kiểm tra**

Run: `pnpm test && pnpm lint && npx tsc --noEmit`
Expected: tất cả xanh.

- [ ] **Step 4: Commit**

```bash
git add src/app/go/[marketplace]/[offerId]/route.ts
git commit -m "$(cat <<'EOF'
feat(api): redirect affiliate và ghi click_events với sub_id

sub_id = click_events.id để đối soát với conversions.click_ref.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Hoàn thành Plan 1

Sau Task 17, các thứ sau chạy được và kiểm chứng được:

- Schema đầy đủ cho 1.1 và 1.2, có rollup và cache điểm.
- Engine giá: ngưỡng dữ liệu đúng nghĩa, điểm không bị cộng khống, Fake Sale không báo nhầm.
- Tìm kiếm chịu lỗi gõ sai và không dấu, filter/sort/phân trang trong SQL.
- Tầng đọc dữ liệu trang sản phẩm.
- Redirect affiliate có ghi click.
- 120 ngày dữ liệu giả để dựng UI mà không cần chờ Giai đoạn 0.

**Chưa có:** giao diện (spec UI, plan riêng) và ingest từ Shopee (Plan 2).

### Việc cần làm trước Plan 2

Spike API ở Giai đoạn 0 phải trả lời **có `original_price` trong phản hồi Shopee Open API hay không**. Không có thì phải xem lại 1.2.a (% giảm) và heuristic Fake Sale #1 — hai thứ này mất căn cứ dữ liệu, không phải mất cách cài đặt.

---

## Tự rà lại plan

**Phủ spec:** §1 → Task 2–3 · §2 → Task 4 · §3 → Task 5 · §4 → Task 6 · §5 → Task 7–8 · §6 → Task 9 · §7 → Task 10 · §10–§11 → Plan 2 · §12 `/api/autocomplete` → Task 16, `/go` → Task 17, `/api/lookup` → Plan 2 · §13 → Task 15 · §14 → Task 11–12 · §15 → Task 13–14 · §16 kiểm thử → rải trong từng task · §17 thứ tự → khớp.

**Khớp kiểu dữ liệu:** `DailyPriceRow` định nghĩa ở Task 6, dùng lại nguyên vẹn ở Task 8, 9, 14, 15. `OfferRow`/`PricedOffer` định nghĩa ở Task 7, mở rộng ở Task 8, dựng ở Task 15. `SearchParams` định nghĩa ở Task 11, tiêu thụ ở Task 12 và 16. `expandRollup` dùng ở Task 8, 14. Không có tên hàm nào lệch giữa các task.

**Khoảng trống đã biết, có chủ ý:** `variant_current_price` trong Plan 1 chỉ được ghi bởi `seed-dev`. Collector thật (Giai đoạn 0) và `ingest` (Plan 2) cũng phải ghi bảng này — đã ghi rõ ở §2.5 của spec logic và bước 9 của luồng ingest.

**Ba lỗi đã tìm thấy và sửa khi tự rà:**

1. Thiếu bước sinh lại `src/lib/database.types.ts` sau migration. File này viết tay và chưa biết 5 bảng mới, nên Task 13–15 sẽ không biên dịch được. Đã thêm thành Task 3 Step 5.
2. Task 8 hướng dẫn "nối import vào cuối file test", nhưng import trùng tên binding hai lần là SyntaxError. Đã đổi thành sửa khối import sẵn có.
3. Task 8 dùng bí danh `expandRollupForTest` không cần thiết. Đã đổi về `expandRollup`.

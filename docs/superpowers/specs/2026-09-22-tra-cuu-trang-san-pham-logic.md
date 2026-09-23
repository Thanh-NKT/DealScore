# Spec sinh code — 1.1 Tra cứu & 1.2 Trang sản phẩm (CHỈ LOGIC)

> Bản rút gọn để sinh code của [2026-09-22-tra-cuu-trang-san-pham-design.md](2026-09-22-tra-cuu-trang-san-pham-design.md).
> **Không sinh UI.** Không component React, không layout, không CSS. Chỉ: migration SQL,
> hàm thuần trong `src/lib/`, route handler, script. UI thuộc pha sau.
> Bản này tự chứa — sinh code được mà không cần đọc design doc.

---

## Cập nhật sau review code (2026-09-23)

Code đã lệch khỏi các mục dưới đây có chủ đích. Khi mâu thuẫn, **mục này thắng**.

| Mục | Thay đổi | Lý do |
|---|---|---|
| §1 | Migration `0004` thu hồi INSERT/UPDATE/DELETE của `anon`/`authenticated` trên mọi bảng catalog, đổi default privileges, `revoke execute` các hàm `security definer`. `affiliate_offers` chỉ đọc được cột `offer_id, eligible`. | Supabase mặc định cấp ALL cho `anon`: bảng không RLS thì anon key ghi được, kể cả đích redirect của `/go`. |
| §1 | `search_products`: lọc sơ bộ bằng `@@` / `%>` (dùng index) trước các lateral; giá và điểm lấy từ **cùng** variant đại diện (còn hàng, rẻ nhất); brand không phân biệt hoa thường; token có `-`/`.` được tách. Thêm RPC `product_brands()`. | Hiệu năng; card từng hiện điểm của variant này cạnh giá của variant khác. |
| §9 | `getItemDetail` ném `ShopeeUnavailableError` khi chưa có API. Dữ liệu giả chỉ khi `SHOPEE_CLIENT=fake` và không phải production, ghi `source = 'seed'` (check constraint mở rộng). | Stub từng ghi giá bịa vào catalog như giá thật. |
| §10 | Hạn mức kiểm-và-ghi **nguyên tử** trong DB: `lookup_begin()` (chống quét 120/giờ/IP, tạo dòng `pending`) → `lookup_begin_ingest()` (10/60/cap, chỉ khi URL chưa có) → `finishLookup()`. Lỗi DB thì chặn, không cho qua. `lookup_requests` thêm `is_ingest`, outcome `pending`. | Kiểm-rồi-ghi ở tầng ứng dụng không chặn được request đồng thời; lỗi DB từng tắt rate limit âm thầm. |
| §11 | Ingest là RPC `ingest_shopee_item(jsonb)` — một transaction, advisory lock theo item, `on conflict` cho seller/listing/offer, unique `(listing_id, external_model_id)`. **Chưa làm matcher v0 (bước 7)**: mọi offer đi thẳng vào product draft. | Spec yêu cầu một transaction; bản JS cũ có race tạo product trùng. |
| §12 | Luồng tra cứu gom vào `src/lib/lookup.ts` `lookupShopeeUrl()`, dùng chung cho `/api/lookup` **và** `/share-target`. Thứ tự: chuẩn hóa → parse → hạn mức chống quét → theo redirect → tra catalog → hạn mức ingest → ingest. | `/share-target` từng ingest không rate limit; tra catalog phải chạy trước để biết lượt này có phải ingest. |
| §8 | Allowlist host dùng chung `SHOPEE_HOSTS`/`SHORT_HOSTS` từ `parse-url.ts`, so khớp chính xác, chặn cổng khác mặc định, dừng ngay khi đã đọc được URL sản phẩm. | Đúng spec gốc; bản cũ dùng `endsWith`. |
| §5 | `VariantPricing` thêm `lastKnown`, `allOutOfStock`, `stats` (đáy/trung vị/đỉnh luôn có). Heuristic #2 chỉ chạy khi đang có đợt giảm. Giá flash hiện tại thêm lý do cảnh báo. `OfferRow.observedAt` có thể `null`. | Hết hàng từng hiện "Chưa có dữ liệu giá"; StatsRow trống khi chưa đủ ngưỡng; nhãn fake sale gắn cho sản phẩm chỉ vừa tăng giá. |
| §12 `/go` | Validate UUID, đối chiếu `marketplace`, 404 cho offer `rejected`/listing inactive, allowlist host đích, kiểm tra lỗi ghi click, ghi `user_id` + `session_id` (cookie phiên `kairo_sid`). | Open redirect; click mất lặng lẽ. |
| §13 | Mọi lỗi query đều ném, không biến thành 404 hay "chưa có dữ liệu". | Nuốt lỗi hạ tầng là hiện dữ liệu sai như dữ liệu thật. |

---

## 0. Ràng buộc bắt buộc

| | |
|---|---|
| Stack | Next.js 16 App Router · React 19 · TypeScript · Supabase · Tailwind 4 · pnpm |
| Path alias | `@/*` → `./src/*` |
| Middleware | Root file là `src/proxy.ts`, export `proxy()` — **không phải** `middleware()` |
| Ngôn ngữ | Comment và chuỗi hiển thị viết **tiếng Việt** |
| Tiền tệ | VND, số nguyên, không phần thập phân |
| Múi giờ | `Asia/Ho_Chi_Minh` cho mọi phép quy đổi timestamp → ngày |

### Ba Supabase client — chọn sai là lỗi bảo mật

| File | Khóa | Dùng ở đâu |
|---|---|---|
| `@/lib/supabase/client` | anon + RLS | Client Component |
| `@/lib/supabase/server` | anon + RLS, đọc cookie | Server Component, Route Handler đọc |
| `@/lib/supabase/admin` | **service role, bỏ qua RLS** | Chỉ: `api/lookup/route.ts`, `go/…/route.ts`, `@/lib/ingest`, `scripts/` |

`admin` **không bao giờ** được import vào Client Component.

### `deal-score.ts` — chỉ sửa có chủ đích

`src/lib/deal-score.ts` phải giữ **thuần hàm** để backtest được; mọi thứ khác bọc quanh nó.
Sau review 2026-09-23 đã sửa hai điểm (được duyệt), mọi thay đổi công thức khác phải qua backtest:

- Nhận `now?: Date`. Cửa sổ 90 ngày và `daysCovered` đếm theo **ngày lịch VN**, không theo
  hiệu mili-giây — trước đó cùng một lịch sử cho ⚪ buổi sáng và có điểm buổi chiều.
- Percentile rank kiểu **mid-rank** `(#< p + ½·#= p) / n`. Kiểu `≤ p` chấm giá đứng yên
  như giá cao nhất lịch sử (🔴) trong khi lý do ghi "Đang ở mức đáy ghi nhận".

---

## 1. Migration `supabase/migrations/0002_search_rollup_categories.sql`

```sql
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
```

**Kiểm chứng migration:** chạy `refresh_variant_daily_prices` với session `SET TimeZone='UTC'` phải ra **cùng kết quả** như với `TimeZone='Asia/Ho_Chi_Minh'`. Nếu khác là biên ngày sai.

---

## 2. `src/lib/format.ts`

```ts
/** "1.234.000 ₫". Làm tròn về số nguyên. */
export function formatVnd(value: number | null | undefined): string;

/**
 * % giảm so với giá niêm yết, LÀM TRÒN XUỐNG.
 * Trả null khi: thiếu giá, listed <= current, hoặc kết quả = 0.
 * Không bao giờ trả 0 — hiển thị "−0%" là vô nghĩa.
 */
export function discountPercent(current: number | null, listed: number | null): number | null;

/** 'YYYY-MM-DD' theo giờ Việt Nam, từ Date hoặc ISO string. */
export function toVnDate(d: Date | string): string;

/** Số ngày giữa hai mốc, dương. */
export function daysBetween(a: Date | string, b: Date | string): number;
```

**Test:** `discountPercent(80, 100) === 20` · `discountPercent(100, 100) === null` (không giảm) · `discountPercent(120, 100) === null` (đắt hơn niêm yết) · `discountPercent(99, 100) === 1` · `discountPercent(999, 1000) === null` (làm tròn xuống ra 0) · `discountPercent(null, 100) === null`.

---

## 3. `src/lib/slug.ts`

```ts
/** Bỏ dấu tiếng Việt, lowercase, thay khoảng trắng/ký tự lạ bằng '-', gộp '-' liền nhau. */
export function slugify(input: string, maxLength?: number): string;

/**
 * Sinh slug chưa trùng. `exists` trả true nếu slug đã tồn tại trong DB.
 * Trùng thì thêm hậu tố -2, -3, … cho tới khi trống.
 */
export async function uniqueSlug(
  base: string,
  exists: (slug: string) => Promise<boolean>,
): Promise<string>;
```

**Test:** `slugify('Ổ cứng SSD Samsung 990 PRO 2TB')` → `'o-cung-ssd-samsung-990-pro-2tb'` · `slugify('A  --  B')` → `'a-b'` · `slugify('Đĩa')` → `'dia'` (chữ Đ/đ phải ra `d`) · `uniqueSlug` khi `a`, `a-2` đã tồn tại → `'a-3'`.

---

## 4. `src/lib/price-history.ts` — **hạt nhân, sinh trước tiên**

```ts
import type { PriceObservation } from "@/lib/deal-score";

export interface DailyPriceRow {
  day: string;                    // 'YYYY-MM-DD'
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
 * Mỗi ngày đóng góp ĐÚNG MỘT quan sát: min_price (đã loại flash sale).
 * Ngày có min_price = null (chỉ có flash sale, hoặc không thu được) bị BỎ QUA.
 * observed_at đặt tại 12:00 giờ Việt Nam của ngày đó, để daysBetween không
 * lệch một ngày do biên nửa đêm.
 */
export function expandRollup(rows: DailyPriceRow[]): PriceObservation[];

/**
 * Trung vị min_price trong cửa sổ [now - fromDaysAgo, now - toDaysAgo).
 * fromDaysAgo > toDaysAgo. Ví dụ (74, 14) = "60 ngày trước đợt 14 ngày gần nhất".
 * dayCount = số ngày THỰC SỰ có min_price trong cửa sổ.
 */
export function medianWindow(
  rows: DailyPriceRow[],
  fromDaysAgo: number,
  toDaysAgo: number,
  now?: Date,
): { value: number | null; dayCount: number };
```

Cửa sổ so theo **ngày lịch** (`row.day >= fromDay && row.day < toDay`), không theo hiệu mili-giây. So bằng mili-giây với mốc 05:00Z của từng dòng sẽ khiến dòng hôm nay lọt vào cửa sổ khi chạy buổi chiều nhưng bị loại khi chạy buổi sáng — cùng một trang cho hai con số khác nhau tùy giờ người dùng mở.

### Hệ quả có chủ đích với hai ngưỡng của `deal-score.ts`

| Hằng số | Nghĩa sau khi dùng rollup |
|---|---|
| `MIN_DAYS_FOR_SCORE = 14` | Khoảng cách từ quan sát đầu tới nay ≥ 14 ngày |
| `MIN_OBSERVATIONS_FOR_SCORE = 10` | Số **ngày có dữ liệu** ≥ 10 → collector không hụt quá 4/14 ngày |

Hai ngưỡng vẫn phân biệt. Không gộp.

**Test bắt buộc:**
- Ngày `min_price = null` bị loại khỏi kết quả.
- `observed_at` rơi đúng 12:00 giờ VN (`05:00Z`).
- 13 ngày dữ liệu đầy đủ → `computeDealScore` trả `insufficient_data`.
- Trải 14 ngày nhưng chỉ 9 ngày có dữ liệu → `insufficient_data`.
- Trải 14 ngày, 10 ngày có dữ liệu → có điểm.
- `medianWindow` với cửa sổ rỗng → `{ value: null, dayCount: 0 }`.

---

## 5. `src/lib/variant-pricing.ts` — lắp ráp toàn bộ 1.2

```ts
import type { DealScoreResult } from "@/lib/deal-score";
import type { DailyPriceRow } from "@/lib/price-history";

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
  /** Điểm riêng của offer này so với offer rẻ nhất. null nếu thiếu dữ liệu. */
  dealScore: DealScoreResult | null;
}

export interface VariantPricing {
  offers: PricedOffer[];          // còn hàng theo giá tăng dần, rồi hết hàng
  cheapest: PricedOffer | null;   // offer còn hàng rẻ nhất
  /** Điểm hiển thị đầu trang. Xem §5.1 — gọi KHÔNG truyền bestOffer. */
  headline: DealScoreResult | null;
  fakeSaleMessage: string | null;
  trackingSince: string | null;   // 'YYYY-MM-DD'
  updatedAt: string | null;
  isStale: boolean;               // updatedAt cũ hơn 48 giờ
}

export function buildVariantPricing(input: {
  offers: OfferRow[];
  history: DailyPriceRow[];
  trackingSince: string | null;
  isDraftProduct: boolean;
  now?: Date;
}): VariantPricing;
```

### §5.1 — Quy tắc gọi `computeDealScore`, tuyệt đối không làm khác

```ts
// Điểm đầu trang: chấm cho offer rẻ nhất, KHÔNG truyền bestOffer.
// Truyền bestOffer = chính nó thì thành phần 3 luôn = 100 → cộng khống +20 điểm,
// làm ngưỡng Buy >= 75 mất ý nghĩa và trượt cổng backtest >= 80% sang G2.
// computeDealScore đã có sẵn nhánh reweight 62.5/37.5 cho đúng tình huống này.
const headline = computeDealScore({ price: cheapest.price, history });

// Điểm riêng từng offer KHÁC offer rẻ nhất: đây là chỗ duy nhất truyền bestOffer.
const perOffer = computeDealScore({ price: offer.price, history, bestOffer: cheapest.price });

// CHÍNH offer rẻ nhất KHÔNG được tính lại theo cách trên: bestOffer sẽ là chính nó,
// cBetween luôn = 100, và dòng đó hiện cao hơn điểm đầu trang 15–20 điểm.
// Nó dùng lại đúng headline.
cheapestOffer.dealScore = headline;
```

**Test:**
1. Trên cùng dữ liệu, `computeDealScore({price: p, history})` cho điểm **thấp hơn** `computeDealScore({price: p, history, bestOffer: p})`. Giá dùng để test phải nằm **giữa** dải lịch sử — giá dưới đáy làm cả hai cách chạm trần 100 và test không phân biệt được gì.
2. `pricing.cheapest.dealScore.score === pricing.headline.score`.

> **Sửa ngày 2026-09-22.** Bản đầu của mục này bảo truyền `bestOffer` cho *mọi* offer, kể cả offer rẻ nhất. Test `tests/lib/variant-pricing.test.ts` cho thấy khi đó đầu trang hiện 25 còn dòng rẻ nhất ngay dưới hiện 40.

### §5.2 — Offer nào được hiện

```ts
function isOfferVisible(offer: OfferRow, isDraftProduct: boolean): boolean {
  if (offer.listingStatus !== "active") return false;
  if (offer.matchStatus === "auto" || offer.matchStatus === "manual") return true;
  // Product draft do ingest sinh ra có offer 'pending' trỏ vào chính variant draft đó.
  if (offer.matchStatus === "pending" && isDraftProduct) return true;
  return false;
}
```

Offer `pending` trên product đã verify **không** được hiện — matching chưa chắc thì không được khẳng định "cùng một sản phẩm".

### §5.3 — Sắp xếp

Còn hàng (`stock === null || stock > 0`) theo `price` tăng dần, rồi hết hàng theo `price` tăng dần. `price === null` xuống cuối cùng.

### §5.4 — Fake Sale, **kiểm tra đủ dữ liệu trước khi gọi**

```ts
const m30 = medianWindow(history, 30, 0);
const m14 = medianWindow(history, 14, 0);
const m60 = medianWindow(history, 74, 14);

const fakeSaleMessage = detectFakeSale({
  currentPrice: cheapest.price,
  listedPrice: cheapest.originalPrice ?? 0,
  median30d: m30.value ?? 0,
  // Chỉ truyền khi đủ dữ liệu; thiếu thì undefined để heuristic tự bỏ qua.
  median14dBeforeSale: m14.dayCount >= 10 && m60.dayCount >= 30 ? m14.value ?? undefined : undefined,
  median60dBefore:     m14.dayCount >= 10 && m60.dayCount >= 30 ? m60.value ?? undefined : undefined,
});
```

Heuristic #1 (giảm niêm yết) chỉ chạy khi `m30.dayCount >= 14`; không đủ thì bỏ qua hẳn, đừng gọi.

Nhãn này là **một phát ngôn về người bán** — báo nhầm vừa mất niềm tin vừa là rủi ro pháp lý. Thà bỏ sót.

---

## 6. `src/lib/chart-series.ts` — chuẩn bị dữ liệu, KHÔNG vẽ

```ts
export interface ChartPoint { day: string; price: number; }
export interface FlashMarker { day: string; price: number; }

export interface ChartSeries {
  /** Các đoạn liên tục. Ngày thiếu dữ liệu NGẮT đoạn — không nội suy. */
  segments: ChartPoint[][];
  flashMarkers: FlashMarker[];
  min: number | null;
  max: number | null;
  /** false khi có dưới 2 điểm — chưa đủ để vẽ. */
  renderable: boolean;
}

export function buildChartSeries(
  rows: DailyPriceRow[],
  rangeDays: 7 | 30 | 90,
  now?: Date,
): ChartSeries;
```

`rangeDays` **chỉ cắt chart**, không đụng tới cửa sổ tính Deal Score (luôn 90 ngày). Nếu để range chi phối cửa sổ tính điểm thì bấm tab "7 ngày" sẽ làm đổi điểm.

**Test:** ngày trống ở giữa → 2 segment · toàn bộ trống → `renderable: false` · 1 điểm → `renderable: false` · `flash_min_price` null nhưng `has_flash_sale` true → không sinh marker.

---

## 7. `src/lib/shopee/parse-url.ts`

```ts
export type ParsedShopeeUrl =
  | { ok: true; shopId: string; itemId: string }
  | { ok: false; reason: "not_a_url" | "not_shopee" | "unrecognized_format" | "needs_redirect" };

export function parseShopeeUrl(raw: string): ParsedShopeeUrl;

/** Quy ước khóa ngoại dùng chung với collector. */
export function externalItemId(shopId: string, itemId: string): string; // `${shopId}_${itemId}`

/** Rút URL đầu tiên ra khỏi một đoạn text (cho PWA share target). */
export function extractFirstUrl(text: string): string | null;
```

Phải nhận được:

| Dạng | Ví dụ | Kết quả |
|---|---|---|
| Canonical | `https://shopee.vn/product/123456/789012` | ok |
| Slug | `https://shopee.vn/O-cung-SSD-i.123456.789012` | ok |
| Query rác | `…/product/123456/789012?sp_atk=x&xptdk=y` | ok |
| Rút gọn | `https://shope.ee/abc`, `https://s.shopee.vn/abc` | `needs_redirect` |
| Sàn khác | `https://lazada.vn/…` | `not_shopee` |
| Không URL | `ssd samsung` | `not_a_url` |

---

## 8. `src/lib/shopee/resolve-redirect.ts` — bề mặt SSRF, làm chặt

```ts
export const SHOPEE_HOST_ALLOWLIST = ["shopee.vn", "shope.ee", "s.shopee.vn"] as const;

export async function resolveShopeeRedirect(url: string): Promise<
  | { ok: true; finalUrl: string }
  | { ok: false; reason: "host_not_allowed" | "too_many_hops" | "timeout" | "insecure" | "error" }
>;
```

Người dùng cung cấp URL và server đi gọi nó — đây là SSRF surface. Bắt buộc:

- Dùng chung `SHOPEE_HOSTS` / `SHORT_HOSTS` với `parse-url.ts`: so khớp host **chính xác** theo tập, không dùng `includes("shopee.")` hay `endsWith("shopee.vn")` — cả hai đều cho lọt `shopee.vn.evil.com` và `evil-shopee.com.attacker.net`.
- Kiểm tra allowlist **sau mỗi hop**, không chỉ hop đầu.
- Tối đa **3 hop**, timeout **3 giây** mỗi hop (`AbortSignal.timeout`).
- Chỉ chấp nhận `https:`. `http:` → `insecure`.
- So khớp host **chính xác** — `shopee.vn.evil.com` phải bị chặn.
- **Không bao giờ** trả body của response về client.
- Chỉ chạy phía server.

---

## 9. `src/lib/shopee/client.ts`

```ts
export interface ShopeeItemDetail {
  shopId: string;
  itemId: string;
  title: string;
  sellerName: string | null;
  sellerRating: number | null;
  sellerRatingCount: number | null;
  sellerIsOfficial: boolean;
  models: Array<{
    modelId: string;
    name: string;              // vd "2TB, Đen"
    price: number | null;
    originalPrice: number | null;
    stock: number | null;
    isFlashSale: boolean;
  }>;
}

export async function getItemDetail(shopId: string, itemId: string): Promise<ShopeeItemDetail>;
```

**Chưa chốt được hình dạng thật của Shopee Open API** (thuộc spike Giai đoạn 0). Sinh code theo interface này và đặt phần gọi HTTP sau một adapter đổi được. **Rủi ro cần xác nhận: API có trả `originalPrice` không** — không có thì `%` giảm ở 1.2.a và heuristic Fake Sale #1 đều mất căn cứ.

---

## 10. `src/lib/rate-limit.ts`

```ts
export type LookupOutcome = "resolved" | "ingested" | "rejected" | "error";

export interface RateLimitVerdict {
  allowed: boolean;
  reason?: "ip_hourly" | "user_hourly" | "global_daily";
  retryAfterSeconds?: number;
}

export function hashIp(ip: string): string;   // sha256(ip || process.env.LOOKUP_IP_SALT)

export async function checkLookupLimit(params: {
  ipHash: string;
  userId: string | null;
  isIngest: boolean;
}): Promise<RateLimitVerdict>;

export async function recordLookup(params: {
  ipHash: string;
  userId: string | null;
  outcome: LookupOutcome;
}): Promise<void>;
```

| Hạn mức | Giá trị |
|---|---|
| Ingest mới — khách, theo `ip_hash` | 10 / giờ |
| Ingest mới — user đăng nhập | 60 / giờ |
| Ingest mới — toàn hệ thống | `LOOKUP_DAILY_INGEST_CAP`, mặc định 2000 / ngày |
| Tra cứu URL đã có trong catalog | 120 / giờ / IP |

Đếm bằng query trên `lookup_requests`. **Không dùng bộ đếm in-memory** — serverless chạy nhiều instance nên bộ đếm in-memory vừa sai vừa không chặn được gì.

Chạm trần toàn hệ thống → trả `upstream_unavailable`, **không** phải `rate_limited`: người dùng không làm gì sai.

---

## 11. `src/lib/ingest.ts`

```ts
export type IngestResult =
  | { status: "resolved"; productUrl: string }
  | { status: "ingested"; productUrl: string }
  | { status: "error"; code: "upstream_unavailable" | "internal" };

export async function resolveOrIngestShopee(params: {
  shopId: string;
  itemId: string;
}): Promise<IngestResult>;
```

Luồng, **toàn bộ trong một transaction**:

```
1. SELECT listings WHERE marketplace='shopee' AND external_item_id = externalItemId(...)
   ├─ Có, và tồn tại offer với variant_id IS NOT NULL
   │    → productUrl = /{category.slug}/{product.slug}?variant={variant_id}
   │    → status 'resolved', DỪNG
   └─ Không → tiếp
2. getItemDetail(shopId, itemId)
3. UPSERT sellers   theo (marketplace, external_seller_id)
4. UPSERT listings  theo (marketplace, external_item_id), refresh_priority = 1
5. INSERT offers    — một dòng cho mỗi model
6. INSERT price_observations — quan sát đầu tiên, source = 'api'
7. Matcher v0 cho từng offer:
     confidence >= 0.95 → offers.variant_id = gợi ý, match_status = 'auto'
     ngược lại          → INSERT match_candidates (decision='pending'),
                          offers.match_status = 'pending'
8. Offer nào SAU bước 7 vẫn chưa có variant_id:
     INSERT products        (status='draft', canonical_name=title,
                             slug=await uniqueSlug(slugify(title, 80), …))
     INSERT product_variants (variant_key = model.name)
     offers.variant_id = variant vừa tạo, match_status giữ 'pending'
     → match_candidates vẫn giữ để admin (1.8) merge draft vào product đã verify
9. UPSERT variant_current_price
10. SELECT refresh_variant_daily_prices(today, today)
```

Bước 8 bảo đảm **mọi offer đều có `variant_id` sau ingest**, nên mọi URL hợp lệ đều có trang sản phẩm. Đánh đổi đã chấp nhận: catalog lẫn product `draft`, admin phải dọn.

Thất bại giữa chừng → rollback hết. Không để lại listing không có offer, hay offer không có quan sát.

Dùng **service-role client**.

---

## 12. Route handlers

### `src/app/api/lookup/route.ts` — POST

```ts
// Request
{ url: string }

// Response
| { status: "ok";       productUrl: string }
| { status: "ingested"; productUrl: string }
| { status: "error"; code: ErrorCode; message: string; retryAfter?: number }

type ErrorCode =
  | "not_a_url" | "not_shopee" | "unrecognized_format"
  | "rate_limited" | "upstream_unavailable" | "internal";
```

```
1. parseShopeeUrl(body.url)
   needs_redirect → resolveShopeeRedirect → parse lại
   thất bại       → 400 + code tương ứng
2. checkLookupLimit  → vượt thì 429 + retryAfter
3. resolveOrIngestShopee
4. recordLookup(outcome)
```

Thông điệp lỗi phải **phân biệt được** `not_shopee` ("Hiện tại mới hỗ trợ Shopee") với `not_a_url` — gộp thành một lỗi chung là sai yêu cầu.

`Cache-Control: no-store`.

### `src/app/api/autocomplete/route.ts` — GET `?q=`

`q` dưới 2 ký tự → trả `[]`. Ngược lại gọi `search_products` với `p_limit: 8`, bỏ mọi filter. Trả `{ productId, slug, categorySlug, name, brand, image, bestPrice }[]`.

`Cache-Control: public, max-age=60`.

### `src/app/go/[marketplace]/[offerId]/route.ts` — GET

```
?src=web|extension|email|push  (giá trị lạ → 'web')
?watch={uuid}                  (tùy chọn)

1. SELECT affiliate_offers WHERE offer_id = …   (service role)
2. INSERT click_events { user_id?, offer_id, source, watch_id?, session_id }
3. sub_id gắn vào link affiliate = click_events.id  → đối soát conversions.click_ref
4. 302 tới: short_link ?? affiliate_url ?? listings.url
5. Không tìm thấy offer → 404
```

`Cache-Control: no-store`.

---

## 13. `src/lib/product-page-data.ts` — tầng đọc dữ liệu cho 1.2

```ts
export async function loadProductPageData(params: {
  productSlug: string;
  variantId?: string;
}): Promise<ProductPageData | null>;
```

Năm query song song bằng `Promise.all`, **anon client** (dữ liệu này public-read):

1. `products` + `categories` + `product_variants` + `variant_current_price` theo `slug`
2. `offers` của variant đang chọn + `listings` + `sellers` + `affiliate_offers`
3. `variant_daily_prices` — **luôn 90 ngày**, không theo `range`
4. `rpc('latest_price_per_offer', { p_variant_id })`
5. `rpc('variant_tracking_since', { p_variant_id })`

Không truyền `variantId` → chọn variant có `variant_current_price.price` thấp nhất và còn hàng.

Rồi gọi `buildVariantPricing()`. Đây là toàn bộ logic của 1.2 — phần còn lại chỉ là hiển thị.

---

## 14. `src/lib/search.ts`

```ts
export interface SearchParams {
  q?: string; categoryId?: string; brands?: string[];
  minPrice?: number; maxPrice?: number;
  sort?: "relevance" | "deal_score" | "price_asc" | "price_desc" | "updated";
  page?: number;
}

export interface SearchResult { items: SearchItem[]; total: number; page: number; pageSize: number; }

export function parseSearchParams(sp: URLSearchParams): SearchParams;
export function toSearchParams(p: SearchParams): URLSearchParams;
export async function searchProducts(p: SearchParams): Promise<SearchResult>;
```

- `sort` mặc định: `relevance` khi có `q`, `updated` khi không.
- `brands` lặp được: `?brand=samsung&brand=wd`.
- `pageSize = 24`, phân trang bằng offset.
- `parseSearchParams`/`toSearchParams` phải **round-trip** được — đó là điều kiện để filter/sort nằm trong URL và chia sẻ được.

**Test:** round-trip với mọi tổ hợp · `min > max` → hoán đổi · `page < 1` → 1 · sort lạ → mặc định.

---

## 15. Script

### `scripts/recompute-deal-scores.ts`

Chạy sau mỗi collector run. Với mỗi variant có dữ liệu trong 90 ngày: đọc rollup → `expandRollup` → `computeDealScore({ price: currentPrice, history })` (**không** `bestOffer`, theo §5.1) → upsert `variant_deal_scores`.

**Bắt buộc import `computeDealScore` từ `@/lib/deal-score`.** Cấm cài đặt lại logic tính điểm bằng SQL — hai bản cài đặt sẽ trôi khỏi nhau.

### `scripts/seed-dev.ts`

Gỡ phụ thuộc chặn vào Giai đoạn 0 (Shopee API + collector chưa sẵn sàng).

Sinh: ~8 categories · ~200 products (có `slug`, `search_text` tự sinh) · 2–4 variant/product · 1–5 offer/variant · **120 ngày** `price_observations` với xu hướng + nhiễu + vài đợt flash sale + **vài ngày hụt dữ liệu** (để kiểm chứng việc ngắt đoạn chart và ngưỡng 10 quan sát). Rồi chạy `refresh_variant_daily_prices` và `recompute-deal-scores`.

Phải có cả product `status='draft'` để kiểm chứng nhánh `isOfferVisible` ở §5.2.

---

## 16. Kiểm thử

**Chưa có test runner — dựng `vitest` trước tiên**, thêm script `"test": "vitest"`. `deal-score.ts` được viết thuần hàm chính là để chờ việc này.

| Module | Ca bắt buộc |
|---|---|
| `parseShopeeUrl` | 4 dạng hợp lệ · query rác · không shopee · không URL · rút gọn |
| `resolveShopeeRedirect` | chặn host lạ · chặn ở **hop thứ 2** · quá 3 hop · timeout · chặn `http://` · chặn `shopee.vn.evil.com` |
| `expandRollup` | bỏ ngày `min_price` null · `observed_at` = 12:00 giờ VN · giữ thứ tự |
| Ngưỡng qua rollup | 13 ngày → ⚪ · 14 ngày/9 ngày có dữ liệu → ⚪ · 14 ngày/10 ngày → có điểm |
| **§5.1** | không `bestOffer` cho điểm **thấp hơn** `bestOffer` = chính nó, cùng dữ liệu |
| `isOfferVisible` | `pending` + draft → hiện · `pending` + verified → ẩn · listing inactive → ẩn |
| `medianWindow` | biên `[-14,0)` và `[-74,-14)` · cửa sổ rỗng |
| Fake sale | thiếu dữ liệu → **không** ra nhãn |
| `buildChartSeries` | ngày trống → nhiều segment · <2 điểm → `renderable: false` |
| `slugify` | tiếng Việt có dấu · `Đ` → `d` · chống trùng |
| `search_products` | sanitize tsquery với `!`, `&`, `(`, chuỗi rỗng, chỉ khoảng trắng |
| `rate-limit` | đúng biên · khách vs user · trần toàn hệ thống → `upstream_unavailable` |
| SQL rollup | chạy với `TimeZone='UTC'` cho **cùng** kết quả như `Asia/Ho_Chi_Minh` |

---

## 17. Thứ tự sinh code

```
1. vitest
2. migration 0002
3. format.ts · slug.ts
4. price-history.ts          ← hạt nhân; test ngưỡng TRƯỚC khi đi tiếp
5. variant-pricing.ts        ← §5.1 là chỗ dễ sai nhất, test trước
6. chart-series.ts
7. seed-dev.ts               ← từ đây kiểm chứng được bằng dữ liệu thật
8. product-page-data.ts
9. search.ts + api/autocomplete
10. recompute-deal-scores.ts
11. shopee/parse-url.ts · resolve-redirect.ts · client.ts
12. rate-limit.ts · ingest.ts · api/lookup
13. go/[marketplace]/[offerId]
```

Bước 4–5 trước bước 7 là có chủ đích: engine tính điểm là phần rủi ro nhất, phải chốt bằng test trước khi có dữ liệu thật làm nhiễu.

---

## 18. KHÔNG sinh trong pha này

Không component React, không page, không layout, không CSS, không `manifest.webmanifest`.

Các hạng mục sau của checklist thuộc pha UI, pha này **chỉ chuẩn bị dữ liệu** cho chúng: chart SVG (1.2.c), variant picker (1.2.a), danh sách offer (1.2.b), badge điểm (1.2.e/f), nhãn fake sale (1.2.g), ô search + autocomplete (1.1.b), filter/sort (1.1.c), PWA share target (1.1.d).

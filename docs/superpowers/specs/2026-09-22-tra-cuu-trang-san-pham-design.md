# Spec — 1.1 Tra cứu & 1.2 Trang sản phẩm

> Nguồn: `docs/feature-checklist.md`, mục **1.1** và **1.2** (Giai đoạn 1 — MVP "Watch & Alert").
> Ngày: 2026-09-22 · Trạng thái: chờ duyệt
> Mỗi feature gồm hai tầng: **PRD** (làm gì, cho ai, đúng khi nào) và **Kỹ thuật** (làm bằng gì).

---

## 0. Phạm vi

### Trong phạm vi

| Mã | Feature |
|---|---|
| 1.1.a | Dán URL Shopee → trả về trang sản phẩm (P0) |
| 1.1.b | Search từ khóa trong catalog + autocomplete + chịu lỗi gõ sai |
| 1.1.c | Filter (danh mục, brand, khoảng giá) + Sort (Deal Score, giá, mới cập nhật) |
| 1.1.d | PWA share target |
| 1.2.a | Giá hiện tại theo variant + giá niêm yết + % giảm |
| 1.2.b | Danh sách offer cùng variant, sắp theo giá |
| 1.2.c | Chart giá 7/30/90 ngày, đánh dấu flash sale |
| 1.2.d | Low / Median / High + "Bắt đầu theo dõi từ ngày…" |
| 1.2.e | Deal Score v0 + 2–4 lý do tự sinh |
| 1.2.f | Buy / Wait / Avoid (gồm ⚪ Chưa đủ dữ liệu) |
| 1.2.g | Nhãn "Giảm giá chưa thực chất" (Fake Sale Detector v0) |
| 1.2.h | Hiển thị thời điểm cập nhật dữ liệu |
| 1.2.i | Nút mua qua `/go/…` + dòng disclosure |

### Ngoài phạm vi (chỉ định nghĩa điểm nối)

- **1.3 Watch** — spec này chỉ đặt chỗ cho CTA và định nghĩa tham số `variant_id` mà Watch cần.
- **1.4 Alert** — không đụng tới.
- **1.5 Affiliate** — chỉ định nghĩa **hợp đồng** của route `/go/…`; phần sinh link và nhập conversion thuộc spec riêng.
- **1.7 SEO** — route được thiết kế để SSR được và slug đúng chuẩn 1.7, nhưng sitemap / structured data / OG image thuộc spec riêng.
- **1.8 Admin** — hàng đợi duyệt matching và merge draft thuộc spec riêng. Spec này **tạo ra** công việc cho hàng đợi đó (xem 1.1.a).
- **1.9 Matcher** — chỉ gọi như một hộp đen với hợp đồng đã định nghĩa ở §3.4.

---

## 1. Các quyết định kiến trúc đã chốt

| # | Quyết định | Lý do |
|---|---|---|
| Đ1 | **Ingest on-demand** khi dán URL lạ | Cửa vào chính (P0) không được cụt ở lần thử đầu tiên; đồng thời nuôi catalog tự nhiên |
| Đ2 | **Postgres FTS + `pg_trgm`** cho search | Không thêm hạ tầng; đủ tốt ở quy mô vài nghìn sản phẩm của G1 |
| Đ3 | **Deal Score tính on-demand** từ bảng rollup ngày | Luôn tươi, giữ `deal-score.ts` thuần hàm và backtest được |
| Đ4 | **Chart SVG tự viết**, render trong Server Component | 0 KB JS, nằm trong HTML SSR — phục vụ 1.7 |
| Đ5 | **Thêm cache `variant_deal_scores`** cho *sort danh sách* | Không thể sort trước khi phân trang nếu score chỉ tồn tại trong Node. Cache gọi **đúng** `computeDealScore()` đó — không có logic điểm thứ hai. Trang chi tiết vẫn tính live và là nguồn sự thật |
| Đ6 | **Ingest không ghép được → tạo product/variant `draft`** | Mọi URL hợp lệ luôn ra một trang sản phẩm thật, URL không bao giờ phải đổi. Admin 1.8 merge draft vào product đã verify sau |
| Đ7 | **Deal Score đầu trang gọi KHÔNG truyền `bestOffer`** | Chấm cho offer rẻ nhất mà truyền `bestOffer` = chính nó thì thành phần 3 luôn = 100 → cộng khống +20, làm hỏng ngưỡng Buy ≥75 và cổng backtest ≥80% sang G2 |

### Đ7 — chi tiết, vì đây là bẫy dễ tái phạm

`computeDealScore()` có sẵn nhánh reweight **62.5 / 37.5** cho trường hợp thiếu dữ liệu multi-offer (`src/lib/deal-score.ts:154-157`). Dùng đúng nhánh đó:

```ts
// ĐÚNG — điểm hiển thị đầu trang, chấm cho offer rẻ nhất
const deal = computeDealScore({ price: cheapest.price, history });

// ĐÚNG — điểm riêng của từng offer trong danh sách, so với offer rẻ nhất
const perOffer = computeDealScore({ price: offer.price, history, bestOffer: cheapest.price });

// SAI — cBetween luôn = 100 vì cheapest.price <= cheapest.price
const wrong = computeDealScore({ price: cheapest.price, history, bestOffer: cheapest.price });
```

`deal-score.ts` **không bị sửa** trong spec này.

---

## 2. Thay đổi schema — migration `0002`

### 2.1 Extension và hàm hỗ trợ

```sql
create extension if not exists pg_trgm;
create extension if not exists unaccent;

-- unaccent() KHÔNG immutable → không dùng trực tiếp trong index hay generated column.
-- Bọc lại với schema-qualified dictionary để khai báo immutable một cách an toàn.
create or replace function public.f_unaccent(text)
returns text
language sql immutable parallel safe strict
as $$ select public.unaccent('public.unaccent', $1) $$;
```

### 2.2 `categories` — bảng còn thiếu

`products.category_id` hiện là `uuid` không có FK. Không có bảng này thì filter danh mục (1.1.c) và URL `/danh-muc/…` (1.7) đều không làm được.

```sql
create table public.categories (
  id         uuid primary key default gen_random_uuid(),
  slug       text not null unique,
  name       text not null,
  parent_id  uuid references public.categories(id) on delete set null,
  sort_order integer not null default 0,
  constraint categories_slug_format check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  -- URL sản phẩm là /{category}/{product} (2 đoạn). Các slug top-level dưới đây
  -- đã được route khác chiếm, cho phép làm slug danh mục sẽ sinh xung đột route.
  constraint categories_slug_reserved check (
    slug not in ('tim-kiem','brand','danh-muc','go','api','share-target','admin','auth','watch','tai-khoan')
  )
);

alter table public.products
  add constraint products_category_fk
  foreign key (category_id) references public.categories(id) on delete set null;
```

### 2.3 `products.slug` — cho URL chuẩn

```sql
alter table public.products add column slug text;
create unique index idx_products_slug on public.products (slug);
```

Slug là **unique toàn cục**, không phải unique trong danh mục — đổi danh mục của sản phẩm không làm hỏng link đã chia sẻ.

Sinh slug: `slugify(brand + ' ' + model)`, nếu trùng thì thêm hậu tố `-2`, `-3`… Với product `draft` sinh từ ingest (Đ6): `slugify(listing.title)` cắt ở 80 ký tự.

### 2.4 `products.search_text` — nền cho search

```sql
alter table public.products add column search_text text
  generated always as (
    public.f_unaccent(lower(
      coalesce(canonical_name,'') || ' ' ||
      coalesce(brand,'')          || ' ' ||
      coalesce(model,'')          || ' ' ||
      coalesce(gtin,'')
    ))
  ) stored;

create index idx_products_search_trgm on public.products using gin (search_text gin_trgm_ops);
create index idx_products_search_fts  on public.products using gin (to_tsvector('simple', search_text));
```

Dùng `'simple'` chứ không phải `'english'`: tiếng Việt không có stemmer trong Postgres, và stemmer tiếng Anh sẽ cắt sai tên model. Bỏ dấu (`f_unaccent`) là cách xử lý tiếng Việt chính — người dùng gõ "ban phim" phải ra "bàn phím".

### 2.5 `variant_current_price` — giá hiện tại, tra cứu O(1)

Không có bảng này thì mọi trang danh sách phải lateral join xuống `price_observations` để lấy giá mới nhất — đắt và không sort được.

```sql
create table public.variant_current_price (
  variant_id     uuid primary key references public.product_variants(id) on delete cascade,
  best_offer_id  uuid references public.offers(id) on delete set null,
  price          numeric(14,2),
  original_price numeric(14,2),
  is_flash_sale  boolean not null default false,
  in_stock       boolean not null default true,
  offer_count    integer not null default 0,
  observed_at    timestamptz not null
);

create index idx_vcp_price on public.variant_current_price (price);
```

Ghi bởi collector sau mỗi run (service role). `price` = giá thấp nhất trong các offer **còn hàng** của variant.

### 2.6 `variant_daily_prices` — rollup ngày

```sql
create table public.variant_daily_prices (
  variant_id      uuid not null references public.product_variants(id) on delete cascade,
  day             date not null,
  min_price       numeric(14,2),   -- thấp nhất trong ngày, ĐÃ loại flash sale
  median_price    numeric(14,2),
  max_price       numeric(14,2),
  obs_count       integer not null default 0,  -- số quan sát hợp lệ non-flash
  offer_count     integer not null default 0,  -- số offer khác nhau góp giá
  has_flash_sale  boolean not null default false,
  flash_min_price numeric(14,2),
  primary key (variant_id, day)
);

create index idx_vdp_variant_day on public.variant_daily_prices (variant_id, day desc);
```

Hàm refresh, gọi bởi collector cho các ngày bị ảnh hưởng (thường là hôm nay + hôm qua, để đón dữ liệu về muộn):

```sql
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
    min(po.price)                       filter (where not po.is_flash_sale),
    percentile_cont(0.5) within group (order by po.price)
                                        filter (where not po.is_flash_sale),
    max(po.price)                       filter (where not po.is_flash_sale),
    count(*)                            filter (where not po.is_flash_sale),
    count(distinct po.offer_id)         filter (where not po.is_flash_sale),
    bool_or(po.is_flash_sale),
    min(po.price)                       filter (where po.is_flash_sale)
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
```

**Múi giờ là bắt buộc phải nêu rõ.** `observed_at` là `timestamptz`; ép sang `date` mà không chỉ định múi giờ sẽ dùng `TimeZone` của session, khiến biên ngày trôi giữa dev và production và làm lệch chart.

### 2.7 `variant_deal_scores` — cache cho sort (Đ5)

```sql
create table public.variant_deal_scores (
  variant_id       uuid primary key references public.product_variants(id) on delete cascade,
  score            smallint,          -- null khi insufficient_data
  recommendation   text not null check (recommendation in ('insufficient_data','buy','wait','avoid')),
  price_at_compute numeric(14,2),
  computed_at      timestamptz not null default now()
);

create index idx_vds_score on public.variant_deal_scores (score desc nulls last);
```

Ghi bởi job `scripts/recompute-deal-scores.ts` chạy sau mỗi collector run. Job này **import và gọi `computeDealScore()` từ `src/lib/deal-score.ts`** — cấm mọi cài đặt lại logic tính điểm bằng SQL.

### 2.8 `lookup_requests` — rate limit cho URL lookup

```sql
create table public.lookup_requests (
  id         bigint generated always as identity primary key,
  ip_hash    text not null,
  user_id    uuid references public.users(id) on delete set null,
  outcome    text not null check (outcome in ('resolved','ingested','rejected','error')),
  created_at timestamptz not null default now()
);

create index idx_lookup_req_ip   on public.lookup_requests (ip_hash, created_at desc);
create index idx_lookup_req_time on public.lookup_requests (created_at desc);
```

`ip_hash = sha256(ip || LOOKUP_IP_SALT)` — **không lưu IP thô**, để nhất quán với privacy policy ở Giai đoạn 0.

### 2.9 RLS cho các bảng mới

Theo mô hình sẵn có: dữ liệu catalog/giá đọc công khai, ghi qua service role.

- `categories`, `variant_current_price`, `variant_daily_prices`, `variant_deal_scores` — **không bật RLS** (public read, như `products`).
- `lookup_requests` — **bật RLS, không có policy nào**. Chỉ service role đọc/ghi. Đây là dữ liệu vận hành, người dùng không có lý do gì để đọc.

---

## 3. Feature 1.1.a — Dán URL Shopee (P0)

### PRD

**Ai:** người lần đầu biết tới sản phẩm, đang đứng trên trang Shopee và muốn biết "giá này có tốt không".

**Luồng:** dán URL vào ô ở trang chủ → bấm "Kiểm tra giá" → tới trang sản phẩm tương ứng.

**Acceptance criteria**

1. Dán URL Shopee **đã có trong catalog và đã ghép variant** → chuyển tới `/{category}/{product}?variant=…` với đúng variant của listing đó, trong ≤ 2 giây.
2. Dán URL Shopee **chưa có trong catalog** → hệ thống ghi nhận sản phẩm, tạo quan sát giá đầu tiên, và vẫn hiện một trang sản phẩm với trạng thái ⚪ "Chưa đủ dữ liệu" + câu giải thích + CTA tạo Watch.
3. Dán URL **rút gọn** (`shope.ee/…`, `s.shopee.vn/…`) → xử lý như URL đầy đủ.
4. Dán URL **không phải Shopee** → thông báo "Hiện tại mới hỗ trợ Shopee" (không phải lỗi kỹ thuật chung chung).
5. Dán chuỗi **không phải URL** → thông báo phân biệt được với trường hợp 4.
6. Vượt rate limit → thông báo nêu rõ khi nào thử lại được, không phải lỗi 500.
7. Shopee API lỗi/timeout → thông báo tạm thời + ô nhập email để báo khi sẵn sàng; **không** tạo product rỗng.

**Không làm:** không hỗ trợ URL Lazada/TikTok Shop ở G1 (thuộc Giai đoạn 2).

### Kỹ thuật

#### `src/lib/shopee/parse-url.ts`

```ts
export type ParsedShopeeUrl =
  | { ok: true; shopId: string; itemId: string }
  | { ok: false; reason: "not_a_url" | "not_shopee" | "unrecognized_format" | "needs_redirect" };

export function parseShopeeUrl(raw: string): ParsedShopeeUrl;
```

Các dạng phải nhận được:

| Dạng | Ví dụ |
|---|---|
| Canonical | `https://shopee.vn/product/123456/789012` |
| Slug | `https://shopee.vn/Ổ-cứng-SSD-...-i.123456.789012` |
| Có query rác | `…?sp_atk=…&xptdk=…` |
| Rút gọn | `https://shope.ee/xxxx`, `https://s.shopee.vn/xxxx` → trả `needs_redirect` |

Quy ước khóa ngoại: **`external_item_id = "{shopId}_{itemId}"`**. Collector phải dùng đúng quy ước này (`listings` có `unique (marketplace, external_item_id)`).

#### Theo redirect của link rút gọn — lưu ý bảo mật

Chỉ chạy phía server, trong route handler. Đây là **SSRF surface**: người dùng cung cấp URL và server đi gọi nó.

- Allowlist host trước khi gọi: `shope.ee`, `s.shopee.vn`, `shopee.vn`.
- Tối đa **3 hop**, timeout **3 giây** mỗi hop.
- Kiểm tra allowlist lại **sau mỗi hop**, không chỉ hop đầu.
- Chỉ chấp nhận `https`.
- Không bao giờ trả body của redirect về client.

#### `POST /api/lookup`

```
Request:  { url: string }
Response: { status: "ok", productUrl: string }
        | { status: "ingested", productUrl: string }
        | { status: "error", code: ErrorCode, message: string, retryAfter?: number }

ErrorCode = "not_a_url" | "not_shopee" | "unrecognized_format"
          | "rate_limited" | "upstream_unavailable" | "internal"
```

Luồng:

```
1. Parse URL. Nếu needs_redirect → follow (allowlist + 3 hop + 3s) → parse lại.
2. Rate limit check (§3.3). Vượt → 429 + retryAfter.
3. SELECT listings WHERE marketplace='shopee' AND external_item_id = '{shopId}_{itemId}'
   ├─ Có, và tồn tại offer với variant_id IS NOT NULL
   │    → trả productUrl = /{category.slug}/{product.slug}?variant={variant_id}
   └─ Không có → sang bước 4 (ingest)
4. Ingest (service role, xem §3.4)
5. Ghi lookup_requests với outcome tương ứng.
```

Route handler dùng **service-role client** (`src/lib/supabase/admin.ts`) — ghi vào catalog phải bỏ qua RLS. Tuyệt đối không import client này vào Client Component.

#### §3.3 Rate limit

| Đối tượng | Ingest mới |
|---|---|
| Khách (theo `ip_hash`) | 10 / giờ |
| User đã đăng nhập | 60 / giờ |
| Toàn hệ thống | trần `LOOKUP_DAILY_INGEST_CAP` / ngày (mặc định 2000) |

Tra cứu URL **đã có trong catalog** không tính vào hạn mức ingest (không tốn quota Shopee), nhưng vẫn có hạn mức chống quét: 120 / giờ / IP.

Đếm bằng query trên `lookup_requests` với index `(ip_hash, created_at desc)` — **không dùng bộ đếm in-memory**, vì serverless chạy nhiều instance nên bộ đếm in-memory vừa sai vừa không chặn được gì.

Trần toàn hệ thống bảo vệ quota Shopee API; chạm trần thì trả `upstream_unavailable` chứ không phải `rate_limited` (người dùng không làm gì sai).

#### §3.4 Ingest — hợp đồng với Matcher (1.9)

```
a. Gọi Shopee API get_item_detail(shopId, itemId)
b. UPSERT sellers   (marketplace, external_seller_id)
c. UPSERT listings  (marketplace, external_item_id), refresh_priority = 1
d. INSERT offers    — một dòng cho mỗi model/variant của listing
e. INSERT price_observations — quan sát đầu tiên, source='api'
f. Gọi matcher v0 cho từng offer:
     confidence >= 0.95 → offers.variant_id = suggested, match_status='auto'
     ngược lại          → INSERT match_candidates (decision='pending'),
                          offers.match_status='pending'
g. Nếu SAU bước f vẫn còn offer chưa có variant_id (Đ6):
     INSERT products        (status='draft', slug=slugify(listing.title), canonical_name=listing.title)
     INSERT product_variants (variant_key = tên model từ Shopee)
     offers.variant_id = variant mới, match_status='pending'
     → match_candidates vẫn giữ nguyên để admin 1.8 merge draft vào product đã verify
h. UPSERT variant_current_price
i. Gọi refresh_variant_daily_prices(today, today)
```

Bước (g) là điểm mấu chốt của Đ6: sau ingest, **mọi offer đều có `variant_id`**, nên mọi URL hợp lệ đều có trang. Đánh đổi đã chấp nhận: catalog lẫn product `draft` chưa verify, admin phải dọn.

Toàn bộ b–i chạy trong **một transaction**. Thất bại giữa chừng thì rollback hết — không để lại listing không có offer hay offer không có quan sát.

---

## 4. Feature 1.1.b — Search + autocomplete + chịu lỗi gõ sai

### PRD

**Ai:** người biết mình cần gì nhưng chưa có link ("ssd samsung 2tb").

**Acceptance criteria**

1. Gõ đúng tên/brand/model → sản phẩm đó nằm trong 3 kết quả đầu.
2. Gõ **không dấu** ("ban phim co") → vẫn ra sản phẩm có dấu.
3. Gõ **sai chính tả nhẹ** ("samsng 990", "logitec") → vẫn ra kết quả đúng.
4. Autocomplete hiện tối đa 8 gợi ý, bắt đầu từ ký tự thứ **2**, debounce 250 ms.
5. Dán nguyên một **URL Shopee** vào ô search → nhận ra và chuyển sang luồng 1.1.a thay vì tìm chuỗi đó.
6. Không có kết quả → gợi ý bỏ bớt filter, và mời dán URL Shopee.
7. Trang kết quả **SSR được** (không phụ thuộc JS) để phục vụ 1.7.

### Kỹ thuật

#### Chiến lược truy vấn hai tầng

```
Tầng 1 — khớp chính xác (đi tắt):
  q khớp products.gtin, hoặc product_variants.variant_key,
  hoặc listings.external_item_id  → trả thẳng, rank cao nhất.

Tầng 2 — FTS prefix:
  to_tsvector('simple', search_text) @@ to_tsquery('simple', 'samsung:* & 990:*')
  ordered by ts_rank(...) desc

Tầng 3 — fallback trigram (CHỖ CHỊU LỖI GÕ SAI):
  chỉ chạy khi tầng 2 trả < 5 kết quả
  similarity(search_text, f_unaccent(lower(q))) > 0.25
  ordered by similarity desc
```

Dựng `tsquery` phải **sanitize**: tách q theo khoảng trắng, bỏ ký tự không phải `[a-z0-9]`, bỏ token rỗng, nối bằng ` & ` với hậu tố `:*`. Không bao giờ nối chuỗi người dùng thẳng vào `to_tsquery` — cú pháp tsquery sẽ ném lỗi với ký tự như `!`, `&`, `(`.

#### RPC `search_products`

```sql
create or replace function public.search_products(
  p_q           text    default null,
  p_category_id uuid    default null,
  p_brand       text    default null,
  p_min_price   numeric default null,
  p_max_price   numeric default null,
  p_sort        text    default 'relevance',  -- relevance|deal_score|price_asc|price_desc|updated
  p_limit       integer default 24,
  p_offset      integer default 0
) returns table (
  product_id       uuid,
  slug             text,
  canonical_name   text,
  brand            text,
  image            text,
  category_slug    text,
  best_price       numeric,
  original_price   numeric,
  score            smallint,
  recommendation   text,
  last_observed_at timestamptz,
  total_count      bigint
) language sql stable;
```

- `total_count` lấy bằng `count(*) over ()` — phân trang không cần query đếm riêng.
- Giá và điểm của product = giá thấp nhất / điểm tốt nhất trong các variant của nó, qua lateral join vào `variant_current_price` và `variant_deal_scores`.
- Gọi từ Server Component bằng `supabase.rpc('search_products', {...})` với **anon client** (`src/lib/supabase/server.ts`) — toàn bộ dữ liệu này là public-read.
- Filter/sort/phân trang làm hết trong SQL, một round trip.

#### `GET /api/autocomplete?q=`

Trả tối đa 8 dòng `{ productId, slug, categorySlug, name, brand, image, bestPrice }`. Dùng riêng tầng 2 + tầng 3, bỏ qua filter. Cache `Cache-Control: public, max-age=60`.

#### Giao diện

- `src/components/search/search-box.tsx` — Client Component. Debounce 250 ms, hủy request cũ bằng `AbortController`, điều hướng bàn phím ↑/↓/Enter/Esc, `role="combobox"` + `aria-activedescendant`.
- Nhận diện URL ngay trong ô nhập: nếu `q` parse được thành URL Shopee thì đổi nút thành "Kiểm tra giá" và POST sang `/api/lookup`.
- Trang `/tim-kiem` là **Server Component**, đọc `searchParams`. Ô search chỉ là lớp tiện ích phủ lên trên; gõ Enter vẫn là một form submit GET thường → hoạt động không cần JS.

---

## 5. Feature 1.1.c — Filter & Sort

### PRD

**Acceptance criteria**

1. Filter: danh mục (một cấp), brand (nhiều lựa chọn), khoảng giá (min/max).
2. Sort: Deal Score ↓, giá ↑, giá ↓, mới cập nhật.
3. Filter và sort nằm trong **URL** — chia sẻ được, back/forward đúng, SSR được.
4. Hiện các filter đang bật dưới dạng chip có nút bỏ, kèm nút "Xóa tất cả".
5. Sản phẩm ⚪ chưa đủ dữ liệu **xếp cuối** khi sort theo Deal Score, không bị ẩn.

### Kỹ thuật

URL: `/tim-kiem?q=&cat=&brand=&min=&max=&sort=&page=`

- `brand` lặp lại được: `?brand=samsung&brand=wd`.
- `sort` mặc định `relevance` khi có `q`, `updated` khi không có `q`.
- Sắp xếp theo Deal Score dùng `order by vds.score desc nulls last` — đó là cách ⚪ xuống cuối mà không biến mất.
- Filter là `<Link>` (Server Component), không phải onClick — giữ nguyên khả năng SSR và bò của Googlebot.
- Phân trang bằng offset. Ở quy mô G1 (vài nghìn sản phẩm) offset là đủ; ghi chú lại rằng cursor sẽ cần thiết nếu catalog vượt ~100k.

**Ràng buộc từ Đ5:** cột `score` đọc từ `variant_deal_scores`, tức là có độ trễ tối đa một chu kỳ collector. Trang kết quả **phải** hiện "Điểm cập nhật lúc …" để con số này không mâu thuẫn ngầm với trang chi tiết (vốn tính live).

---

## 6. Feature 1.1.d — PWA share target

### PRD

Trên Android, người dùng bấm Share trong app Shopee → chọn ứng dụng này → vào thẳng trang sản phẩm.

**Acceptance criteria**

1. Sau khi cài PWA, ứng dụng xuất hiện trong sheet Share của hệ thống.
2. Share một sản phẩm Shopee → đi đúng luồng 1.1.a.
3. Nội dung share thường là **text lẫn URL** ("Xem sản phẩm này nè https://shope.ee/xxx") → phải rút được URL ra khỏi text.
4. Trên iOS/desktop không hỗ trợ: không hiện gì thêm, không báo lỗi.

### Kỹ thuật

`public/manifest.webmanifest`:

```json
{
  "share_target": {
    "action": "/share-target",
    "method": "GET",
    "params": { "title": "title", "text": "text", "url": "url" }
  }
}
```

`src/app/share-target/page.tsx` — Server Component: lấy URL đầu tiên khớp regex trong `url ?? text ?? title`, gọi chung hàm phân giải với `/api/lookup`, rồi `redirect()`. Không tìm thấy URL thì chuyển sang `/tim-kiem?q={text}`.

**Đánh giá khả thi:** `share_target` cần manifest + service worker đã đăng ký + người dùng đã cài PWA. Chỉ Chrome/Android hỗ trợ. Đây là hạng mục "(nếu khả thi)" trong checklist → **xếp sau cùng trong 1.1**, cắt được mà không ảnh hưởng gì nếu hụt lịch.

---

## 7. Trang sản phẩm — khung chung cho 1.2

### Route

```
/{category}/{product}?variant={uuid}&range={7|30|90}
```

Không có `variant` → chọn variant có `variant_current_price.price` thấp nhất và còn hàng. Không có `range` → 30.

Xung đột route: `/tim-kiem` (1 đoạn) và `/go/…` (3 đoạn) không đụng. `/brand/{slug}` và `/danh-muc/{slug}` (2 đoạn) **có** đụng với `/[category]/[product]` — Next.js ưu tiên đoạn tĩnh trước đoạn động, nên vẫn đúng; ràng buộc `categories_slug_reserved` ở §2.2 là lớp chặn thứ hai để không ai vô tình tạo danh mục tên `brand`.

### Lấy dữ liệu

Server Component, năm query song song bằng `Promise.all`, đều qua anon client:

```ts
const [productRes, offersRes, historyRes, offerPricesRes, sinceRes] = await Promise.all([
  // 1. product + category + toàn bộ variants + giá hiện tại của từng variant
  supabase.from("products").select(`
    id, slug, canonical_name, brand, model, image, specs, status,
    categories ( slug, name ),
    product_variants ( id, variant_key, specs, variant_current_price ( * ) )
  `).eq("slug", productSlug).single(),

  // 2. các offer của variant đang chọn
  supabase.from("offers").select(`
    id, match_status,
    listings ( url, title, status, last_observed_at, sellers ( name, rating, rating_count, is_official ) ),
    affiliate_offers ( eligible, short_link, affiliate_url )
  `).eq("variant_id", variantId),

  // 3. rollup cho cửa sổ tính điểm — LUÔN lấy 90 ngày, không phải `range`
  supabase.from("variant_daily_prices").select("*")
    .eq("variant_id", variantId)
    .gte("day", iso(subDays(today, 90)))
    .order("day", { ascending: true }),

  // 4. giá mới nhất của TỪNG offer — variant_current_price chỉ có giá rẻ nhất,
  //    danh sách offer (1.2.b) cần giá riêng của mỗi dòng
  supabase.rpc("latest_price_per_offer", { p_variant_id: variantId }),

  // 5. ngày theo dõi đầu tiên — KHÔNG giới hạn 90 ngày, xem §11
  supabase.rpc("variant_tracking_since", { p_variant_id: variantId }),
]);
```

**`range` chỉ ảnh hưởng chart, không ảnh hưởng Deal Score.** Deal Score luôn tính trên cửa sổ 90 ngày (mặc định của `computeDealScore`). Nếu để `range` chi phối cửa sổ tính điểm thì bấm tab "7 ngày" sẽ làm đổi điểm — vô lý với người dùng và làm hỏng backtest. Chart nhận nguyên mảng 90 ngày rồi **tự cắt** theo `range`.

Hai RPC nhỏ cần thêm vào migration `0002`:

```sql
-- Quan sát mới nhất của mỗi offer thuộc variant (DISTINCT ON dùng đúng
-- index idx_price_obs_offer_time đã có sẵn).
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

create or replace function public.variant_tracking_since(p_variant_id uuid)
returns date language sql stable as $$
  select min(day) from variant_daily_prices where variant_id = p_variant_id
$$;
```

### `src/lib/price-history.ts`

```ts
import type { PriceObservation } from "@/lib/deal-score";

export interface DailyPriceRow {
  day: string;            // 'YYYY-MM-DD'
  min_price: number | null;
  median_price: number | null;
  max_price: number | null;
  obs_count: number;
  has_flash_sale: boolean;
  flash_min_price: number | null;
}

/**
 * Giãn rollup ngày thành chuỗi quan sát cho computeDealScore().
 * Mỗi ngày đóng góp ĐÚNG MỘT quan sát: giá thấp nhất trong ngày đã loại flash sale.
 * Ngày không có min_price (chỉ có flash sale, hoặc không thu được) bị bỏ qua.
 */
export function expandRollup(rows: DailyPriceRow[]): PriceObservation[];
```

Hệ quả có chủ đích đối với hai ngưỡng ở `deal-score.ts`:

| Ngưỡng | Ý nghĩa sau khi dùng rollup |
|---|---|
| `MIN_DAYS_FOR_SCORE = 14` | Khoảng cách từ ngày quan sát đầu tiên tới nay ≥ 14 ngày — **giữ nguyên nghĩa** |
| `MIN_OBSERVATIONS_FOR_SCORE = 10` | Số ngày **thực sự có dữ liệu** ≥ 10 → "collector không được hụt quá 4 ngày trong 14" |

Hai ngưỡng vẫn phân biệt và đều có ý nghĩa — đây là lý do không gộp chúng lại.

`observed_at` của quan sát sinh ra đặt tại **12:00 giờ Việt Nam** của ngày đó, để phép tính `daysBetween` không bị lệch một ngày do biên nửa đêm.

---

## 8. Feature 1.2.a — Giá hiện tại theo variant

### PRD

1. Hiện giá hiện tại của variant đang chọn, định dạng VND (`1.234.000 ₫`).
2. Có `original_price` > giá hiện tại → hiện giá niêm yết gạch ngang + `−X%`.
3. Không có `original_price`, hoặc `original_price` ≤ giá hiện tại → **không hiện gì**, không hiện `−0%`.
4. Hết hàng → hiện "Tạm hết hàng" + giá ghi nhận lần cuối kèm thời điểm.
5. Chuyển variant giữ nguyên tab `range` đang xem.
6. Variant nào chưa từng có quan sát nào → hiện "Chưa có dữ liệu giá", không hiện "0 ₫".

### Kỹ thuật

- `src/components/product/price-summary.tsx`, `variant-picker.tsx` (Server Component; mỗi variant là một `<Link>` đổi `?variant=`).
- `%` giảm làm tròn xuống (`Math.floor`) — không bao giờ làm tròn lên một con số khuyến mãi.
- Format tiền: `Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND', maximumFractionDigits: 0 })`.

---

## 9. Feature 1.2.b — Danh sách offer cùng variant

### PRD

1. Liệt kê mọi offer đang hoạt động của variant, **sắp theo giá tăng dần**.
2. Mỗi dòng: tên seller, nhãn Shop chính hãng (nếu có), rating + số lượt, giá, nút mua.
3. Offer rẻ nhất được đánh dấu rõ.
4. Offer hết hàng xếp cuối, làm mờ, không có nút mua.
5. Chỉ có một offer → vẫn hiện danh sách, kèm câu "Hiện chỉ có 1 người bán được theo dõi".
6. Mỗi offer hiện điểm riêng so với offer rẻ nhất (dạng gọn).

### Kỹ thuật

- `src/components/product/offer-list.tsx`.
- Chỉ lấy offer có `listings.status = 'active'` và `offers.match_status IN ('auto','manual')`. Offer `pending` **không** hiện ra cho người dùng — matching chưa chắc thì không được phép khẳng định "cùng một sản phẩm".
  - Ngoại lệ: product `draft` do ingest sinh ra (Đ6) có offer `pending` trỏ vào chính variant draft đó. Điều kiện hiện: `offers.variant_id = variantId` và variant đó thuộc product `draft` → hiện. Viết thành một hàm duy nhất `isOfferVisible()` để hai nhánh không trôi khỏi nhau.
- Điểm riêng từng offer: `computeDealScore({ price: offer.price, history, bestOffer: cheapest.price })` — đây là **chỗ duy nhất** truyền `bestOffer` (Đ7).

---

## 10. Feature 1.2.c — Chart giá 7/30/90 ngày

### PRD

1. Đường giá theo ngày trong cửa sổ đang chọn.
2. Tab 7 / 30 / 90 ngày.
3. Ngày có flash sale được đánh dấu riêng.
4. **Ngày thiếu dữ liệu thì ngắt đường, không nội suy** — vẽ liền mạch qua chỗ không có dữ liệu là bịa số liệu.
5. Cửa sổ chọn dài hơn lịch sử đang có → vẽ phần có, ghi rõ "Bắt đầu theo dõi từ …".
6. Chưa tới 2 ngày dữ liệu → không vẽ chart, hiện "Cần thêm dữ liệu để vẽ biểu đồ".
7. Đọc được bằng trình đọc màn hình.

### Kỹ thuật

`src/components/product/price-chart.tsx` — **Server Component**, trả `<svg>` thuần.

- `viewBox="0 0 720 260"`, co giãn theo container bằng CSS, không đo DOM.
- Trục y: `[min * 0.98, max * 1.02]`, 3 đường lưới tại low / median / high, nhãn tiền tệ.
- Trục x: tuyến tính theo ngày; nhãn thưa dần theo `range` (7 ngày → mỗi ngày; 90 ngày → mỗi 15 ngày).
- Ngắt đường: gom các ngày liên tiếp có `min_price` thành từng đoạn, mỗi đoạn một `<polyline>`.
- Flash sale: `<circle>` rỗng tại `flash_min_price` của ngày đó, kèm chú giải.
- Tab range là `<Link href="?variant=…&range=7">` — không cần JS.
- Truy cập được: `<title>` + `<desc>` trong `<svg>`, kèm một `<table>` ẩn thị giác (`sr-only`) chứa nguyên dữ liệu. Bảng này cũng là nội dung thật cho SEO ở 1.7.
- Tooltip hover: `src/components/product/price-chart-hover.tsx` — Client Component mỏng phủ lên trên, progressive enhancement. Không có JS thì chart vẫn đầy đủ thông tin.

**Không dùng thư viện chart** (Đ4). Nếu về sau cần nến/zoom/brush thì xem lại quyết định này.

---

## 11. Feature 1.2.d — Low / Median / High + ngày bắt đầu theo dõi

### PRD

1. Hiện giá thấp nhất / trung vị / cao nhất trong 90 ngày.
2. Hiện "Bắt đầu theo dõi từ {ngày}".
3. Chưa đủ ngưỡng dữ liệu → vẫn hiện các số đã có, nhưng ghi rõ là dựa trên bao nhiêu ngày.
4. Ghi rõ các số này **loại trừ flash sale**.

### Kỹ thuật

Lấy thẳng từ `DealScoreResult.stats` (`low`, `median`, `high`, `observations`, `daysCovered`) — không tính lại ở nơi khác, để trang không bao giờ tự mâu thuẫn với chính điểm số của mình.

"Bắt đầu theo dõi từ": lấy từ RPC `variant_tracking_since()` (§7, query 5) — **không** cắt theo cửa sổ 90 ngày. Đây là câu hỏi "các bạn theo dõi được bao lâu rồi", không phải "cửa sổ tính điểm"; lấy nhầm từ mảng rollup 90 ngày sẽ khiến một sản phẩm theo dõi 8 tháng hiện thành "bắt đầu theo dõi từ 90 ngày trước".

Chú thích bắt buộc, đặt ngay cạnh: *"Tính trên giá tốt nhất mỗi ngày, đã loại các đợt flash sale."* Nếu không ghi, con số "trung vị" sẽ bị hiểu là trung vị của mọi lần ghi nhận và người dùng sẽ thấy nó sai khi đối chiếu.

---

## 12. Feature 1.2.e + 1.2.f — Deal Score v0, lý do, Buy/Wait/Avoid

### PRD

1. Hiện điểm 0–100 kèm nhãn 🟢 Nên mua / 🟡 Có thể chờ / 🔴 Chưa nên mua / ⚪ Chưa đủ dữ liệu.
2. Hiện 2–4 lý do tự sinh.
3. ⚪ chưa đủ dữ liệu → **không hiện số điểm**, chỉ hiện đã theo dõi bao nhiêu ngày và còn thiếu gì.
4. Có phần giải thích mở rộng được: ba thành phần và trọng số.
5. Không trình bày điểm như lời khuyên tài chính; kèm câu miễn trừ.

### Kỹ thuật

```ts
const history  = expandRollup(historyRes.data);
const cheapest = visibleOffers[0];               // đã sort theo giá tăng dần
const deal     = computeDealScore({ price: cheapest.price, history });   // Đ7
```

- `src/components/product/deal-score-badge.tsx` — số + nhãn, màu theo `RECOMMENDATION_LABEL`.
- `src/components/product/deal-reasons.tsx` — render `deal.reasons` (đã được `deal-score.ts` cắt còn 4).
- Không có offer nào còn hàng → không chấm điểm, hiện "Tạm hết hàng ở mọi người bán đang theo dõi".
- Phần giải thích trọng số phải **nêu đúng trọng số đã dùng**: vì gọi không có `bestOffer`, trọng số thực tế là **62.5% / 37.5%**, không phải 50/30/20. Hard-code chuỗi "50/30/20" ở đây là sai và sẽ khiến người dùng cộng lại không khớp.

Màu sắc không phải kênh thông tin duy nhất — mỗi nhãn đi kèm chữ, để phục vụ người mù màu.

---

## 13. Feature 1.2.g — Nhãn "Giảm giá chưa thực chất"

### PRD

1. Phát hiện được thì hiện nhãn cảnh báo kèm một câu giải thích.
2. Không phát hiện thì **không hiện gì** (không hiện "✓ Giảm giá thật" — ta không đủ căn cứ để khẳng định điều đó).
3. Câu chữ mô tả **hiện tượng quan sát được**, không cáo buộc ý đồ người bán.

### Kỹ thuật

```ts
const fake = detectFakeSale({
  currentPrice:         cheapest.price,
  listedPrice:          cheapest.original_price ?? 0,
  median30d,            // trung vị min_price 30 ngày gần nhất
  median14dBeforeSale:  median14d,   // trung vị min_price ngày [-14, 0)
  median60dBefore:      median60d,   // trung vị min_price ngày [-74, -14)
});
```

**Điều kiện đủ dữ liệu, bắt buộc kiểm tra trước khi gọi:**

| Heuristic | Yêu cầu tối thiểu |
|---|---|
| Giảm niêm yết ≥20% nhưng giá ≥ median×0.95 | ≥ 14 ngày có dữ liệu trong 30 ngày |
| Tăng giá trước sale | ≥ 10 ngày trong cửa sổ `[-14,0)` **và** ≥ 30 ngày trong `[-74,-14)` |

Không đủ thì truyền `undefined` cho tham số tương ứng, để heuristic đó tự bỏ qua.

Lý do phải chặt tay ở đây: nhãn này là **một phát ngôn về người bán**. Một cảnh báo sai vì thiếu dữ liệu vừa làm mất niềm tin vào sản phẩm, vừa là rủi ro pháp lý. Thà bỏ sót còn hơn báo nhầm.

Câu chữ lấy nguyên từ `detectFakeSale()` (đã viết theo hướng mô tả hiện tượng). Không viết lại ở tầng UI.

---

## 14. Feature 1.2.h — Thời điểm cập nhật dữ liệu

### PRD

1. Hiện lần cập nhật gần nhất dạng tương đối ("cập nhật 2 giờ trước") + tuyệt đối khi hover.
2. Dữ liệu cũ hơn **48 giờ** → đổi sang trạng thái cảnh báo.
3. Điểm lấy từ cache (danh sách) hiện mốc thời gian riêng của cache.

### Kỹ thuật

- Nguồn: `variant_current_price.observed_at`.
- Render **tuyệt đối** phía server (`<time dateTime>`), một Client Component nhỏ chuyển sang dạng tương đối sau khi hydrate. Render dạng tương đối ngay từ server sẽ gây hydration mismatch và khiến trang SSR bị cache với chuỗi "2 giờ trước" đóng băng.

---

## 15. Feature 1.2.i — Nút mua `/go/…` + disclosure

### PRD

1. Mỗi offer có nút mua dẫn sang sàn.
2. Ngay dưới khu vực mua có dòng disclosure affiliate.
3. Click được ghi nhận để đối soát hoa hồng.
4. Không có link affiliate → vẫn cho mua bằng link gốc của listing.

### Kỹ thuật — chỉ hợp đồng, ruột thuộc 1.5

```
GET /go/{marketplace}/{offer_id}?src=web&watch={watch_id?}

1. Tra affiliate_offers theo offer_id
2. INSERT click_events (service role): user_id?, offer_id, source=src, watch_id?, session_id
3. sub_id gắn vào link affiliate = click_events.id  → đối soát với conversions.click_ref
4. 302 tới: affiliate_offers.short_link ?? affiliate_offers.affiliate_url ?? listings.url
5. Không tìm thấy offer → 404
```

- Thẻ `<a rel="nofollow sponsored" target="_blank">`.
- `Cache-Control: no-store` trên route này.
- `src` phải thuộc enum của `click_events.source` (`web|extension|email|push`); giá trị lạ → coi như `web`.
- Dòng disclosure là **bắt buộc**, không phải tùy chọn cấu hình: *"Chúng tôi có thể nhận hoa hồng khi bạn mua qua liên kết này. Giá bạn trả không thay đổi."*

---

## 16. Cấu trúc file

```
src/app/
  page.tsx                                thay landing hiện tại: ô search + dán URL
  tim-kiem/page.tsx                       kết quả tìm kiếm (RSC)
  share-target/page.tsx                   PWA share target
  [category]/[product]/page.tsx           trang sản phẩm (RSC)
  go/[marketplace]/[offerId]/route.ts     redirect affiliate (hợp đồng)
  api/lookup/route.ts                     POST — phân giải URL Shopee
  api/autocomplete/route.ts               GET  — gợi ý

src/components/
  search/search-box.tsx                   client, autocomplete
  search/filters.tsx                       server, filter dạng link
  search/product-card.tsx
  search/empty-state.tsx
  product/price-summary.tsx
  product/variant-picker.tsx
  product/offer-list.tsx
  product/price-chart.tsx                  SVG, server
  product/price-chart-hover.tsx            client, progressive enhancement
  product/deal-score-badge.tsx
  product/deal-reasons.tsx
  product/fake-sale-notice.tsx
  product/stats-row.tsx
  product/buy-button.tsx
  product/updated-at.tsx                   client, thời gian tương đối

src/lib/
  price-history.ts                         expandRollup() + các cửa sổ trung vị
  slug.ts                                  slugify + chống trùng
  format.ts                                tiền tệ, phần trăm, ngày
  rate-limit.ts                            đếm trên lookup_requests
  shopee/parse-url.ts
  shopee/resolve-redirect.ts               theo redirect, có allowlist
  shopee/client.ts                         bọc Shopee Open API
  ingest.ts                                luồng ingest §3.4

scripts/
  recompute-deal-scores.ts                 job cho Đ5
  seed-dev.ts                              dữ liệu giả, xem §18

supabase/migrations/
  0002_search_rollup_categories.sql
```

**Ranh giới bắt buộc giữ:** `src/lib/supabase/admin.ts` chỉ được import trong `api/lookup/route.ts`, `go/…/route.ts`, `src/lib/ingest.ts` và `scripts/`. Không bao giờ trong `src/components/`.

---

## 17. Kiểm thử

**Điều kiện tiên quyết: chưa có test runner.** Dựng `vitest` trước khi implement, thêm `pnpm test`. `src/lib/deal-score.ts` được viết thuần hàm chính là để chờ việc này.

| Đơn vị | Ca cần phủ |
|---|---|
| `parseShopeeUrl` | 4 dạng URL hợp lệ · query rác · không phải shopee · không phải URL · link rút gọn |
| `resolveRedirect` | chặn host ngoài allowlist · chặn ở hop thứ 2 · quá 3 hop · timeout · chặn `http://` |
| `expandRollup` | ngày trống bị bỏ · ngày chỉ có flash sale bị bỏ · `observed_at` đặt 12:00 giờ VN · thứ tự |
| Ngưỡng deal-score qua rollup | đúng 13 ngày → ⚪ · 14 ngày nhưng chỉ 9 ngày có dữ liệu → ⚪ · 14 ngày + 10 ngày có dữ liệu → có điểm |
| Đ7 | gọi không `bestOffer` cho ra điểm **thấp hơn** gọi có `bestOffer` = chính nó, trên cùng dữ liệu |
| Cửa sổ Fake Sale | biên `[-14,0)` và `[-74,-14)` · thiếu dữ liệu → không hiện nhãn |
| `slugify` | tiếng Việt có dấu · ký tự đặc biệt · chống trùng `-2`, `-3` |
| Sanitize `tsquery` | `!`, `&`, `(`, chuỗi rỗng, chỉ khoảng trắng |
| `rate-limit` | đúng biên hạn mức · khách vs user đăng nhập · trần toàn hệ thống |

SQL: kiểm tra `refresh_variant_daily_prices` bằng fixture, trọng tâm là **biên ngày theo giờ Việt Nam** — chạy với `TimeZone = 'UTC'` trong session để chứng minh kết quả không phụ thuộc cấu hình session.

---

## 18. Phụ thuộc, rủi ro, thứ tự làm

### Phụ thuộc chặn

1.1/1.2 không chạy với dữ liệu thật nếu **Giai đoạn 0** chưa xong (Shopee Open API + collector). Để không phải chờ:

`scripts/seed-dev.ts` sinh dữ liệu giả — ~200 sản phẩm, 2–4 variant mỗi sản phẩm, 1–5 offer mỗi variant, 120 ngày `price_observations` với biến động giá thực tế (xu hướng + nhiễu + vài đợt flash sale + vài ngày hụt dữ liệu). Chạy được `refresh_variant_daily_prices` lên nó. Toàn bộ UI của 1.1/1.2 dựng và test được trên dữ liệu này.

### Rủi ro

| Rủi ro | Xử lý |
|---|---|
| Shopee API không cấp trường `original_price` | 1.2.a và toàn bộ Fake Sale heuristic #1 mất căn cứ. **Cần xác nhận trong spike API ở Giai đoạn 0 trước khi implement 1.2.g** |
| Rate limit Shopee chặt hơn dự tính | Trần ingest toàn hệ thống hạ xuống; ingest on-demand có thể phải xếp hàng thay vì đồng bộ — khi đó 1.1.a trả trang "đang thu thập" thay vì trang sản phẩm |
| Catalog ngập product `draft` (Đ6) | Theo dõi tỉ lệ draft/verified; nếu vượt ~30% thì đẩy sớm hàng đợi merge của 1.8 |
| Điểm ở danh sách lệch điểm ở trang chi tiết (Đ5) | Cả hai nơi đều hiện mốc thời gian; job recompute chạy ngay sau collector |
| `pg_trgm` không đủ tốt khi catalog lớn | Chấp nhận ở G1. Ngưỡng xem lại: > 50k sản phẩm hoặc p95 search > 500 ms |

### Thứ tự đề xuất

```
1. vitest + migration 0002 + seed-dev
2. price-history.ts + thử nghiệm ngưỡng deal-score  ← chốt Đ7 bằng test trước khi dựng UI
3. Trang sản phẩm 1.2.a–f (không chart)
4. Chart 1.2.c
5. Fake sale 1.2.g + updated-at 1.2.h + buy button 1.2.i
6. Search + autocomplete 1.1.b
7. Filter/sort 1.1.c + job recompute-deal-scores (Đ5)
8. URL lookup + ingest 1.1.a
9. PWA share target 1.1.d  ← cắt được nếu hụt lịch
```

1.2 đi trước 1.1 vì 1.1 cần có đích để dẫn tới, và vì trên dữ liệu seed thì trang sản phẩm kiểm chứng được toàn bộ engine tính điểm — phần rủi ro nhất.

### Chỉ tiêu hiệu năng

- Trang sản phẩm TTFB < 500 ms (p95), search < 300 ms (p95).
- `/api/lookup` trường hợp đã có trong catalog < 500 ms; trường hợp ingest < 5 s (giới hạn bởi Shopee API).

---

## 19. Câu hỏi còn mở

1. **Ngưỡng confidence 0.95 của matcher** (1.9) chưa được kiểm chứng trên dữ liệu thật. Ảnh hưởng trực tiếp tới tỉ lệ product `draft` sinh ra ở Đ6. Xem lại sau 2 tuần chạy thật.
2. **Điểm riêng từng offer** (1.2.b mục 6) có thể gây rối khi danh sách dài. Cần thử với người dùng; cắt được mà không ảnh hưởng phần còn lại.
3. **Ngôn từ nhãn Fake Sale** nên được rà pháp lý trước khi lên production, cùng lúc với privacy policy và affiliate disclosure của Giai đoạn 0.

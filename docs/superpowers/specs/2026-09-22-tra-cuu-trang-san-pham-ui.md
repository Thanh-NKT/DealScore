# Spec sinh code — 1.1 & 1.2, tầng UI

> Pha 2, đi sau [bản logic](2026-09-22-tra-cuu-trang-san-pham-logic.md).
> Mọi kiểu dữ liệu ở đây **lấy từ bản logic**, không định nghĩa lại. Component không tự
> truy vấn DB và không tự tính toán — chỉ nhận dữ liệu đã dựng sẵn rồi trình bày.
> Quyết định sản phẩm đứng sau các trạng thái: xem [bản design](2026-09-22-tra-cuu-trang-san-pham-design.md).

---

## 0. Ràng buộc

| | |
|---|---|
| Framework | Next.js 16 App Router · React 19 Server Component mặc định |
| Styling | Tailwind 4 (`@import "tailwindcss"` trong `src/app/globals.css`) |
| Ngôn ngữ | Toàn bộ chữ hiển thị **tiếng Việt** |
| `"use client"` | Chỉ 4 component ở §2. Mọi thứ khác là Server Component |
| Không JS | `/tim-kiem` và trang sản phẩm phải **dùng được đầy đủ** khi JS tắt (phục vụ 1.7 SEO) |

### Nguyên tắc không được phá

1. **Component không gọi `computeDealScore`, `detectFakeSale`, `buildChartSeries`, hay bất kỳ client Supabase nào.** Page gọi `loadProductPageData()` / `searchProducts()` rồi truyền kết quả xuống. Tính toán hai nơi sẽ trôi khỏi nhau.
2. **Màu không bao giờ là kênh thông tin duy nhất.** Mỗi trạng thái đều có chữ đi kèm — người mù màu chiếm ~8% nam giới.
3. **Không bịa số.** Thiếu dữ liệu thì nói thiếu, không hiện `0 ₫`, không hiện `−0%`, không nội suy chart.

---

## 1. Token màu — thêm vào `src/app/globals.css`

Bốn trạng thái khuyến nghị cần màu riêng, có cả light và dark (file hiện đã có `prefers-color-scheme: dark`).

```css
:root {
  --rec-buy: #15803d;        --rec-buy-bg: #dcfce7;
  --rec-wait: #a16207;       --rec-wait-bg: #fef9c3;
  --rec-avoid: #b91c1c;      --rec-avoid-bg: #fee2e2;
  --rec-unknown: #525252;    --rec-unknown-bg: #f5f5f5;
  --warn: #b45309;           --warn-bg: #fffbeb;
  --muted: #737373;
  --border: #e5e5e5;
}

@media (prefers-color-scheme: dark) {
  :root {
    --rec-buy: #4ade80;      --rec-buy-bg: #14321f;
    --rec-wait: #facc15;     --rec-wait-bg: #332b0d;
    --rec-avoid: #f87171;    --rec-avoid-bg: #3b1616;
    --rec-unknown: #a3a3a3;  --rec-unknown-bg: #1f1f1f;
    --warn: #fbbf24;         --warn-bg: #2b2009;
    --muted: #a3a3a3;
    --border: #2e2e2e;
  }
}

@theme inline {
  --color-rec-buy: var(--rec-buy);
  --color-rec-wait: var(--rec-wait);
  --color-rec-avoid: var(--rec-avoid);
  --color-rec-unknown: var(--rec-unknown);
  --color-warn: var(--warn);
  --color-muted: var(--muted);
  --color-border: var(--border);
}
```

Mọi cặp chữ/nền phải đạt **tương phản ≥ 4.5:1** ở cả hai theme. Kiểm tra trước khi đổi giá trị.

---

## 2. Ranh giới server / client

Đúng **bốn** Client Component. Mọi component khác là Server Component.

| Component | Vì sao phải là client |
|---|---|
| `search/search-box.tsx` | Debounce, `AbortController`, điều hướng bàn phím trong danh sách gợi ý |
| `lookup/url-lookup-form.tsx` | `fetch` POST tới `/api/lookup`, trạng thái đang xử lý |
| `product/price-chart-hover.tsx` | Bắt `pointermove` trên chart |
| `product/updated-at.tsx` | Đổi mốc tuyệt đối sang "2 giờ trước" **sau khi hydrate** |

`updated-at` render dạng tương đối ngay từ server sẽ gây hydration mismatch, và trang SSR bị cache sẽ đóng băng chuỗi "2 giờ trước" mãi mãi. Server render `<time dateTime>` tuyệt đối, client thay sau.

Cả bốn đều **progressive enhancement**: JS tắt thì search-box vẫn submit form GET, url-lookup-form vẫn POST form thường, chart vẫn đủ thông tin, updated-at vẫn hiện ngày giờ tuyệt đối.

---

## 3. Trang sản phẩm — `src/app/[category]/[product]/page.tsx`

```tsx
export default async function ProductPage({ params, searchParams }: {
  params: Promise<{ category: string; product: string }>;          // Next 16: params là Promise
  searchParams: Promise<{ variant?: string; range?: string }>;
});
```

- `range` hợp lệ: `7 | 30 | 90`, mặc định `30`. Giá trị lạ → `30`, không báo lỗi.
- Gọi `loadProductPageData({ productSlug, variantId })`. Trả `null` → `notFound()`.
- `range` **chỉ cắt chart**. Deal Score luôn tính trên 90 ngày — bấm tab "7 ngày" mà điểm đổi là sai.

### Bố cục

```
<article>
  ProductHeader        ảnh, tên, brand, breadcrumb danh mục
  VariantPicker        nếu > 1 variant
  PriceSummary         giá, niêm yết, % giảm, trạng thái kho
  DealScoreBadge       + DealReasons + giải thích mở rộng
  FakeSaleNotice       chỉ khi có
  DraftProductNotice   chỉ khi products.status === 'draft'
  PriceChart           + tabs range
  StatsRow             low / median / high / theo dõi từ
  OfferList
  UpdatedAt + affiliate disclosure
</article>
```

Thứ tự này có chủ đích: người dùng vào để hỏi "giá này có tốt không", nên khuyến nghị phải đứng trên chart, chart đứng trên danh sách người bán.

---

## 4. `product/price-summary.tsx`

```tsx
interface PriceSummaryProps {
  cheapest: PricedOffer | null;   // từ VariantPricing
  offerCount: number;
}
```

| Điều kiện | Hiện |
|---|---|
| `cheapest` null, variant chưa có quan sát nào | "Chưa có dữ liệu giá cho phiên bản này" |
| `cheapest` có nhưng `inStock === false` ở **mọi** offer | "Tạm hết hàng" + giá ghi nhận lần cuối + `<UpdatedAt>` |
| Bình thường | `formatVnd(price)` cỡ lớn |
| `discountPercent !== null` | thêm giá niêm yết `<s>` + `−{n}%` |
| `discountPercent === null` | **không hiện gì** — không `−0%`, không giá gạch ngang |

`discountPercent` lấy sẵn trong `PricedOffer`, không tính lại.

---

## 5. `product/variant-picker.tsx`

```tsx
interface VariantPickerProps {
  variants: Array<{ id: string; variantKey: string; price: number | null; inStock: boolean }>;
  selectedId: string;
  range: 7 | 30 | 90;
}
```

- Mỗi variant là một `<Link href={`?variant=${id}&range=${range}`}>` — **giữ nguyên `range` đang xem**.
- `< 2` variant → không render gì.
- Variant đang chọn: `aria-current="true"` + dấu hiệu thị giác.
- Variant `price === null`: vẫn bấm được, hiện "chưa có giá".
- Variant hết hàng: làm mờ nhưng **vẫn bấm được** — người dùng có quyền xem lịch sử giá của thứ đang hết hàng.
- Bọc trong `<nav aria-label="Chọn phiên bản">`.

---

## 6. `product/deal-score-badge.tsx` + `deal-reasons.tsx`

```tsx
interface DealScoreBadgeProps { result: DealScoreResult; }   // từ @/lib/deal-score
interface DealReasonsProps    { reasons: string[]; }
```

| `recommendation` | Hiện |
|---|---|
| `buy` | `{score}/100` + "🟢 Nên mua", token `--rec-buy` |
| `wait` | `{score}/100` + "🟡 Có thể chờ", `--rec-wait` |
| `avoid` | `{score}/100` + "🔴 Chưa nên mua", `--rec-avoid` |
| `insufficient_data` | **không hiện số điểm**, chỉ "⚪ Chưa đủ dữ liệu" + số ngày đã theo dõi |

Nhãn lấy từ `RECOMMENDATION_LABEL` trong `@/lib/deal-score` — **không hard-code chuỗi**.

`DealReasons` render thẳng `result.reasons` (đã được cắt còn ≤ 4 ở tầng logic). Không lọc, không viết lại, không sắp xếp lại.

### Phần giải thích mở rộng — `<details>`, không cần JS

Nêu **đúng trọng số đã dùng**. Điểm đầu trang gọi không `bestOffer` nên trọng số thực tế là **62.5% percentile giá / 37.5% khoảng cách tới đáy**. Hard-code "50/30/20" ở đây là sai và người dùng cộng lại sẽ không khớp.

Kèm câu: *"Đây là thông tin tham khảo dựa trên lịch sử giá, không phải lời khuyên tài chính."*

---

## 7. `product/fake-sale-notice.tsx`

```tsx
interface FakeSaleNoticeProps { message: string | null; }
```

- `null` → **render null**. Tuyệt đối không hiện "✓ Giảm giá thật" — ta không đủ căn cứ khẳng định điều đó.
- Có → `<aside role="note">` với token `--warn`, tiêu đề "Giảm giá chưa thực chất", nội dung là `message` **nguyên văn** từ `detectFakeSale()`.

Không viết lại câu chữ ở tầng UI. Câu ở tầng logic đã được chọn để mô tả hiện tượng quan sát được, không cáo buộc ý đồ người bán — đây là phát ngôn về một doanh nghiệp có thật.

---

## 8. `product/price-chart.tsx` — SVG, Server Component

```tsx
interface PriceChartProps {
  series: ChartSeries;     // từ @/lib/chart-series
  range: 7 | 30 | 90;
  variantId: string;
  rows: DailyPriceRow[];   // cho bảng sr-only
}
```

### Hình học

- `viewBox="0 0 720 260"`, `preserveAspectRatio="none"` **không** dùng; co giãn bằng `class="w-full h-auto"`.
- Padding: trái 64 (nhãn tiền), phải 16, trên 16, dưới 32 (nhãn ngày).
- Trục y: `[min * 0.98, max * 1.02]`. 3 đường lưới tại low / median / high, nhãn `formatVnd`.
- Trục x: tuyến tính theo ngày. Mật độ nhãn — `range 7` → mỗi ngày · `30` → mỗi 5 ngày · `90` → mỗi 15 ngày.
- **Mỗi phần tử `series.segments` là một `<polyline>` riêng.** Không nối các segment lại — khoảng trống là ngày không có dữ liệu, vẽ liền qua đó là bịa số liệu.
- `series.flashMarkers` → `<circle r="3" fill="none">` tại giá đó, kèm chú giải "◦ Ngày có flash sale".
- `series.renderable === false` → không vẽ SVG, hiện "Cần thêm dữ liệu để vẽ biểu đồ".

### Tabs range

```tsx
<nav aria-label="Khoảng thời gian">
  {[7, 30, 90].map(r => (
    <Link href={`?variant=${variantId}&range=${r}`} aria-current={r === range ? "true" : undefined}>
      {r} ngày
    </Link>
  ))}
</nav>
```

Là `<Link>`, không phải `onClick` — chart hoạt động không cần JS.

### Truy cập được

- `<svg role="img" aria-labelledby>` trỏ tới `<title>` + `<desc>` bên trong.
- `<title>`: "Biểu đồ giá {n} ngày".
- `<desc>`: "Giá thấp nhất từ {formatVnd(min)} đến {formatVnd(max)}, theo dõi {n} ngày."
- Kèm `<table class="sr-only">` chứa **toàn bộ** cặp ngày–giá. Bảng này vừa phục vụ trình đọc màn hình, vừa là nội dung thật cho SEO ở 1.7.

### `product/price-chart-hover.tsx`

Client, phủ tuyệt đối lên trên SVG. Nhận cùng tập điểm kèm toạ độ đã tính:

```tsx
interface ChartHoverProps {
  points: Array<{ x: number; y: number; day: string; price: number }>;
  width: number; height: number;
}
```

Toạ độ do `price-chart.tsx` tính và truyền xuống — **client không tính lại hình học**, nếu không hai bên sẽ lệch.

Bắt `pointermove`, tìm điểm gần nhất theo trục x, hiện đường dọc + hộp ngày/giá. Rời chuột thì ẩn. Không có JS → không có tooltip, chart vẫn đầy đủ thông tin.

---

## 9. `product/stats-row.tsx`

```tsx
interface StatsRowProps {
  stats: DealScoreResult["stats"];
  trackingSince: string | null;
}
```

Bốn ô: Thấp nhất / Trung vị / Cao nhất / Theo dõi từ.

- Số lấy **nguyên** từ `stats` — cùng nguồn với Deal Score, nên trang không bao giờ tự mâu thuẫn.
- `low/median/high` null → "—".
- `trackingSince` từ RPC `variant_tracking_since`, **không** cắt theo 90 ngày. Sản phẩm theo dõi 8 tháng phải hiện 8 tháng.
- Chú thích bắt buộc ngay cạnh: *"Tính trên giá tốt nhất mỗi ngày, đã loại các đợt flash sale."* Thiếu câu này, "trung vị" sẽ bị hiểu là trung vị mọi lần ghi nhận và người dùng đối chiếu sẽ thấy sai.
- `stats.daysCovered < 30` → thêm "Dựa trên {n} ngày dữ liệu".

---

## 10. `product/offer-list.tsx` + `buy-button.tsx`

```tsx
interface OfferListProps { offers: PricedOffer[]; }   // ĐÃ sắp xếp ở tầng logic
interface BuyButtonProps { offerId: string; marketplace: string; disabled?: boolean; }
```

`offers` đã được `buildVariantPricing` lọc và sắp xếp. UI **không lọc lại, không sắp lại**.

Mỗi dòng: tên seller · nhãn "Shop chính hãng" nếu `sellerIsOfficial` · rating + số lượt nếu có · `formatVnd(price)` · `BuyButton`.

| Điều kiện | Xử lý |
|---|---|
| Dòng đầu tiên | Nhãn "Rẻ nhất" |
| `inStock === false` | Làm mờ, xếp cuối (đã sắp sẵn), **không** có nút mua |
| `offers.length === 1` | Thêm "Hiện chỉ có 1 người bán được theo dõi" |
| `offers.length === 0` | "Chưa có người bán nào được theo dõi cho phiên bản này" |
| `dealScore !== null` | Hiện điểm gọn của riêng dòng đó |

### BuyButton

```tsx
<a
  href={`/go/${marketplace}/${offerId}?src=web`}
  target="_blank"
  rel="nofollow sponsored noopener"
>Mua trên Shopee</a>
```

`rel="nofollow sponsored"` là **bắt buộc**, không phải tuỳ chọn — đây là liên kết tiếp thị.

### Disclosure

Đặt ngay dưới khu vực mua, luôn hiện, không thu gọn được:

> Chúng tôi có thể nhận hoa hồng khi bạn mua qua liên kết này. Giá bạn trả không thay đổi.

---

## 11. `product/updated-at.tsx` — client

```tsx
interface UpdatedAtProps { iso: string | null; isStale: boolean; }
```

- Server render: `<time dateTime={iso}>{ngày giờ tuyệt đối}</time>`.
- Sau hydrate: đổi text sang tương đối ("2 giờ trước"), giữ nguyên `dateTime` và thêm `title` là mốc tuyệt đối.
- `isStale` (cũ hơn 48 giờ) → thêm token `--warn` và chữ "Dữ liệu có thể đã cũ".
- `iso === null` → "Chưa có dữ liệu".

---

## 12. `product/draft-product-notice.tsx`

Hiện khi `products.status === 'draft'` — sản phẩm vừa được tạo từ luồng dán URL và chưa ghép vào catalog đã kiểm duyệt.

> Chúng tôi vừa bắt đầu theo dõi sản phẩm này. Cần khoảng 14 ngày để có đủ dữ liệu chấm điểm. Tạo Watch để được báo khi giá giảm.

Kèm CTA tạo Watch (thuộc 1.3 — pha này chỉ để chỗ, `<button disabled>` hoặc link tới trang đăng nhập).

---

## 13. Trang tìm kiếm — `src/app/tim-kiem/page.tsx`

```tsx
export default async function SearchPage({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
});
```

Dùng `parseSearchParams` → `searchProducts` → render. Không gọi RPC trực tiếp.

```
SearchBox           (client, giá trị khởi tạo từ q)
ActiveFilterChips   chip có nút bỏ + "Xóa tất cả"
Filters             danh mục, brand, khoảng giá
SortSelect          <form method="get">, submit khi đổi
ProductCard[]       lưới
Pagination          <Link> prev/next
```

### `search/filters.tsx` — Server Component

Mọi filter là `<Link>`, **không phải** `onClick`. Đây là điều kiện để trang SSR được và Googlebot bò được.

- Brand chọn nhiều: mỗi brand là một link bật/tắt, giữ nguyên các tham số khác.
- Khoảng giá: `<form method="get">` với `min`/`max` + các tham số hiện tại làm `<input type="hidden">`.
- Đổi filter → `page` reset về 1.

### `SortSelect`

`<form method="get">` bọc `<select name="sort">` + `<noscript><button>Sắp xếp</button></noscript>`. Có JS thì submit khi `change`.

Khi `sort === 'deal_score'`: hiện "Điểm cập nhật lúc {…}" cạnh danh sách. Điểm ở đây đọc từ cache `variant_deal_scores` nên trễ tối đa một chu kỳ collector; không ghi rõ thì nó sẽ lệch ngầm với trang chi tiết (vốn tính live).

### `search/product-card.tsx`

```tsx
interface ProductCardProps { item: SearchItem; }
```

Ảnh · tên · brand · `formatVnd(bestPrice)` · badge điểm gọn. `bestPrice` null → "Chưa có giá". `score` null → badge ⚪.

Toàn bộ card là một `<Link>` tới `/{categorySlug}/{slug}`.

### `search/empty-state.tsx`

| Tình huống | Hiện |
|---|---|
| Có `q`, không kết quả | "Không tìm thấy sản phẩm nào cho *{q}*" + gợi ý bỏ bớt filter + `UrlLookupForm` |
| Không `q`, filter quá hẹp | "Không có sản phẩm nào khớp bộ lọc" + nút "Xóa tất cả" |
| Không `q`, không filter | Không phải trạng thái rỗng — hiện sản phẩm mới cập nhật |

---

## 14. `search/search-box.tsx` — client

```tsx
interface SearchBoxProps { initialQuery?: string; }
```

Bọc trong `<form action="/tim-kiem" method="get">` → **Enter vẫn hoạt động khi JS tắt**.

Khi có JS:
- Debounce **250 ms**, gọi `/api/autocomplete?q=`, bắt đầu từ ký tự thứ **2**.
- Huỷ request cũ bằng `AbortController`.
- Tối đa **8** gợi ý.
- Bàn phím: `↑`/`↓` di chuyển · `Enter` chọn · `Esc` đóng.
- ARIA: `role="combobox"` + `aria-expanded` + `aria-controls` trên input; `role="listbox"`/`role="option"` cho danh sách; `aria-activedescendant` trỏ option đang chọn.
- Đang tải → `aria-busy="true"`, không hiện spinner gây nhảy layout.

**Nhận diện URL:** nếu giá trị nhập parse được thành URL Shopee thì đổi nhãn nút thành "Kiểm tra giá" và chuyển sang luồng `UrlLookupForm` thay vì tìm chuỗi đó. Dùng `parseShopeeUrl` từ `@/lib/shopee/parse-url` (hàm thuần, import được vào client).

---

## 15. `lookup/url-lookup-form.tsx` — client

```tsx
interface UrlLookupFormProps { autoFocus?: boolean; }
```

POST `/api/lookup` → `router.push(productUrl)` khi `ok`/`ingested`. Đang xử lý: nút `disabled` + "Đang kiểm tra…".

`status === "ingested"` mất tới ~5 giây (phải gọi Shopee API) — sau 2 giây hiện thêm "Lần đầu theo dõi sản phẩm này, cần thêm chút thời gian."

### Bảng chữ lỗi — mỗi mã một câu riêng

| `code` | Chữ hiện |
|---|---|
| `not_a_url` | "Hãy dán một đường dẫn sản phẩm." |
| `not_shopee` | "Hiện tại mới hỗ trợ Shopee." |
| `unrecognized_format` | "Không đọc được đường dẫn này. Hãy thử sao chép lại từ ứng dụng Shopee." |
| `rate_limited` | "Bạn đã tra cứu khá nhiều. Thử lại sau {retryAfter}." |
| `upstream_unavailable` | "Chưa lấy được dữ liệu từ Shopee lúc này." + ô nhập email báo khi sẵn sàng |
| `internal` | "Có lỗi xảy ra. Vui lòng thử lại." |

Gộp `not_shopee` và `not_a_url` thành một câu chung là **sai yêu cầu** — người dùng phải biết mình sai ở đâu.

`role="alert"` cho vùng lỗi.

---

## 16. Trang chủ — `src/app/page.tsx`

Thay landing hiện tại. `SupabaseStatus` chỉ giữ khi `NODE_ENV !== 'production'`.

```
<h1> + một dòng mô tả giá trị
UrlLookupForm    (autoFocus)
SearchBox
Sản phẩm mới cập nhật   — searchProducts({ sort: 'updated', page: 1 })
```

---

## 17. `src/app/share-target/page.tsx`

Server Component. Lấy `url ?? text ?? title` từ `searchParams` → `extractFirstUrl` → phân giải → `redirect()`.

Không rút được URL → `redirect('/tim-kiem?q=' + text)`. Không render gì cho người dùng thấy.

Cần `public/manifest.webmanifest`:

```json
{
  "name": "Kairo",
  "short_name": "Kairo",
  "start_url": "/",
  "display": "standalone",
  "share_target": {
    "action": "/share-target",
    "method": "GET",
    "params": { "title": "title", "text": "text", "url": "url" }
  }
}
```

Chỉ Chrome/Android hỗ trợ `share_target`, và cần PWA đã cài. Trên iOS/desktop **không hiện gì thêm, không báo lỗi**. Đây là hạng mục "(nếu khả thi)" — cắt được mà không ảnh hưởng phần còn lại.

---

## 18. Responsive

Mobile-first. Một breakpoint đáng kể: `md` (768px).

| Vùng | < 768px | ≥ 768px |
|---|---|---|
| Trang sản phẩm | 1 cột | ảnh + thông tin 2 cột, chart full width |
| Chart | viewBox giữ nguyên, co theo `w-full` | như cũ |
| StatsRow | lưới 2×2 | 1 hàng 4 ô |
| OfferList | thẻ xếp dọc | hàng ngang |
| Lưới kết quả | 1 cột | 3–4 cột |
| Filters | `<details>` thu gọn | cột bên |

Không có horizontal scroll ở mọi bề rộng. Vùng chạm tối thiểu 44×44px.

---

## 19. Kiểm thử UI

Thêm `@testing-library/react` + `jsdom` vào `vitest` đã dựng ở pha logic.

| Component | Ca bắt buộc |
|---|---|
| `PriceSummary` | `discountPercent` null → **không** render giá gạch ngang · hết hàng → không có nút mua |
| `DealScoreBadge` | `insufficient_data` → **không** render số điểm · nhãn lấy từ `RECOMMENDATION_LABEL` |
| `FakeSaleNotice` | `message` null → render null |
| `PriceChart` | 2 segment → 2 `<polyline>` · `renderable` false → không có `<svg>` · có `<table class="sr-only">` |
| `OfferList` | rỗng · đúng 1 offer · offer hết hàng không có nút mua · `rel` chứa `nofollow sponsored` |
| `StatsRow` | low null → "—" · luôn có chú thích loại flash sale |
| `UrlLookupForm` | 6 mã lỗi ra 6 câu **khác nhau** |
| `SearchBox` | JS tắt → vẫn là form GET hợp lệ tới `/tim-kiem` · `aria-activedescendant` đổi theo `↑`/`↓` |
| `Filters` | mọi filter là `<a href>`, không phải `<button>` · đổi filter → `page=1` |

Kiểm tra bằng tay, không tự động hoá được: tương phản màu ở **cả hai** theme, và duyệt toàn trang bằng bàn phím.

---

## 20. Thứ tự sinh

```
1. globals.css (token)
2. format helper đã có sẵn từ pha logic — chỉ import
3. DealScoreBadge · DealReasons · FakeSaleNotice · StatsRow   ← thuần trình bày, dễ test
4. PriceSummary · VariantPicker
5. OfferList · BuyButton · disclosure
6. PriceChart (SVG)  →  PriceChartHover
7. UpdatedAt · DraftProductNotice
8. app/[category]/[product]/page.tsx     ← lắp toàn bộ 1.2
9. ProductCard · EmptyState · Filters · Pagination
10. SearchBox · UrlLookupForm
11. app/tim-kiem/page.tsx · app/page.tsx
12. share-target + manifest.webmanifest   ← cắt được nếu hụt lịch
```

Bước 3 trước bước 8 là có chủ đích: các component thuần trình bày test được bằng dữ liệu giả, không cần DB chạy.

---

## 21. Không quyết định trong spec này

Spec này khoá **cấu trúc, trạng thái, khả năng truy cập và ranh giới server/client** — những thứ sai thì phải sửa lại từ gốc.

Không khoá: typography, khoảng cách, bo góc, hiệu ứng chuyển, nhận diện thương hiệu, minh hoạ. Cứ dùng mặc định Tailwind; tinh chỉnh khi có yêu cầu riêng.

# ✅ Checklist Feature — Personal Shopping Intelligence

> Trích & tổ chức từ `product_backlog_personal_shopping_intelligence_v2.md`.
> Checklist theo lộ trình 5 giai đoạn. Đánh dấu `[x]` khi hoàn thành.

**North Star:** số Watch đang hoạt động.
**Nguyên tắc chặn:** Collector phải chạy từ tuần đầu Giai đoạn 0 — lịch sử giá bỏ lỡ không lấy lại được.

---

## 🧪 Giai đoạn 0 — Kiểm chứng & gom dữ liệu (tuần 1–4)

> Phần lớn là việc vận hành / đối tác, không làm được trong code. Code đã chừa sẵn điểm nối.

### Hạ tầng dữ liệu (ưu tiên cao nhất)
- [ ] Đăng ký Shopee Affiliate + lấy quyền Open API
- [ ] Spike API: cấp giá (listing/variant), original price, stock, rating, voucher, flash sale, rate limit, phạm vi phủ, trường conversion report
  - ⚠️ Chưa spike. Mọi hiểu biết về API là **giả định G1–G6** (`docs/superpowers/specs/2026-09-23-affiliate-design.md` §1); `getItemDetail` ném `ShopeeUnavailableError` cho tới khi có API thật.
- [ ] Kiểm tra bảng commission thực tế của ngách công nghệ
- [ ] Dựng catalog khởi đầu 500–2.000 sản phẩm (brand, model, variant, specs)
  - ✏️ Hiện chỉ có dữ liệu seed dev (`pnpm seed:dev`, `source = 'seed'`) + ingest on-demand khi dán URL.
- [ ] Collector chạy ổn định, ghi `price_observations` + `collector_runs`
  - ✏️ Code collector đã xong (1.10) nhưng chỉ chạy thật khi có Shopee Open API; chưa có dữ liệu ≥ 2 tuần.

### Chiến lược & pháp lý
- [ ] Phân tích đối thủ (BeeCost, Lichsugia, Mua Thông Minh, AliPrice, BigBuy360)
- [ ] Landing page + waitlist
- [x] Privacy policy, terms, affiliate disclosure (bản cơ bản)
  - `/privacy`, `/terms`; dòng disclosure dưới danh sách offer (`offer-list.tsx`) và nhãn "liên kết tiếp thị" trên `BuyButton`.

**Điều kiện sang G1:** biết rõ API cung cấp gì · collector chạy ≥ 2 tuần, lỗi < 5% · vài trăm người waitlist.

---

## 🚀 Giai đoạn 1 — MVP "Watch & Alert" (tháng 2–3)

> Chú thích: `[x]` xong (logic + UI + test) · ✏️ đã làm nhưng lệch / bổ sung so với checklist gốc · ⚠️ còn thiếu.
> Spec chi tiết: `docs/superpowers/specs/`. Kiểm tra ngày 2026-09-25 (sau khi làm 1.7/1.9/1.10/1.11): `pnpm test` 468 ✓ · `pnpm test:db` 57 ✓ · `tsc` + `lint` sạch.

### 1.1 Tra cứu (cửa vào chính)
- [x] Dán URL Shopee → trả về trang sản phẩm (P0)
  - `lookupShopeeUrl()` (`src/lib/lookup/`) dùng chung cho `/api/lookup` và `/share-target`: chuẩn hóa → parse → hạn mức chống quét → theo redirect (allowlist host) → tra catalog → hạn mức ingest → RPC `ingest_shopee_item` (một transaction).
  - ✏️ URL chưa có trong catalog chỉ ingest được khi có Shopee API (hoặc `SHOPEE_CLIENT=fake` ở dev).
- [x] Search từ khóa trong catalog (tên/brand/model/SKU) + autocomplete + chịu lỗi gõ sai
  - Postgres FTS + `pg_trgm` (`word_similarity`), RPC `search_products`, `/api/autocomplete`.
- [x] Filter: danh mục, brand, khoảng giá — Sort: Deal Score, giá, mới cập nhật
  - ✏️ Sort theo Deal Score đọc cache `variant_deal_scores` — phải chạy `pnpm scores:recompute` sau mỗi lượt collector.
- [x] PWA share target (nếu khả thi)
  - `manifest.webmanifest` + `/share-target` (GET, cùng hạn mức với `/api/lookup`).

### 1.2 Trang sản phẩm
- [x] Giá hiện tại theo variant + giá niêm yết + % giảm
- [x] Danh sách offer cùng variant (nhiều seller), sắp theo giá
- [x] Chart giá 7/30/90 ngày, đánh dấu điểm flash sale
- [x] Low / Median / High + "Bắt đầu theo dõi từ ngày…"
  - ✏️ Đáy / trung vị / đỉnh luôn hiện, kể cả khi chưa đủ ngưỡng chấm điểm.
- [x] Deal Score v0 + giải thích (2–4 lý do tự sinh)
- [x] Buy / Wait / Avoid (gồm trạng thái "Chưa đủ dữ liệu")
- [x] Nhãn "Giảm giá chưa thực chất" (Fake Sale Detector v0)
  - ✏️ Heuristic #2 (tăng giá trước sale) chỉ chạy khi đang có đợt giảm.
- [x] Hiển thị thời điểm cập nhật dữ liệu
- [x] Nút mua qua `/go/…` (affiliate) + dòng disclosure

### 1.3 Watch (gộp Wishlist + Target Price + Alert)
- [x] Tạo / sửa / xóa Watch cho một variant
  - ✏️ Thêm: tạm dừng, đánh dấu đã mua. Mỗi người một Watch/variant, tối đa 50 Watch đang hoạt động.
- [x] Điều kiện trigger: giá ≤ target, giảm ≥ X%, chạm đáy, Deal Score ≥ X, có hàng lại
  - Nhiều điều kiện nối bằng HOẶC, có ngưỡng trễ (`src/lib/watch/conditions.ts`).
- [x] Hiển thị khoảng cách tới target + thay đổi giá + trạng thái alert
- [x] Danh sách "Watch của tôi" (`/account/watch`)

### 1.4 Alert
- [x] Kênh email + web push (Resend; VAPID + `public/sw.js`)
- [x] Chống spam: tối đa 1 alert/Watch/24h + gộp nhiều alert thành 1 email
  - `decideAlert()` + `tests/lib/alerts/scenarios.test.ts` (cam kết "không spam").
- [x] Nội dung alert: giá mới, Deal Score, lý do, link mua, link quản lý Watch
  - ✏️ Link "Quản lý Watch" trỏ vào danh sách `/account/watch` (chưa có trang chi tiết từng Watch).
- [x] Bật/tắt từng kênh, chọn tần suất
  - ✏️ Thêm giờ im lặng; hủy đăng ký một chạm không cần đăng nhập (token HMAC).
  - ⚠️ Alert Engine chạy qua pg_cron 15 phút/lần và sau mỗi lượt collector — nhưng collector chờ Shopee API nên chưa có giá mới để báo.

### 1.5 Affiliate
- [x] Sinh + cache affiliate link / short link
  - ✏️ Mặc định dựng link dài `an_redir` theo từng click (không cần cache). Chế độ `short_link` chỉ đọc `affiliate_offers.short_link` — **chưa có job sinh short link** (chỉ cần nếu giả định G1 sai).
- [x] Redirect `/go/{marketplace}/{offer_id}` + ghi `click_events` với sub_id
- [x] Nhập conversion report vào bảng `conversions`
  - Cron `/api/cron/conversions` (6 giờ/lần, lease lock) + CSV `pnpm conversions:import`. ⚠️ Adapter API dựa trên giả định G3/G4 chưa spike.

### 1.6 Tài khoản
- [x] Đăng nhập email + mật khẩu, đăng ký, quên mật khẩu (thay magic link — xem specs 2026-09-24-mat-khau-*)
- [x] Cài đặt thông báo, xóa tài khoản, xuất dữ liệu
  - ✏️ Xóa mềm, khôi phục trong 30 ngày rồi xóa hẳn (`/api/cron/purge-accounts`); cổng đồng ý điều khoản có phiên bản; xuất JSON (`/account/export`).

### 1.7 SEO nền tảng
- [x] SSR cho trang sản phẩm / danh mục / brand
  - `/{category}/{product}`, `/{category}`, `/brand/{brand}` đều SSR, dùng được khi tắt JS; slug lạ → 404.
- [x] URL chuẩn (`/ssd/samsung-990-pro-2tb`, `/brand/…`, `/danh-muc/…`)
  - ✏️ Danh mục là `/{category}` (vd `/ssd`), không phải `/danh-muc/…` — khớp cấu trúc URL sản phẩm. Canonical bỏ `?variant=`/`?range=`; sản phẩm draft `noindex`.
- [x] Sitemap + structured data (Product, Offer) + OG image
  - `sitemap.xml` (sản phẩm verified, danh mục, brand), `robots.txt`, JSON-LD `Product` + `AggregateOffer` (không bịa rating), ảnh OG 1200×630 theo sản phẩm (`src/lib/seo/`).

### 1.8 Admin tối thiểu
> Tách sang `docs/admin-checklist.md` của repo Admin-DealScore (spec, plan, style UI của admin cũng ở đó) — làm sau.

### 1.9 Product matching v0
- [x] Gợi ý tự động từ brand + model + dung lượng/màu/size
  - `src/lib/matching/` (hàm thuần), chỉ so với sản phẩm **verified**; brand phải khớp, thuộc tính mâu thuẫn → 0.
- [x] Confidence ≥ 95% → tự gán; thấp hơn → hàng đợi duyệt (màn hình duyệt thuộc Admin)
  - Nối vào `ingest_shopee_item` (migration `0008`): ≥ 0.95 → offer `auto`, không sinh draft; 0.5–0.95 → draft + dòng `match_candidates`. Lỗi matcher không làm hỏng tra cứu URL.

### 1.10 Hạ tầng
- [x] Pipeline: Collector → Normalizer → Matcher → Price DB → Deal Engine → Alert Engine
  - `runCollector()`: chọn listing đến hạn (có Watch → 2 giờ/lần) → `record_observations` → rollup → Deal Score → `evaluateWatches`. Cron mỗi giờ + `pnpm collector:run`.
  - ⚠️ Chỉ chạy thật khi có Shopee Open API (chờ spike Giai đoạn 0); hiện tự bỏ qua, test bằng `SHOPEE_CLIENT=fake`. Model mới của listing cũ vào DB dạng offer chưa gán, chờ Admin.
- [x] Backtest job chạy hằng tuần
  - `src/lib/pricing/backtest.ts` + cron 03:00 thứ Hai → `backtest_runs`; `pnpm backtest:run`. Buy đúng khi 30 ngày sau không giảm ≥ 5%; Wait/Avoid đúng khi có giảm.
- [x] Rate limiting + chống bot cho lookup URL + backup DB
  - ✏️ Backup = backup hằng ngày/PITR của Supabase + `pnpm db:backup` (bản ngoài Supabase, hằng tuần) — xem `supabase/README.md`.
- [x] Error tracking (Sentry) + uptime monitoring
  - Sentry chỉ bật khi có `SENTRY_DSN`; `/api/health` (503 khi DB lỗi, `degraded` khi collector trễ > 6 giờ). ⚠️ Còn phải tạo project Sentry và monitor UptimeRobot/Better Stack (việc vận hành).

### 1.11 Analytics
- [x] Event tracking cho các chỉ số North Star (PostHog / GA4)
  - ✏️ First-party thay PostHog/GA4: bảng `analytics_events` (8 sự kiện, thuộc tính theo allow-list, không cookie bên thứ ba) + view `metrics_active_watches`, `metrics_daily_active_users`, `metrics_retention_d30`; Alert→Click dùng `alert_click_rate_daily`. Có trong export 1.6, xóa theo tài khoản.

**Điều kiện sang G2:** ≥ 1.000 Watch · Alert→Click ≥ 15% · Retention D30 ≥ 25% · có đơn affiliate đối soát · backtest Buy/Wait ≥ 80%.

---

## 📈 Giai đoạn 2 — Mở rộng & tạo moat (tháng 4–6)
- [x] Chrome Extension (nhận diện trang Shopee, Deal Score, tạo Watch, thu quan sát giá có đồng ý)
  - `extension/` (MV3): khung Kairo trên trang Shopee, Watch một chạm, chia sẻ giá khi bật (mặc định tắt). API `/api/extension/*` chỉ nhận Origin của extension.
  - ✏️ Giá từ extension chỉ vào lịch sử khi **xác nhận chéo** (≥ 2 người khác nhau lệch ≤ 2% trong 24 giờ, hoặc khớp giá API). ⚠️ Bộ đọc trang (E1) và cookie phiên (E2) là giả định, phải kiểm trên Shopee/Chrome thật; cần icon + `EXTENSION_IDS` trước khi lên Web Store.
- [ ] Mở rộng nguồn: TikTok Shop → Lazada
  - ✏️ Đã có khung adapter đa sàn (`src/lib/marketplaces/`): nhận diện URL TikTok Shop / Lazada, `/go` và collector theo sàn. ⚠️ Chưa có nguồn dữ liệu (chờ spike API).
- [x] So sánh giữa các sàn (khi ≥ 2 sàn)
  - Khối "So sánh giữa các sàn" trên trang sản phẩm (`compareMarketplaces`), chỉ hiện khi ≥ 2 sàn có giá còn hàng thật.
- [x] Product comparison A vs B
  - `/compare?a=&b=` (`src/lib/compare/build.ts`): câu tóm tắt, bảng tiêu chí có đánh dấu bên tốt hơn, bảng thông số; nút "So sánh" trên trang sản phẩm; chọn sản phẩm bằng autocomplete, không JS vẫn chọn được.
- [x] Price Drop Radar (trang sản phẩm giảm mạnh)
  - ✏️ `/radar`: giảm ≥ 10% so với **trung vị 30 ngày thật** (không so giá niêm yết), còn hàng, giá mới trong 48 giờ; lọc theo danh mục.
- [x] Trang "Trending / Most Watched"
  - `/trending`: "Nhiều người theo dõi" (≥ 2 Watch) và "Đang được quan tâm" (lượt xem 7 ngày tăng, ≥ 3); RPC chỉ trả số đếm tổng hợp.
- [x] Share deal kèm OG image
  - Nút "Chia sẻ" (Web Share → sao chép link → hiện link để copy tay), link `?ref=share`, sự kiện `deal_shared` / `share_opened`; ảnh OG theo sản phẩm từ 1.7.
- [x] Deal Score v1 (thêm trend, volatility, stock, seller quality)
  - ✏️ v1 = v0 + tối đa ±15 điểm, mỗi điều chỉnh có lý do; mặc định qua `scoreDeal()`. Điểm headline chỉ dùng trend/volatility (khớp điểm ở danh sách); tồn kho và người bán áp cho từng offer. Backtest hằng tuần chạy cả v0 và v1.
- [ ] Product matching v1 + dashboard chất lượng dữ liệu
  - ✏️ Matching v1 xong: GTIN, bí danh brand, bộ nhãn (0 match sai, recall 17/17). View `metrics_matching_quality`. ⚠️ Dashboard thuộc Admin (`docs/admin-checklist.md` của repo Admin-DealScore).
- [x] Google login
  - `signInWithGoogle` → `/auth/callback` → AuthGate. ⚠️ Nút ẩn cho tới khi cấu hình OAuth client + `NEXT_PUBLIC_GOOGLE_AUTH=1` (`supabase/README.md`).
- [x] Filter nâng cao (rating, freeship, voucher)
  - Lọc theo offer tốt nhất của variant đại diện; nhóm lọc chỉ hiện khi có dữ liệu. ✏️ Freeship/voucher mới có nguồn từ extension (đã xác nhận chéo).
- [ ] Mở rộng catalog sang ngách lân cận
  - Việc vận hành, không có code.

**Điều kiện sang G3:** dữ liệu ≥ 2 sàn ổn định, matching ≥ 95% · Watch & doanh thu affiliate tăng theo tháng · SEO chiếm tỷ trọng traffic đáng kể.

---

## 🧠 Giai đoạn 3 — Intelligence (tháng 6–12)
- [x] Search hiểu ý định ("SSD 2TB dưới 3 triệu")
  - ✏️ Rule-based (`src/lib/intent/`), không dùng LLM; chip "Đã hiểu" trên `/search` gỡ được từng điều kiện; `intent=0` tắt hoàn toàn, tìm theo từ khóa gốc.
- [x] Natural language search
  - Cùng bộ parser rule-based với dòng trên; tham số URL luôn thắng suy luận từ câu tự nhiên.
- [ ] Shopping Mission (mô tả nhu cầu → shortlist 3 sản phẩm)
- [ ] Mission tự theo dõi (Watch nhiều sản phẩm)
- [ ] Cá nhân hóa (Deal Feed + ranking + recommendation)
- [x] Voucher & Effective Price
  - ✏️ Giá sau khi áp voucher tốt nhất (`src/lib/vouchers/effective.ts`, cột `offers.effective_price`); chưa gồm phí ship. Deal Score vẫn chấm theo giá niêm yết, không đổi.
- [x] User preferences (brand/danh mục/giá/sàn)
  - ✏️ Chỉnh ở `/account/preferences`; chỉ áp vào search khi bật "Theo sở thích của tôi" (`?prefs=1`), mặc định tắt. `excluded_brands` để dành cho nhóm C.

---

## 🏢 Giai đoạn 4 — Kinh doanh hóa (năm 2+)
- [ ] Premium (alert tần suất cao, nhiều Watch, phân tích nâng cao, Pro agent)
- [ ] Sponsored / featured (bắt buộc gắn nhãn)
- [ ] Public API (`/products`, `/prices`, `/history`, `/deals`, `/search`)
- [ ] B2B Price Intelligence
- [ ] Mobile app native + visual/voice search + quốc tế
- [ ] Price prediction (dạng xác suất)

---

## 📌 Tham chiếu spec
- **Deal Score v0:** percentile giá 50% / khoảng cách tới đáy 30% / so sánh offer 20% (reweight 62.5/37.5 khi không có bestOffer).
- **Ngưỡng dữ liệu:** ≥ 14 ngày & ≥ 10 quan sát hợp lệ mới chấm điểm.
- **Buy/Wait/Avoid:** 🟢 ≥75 & P≤median · 🟡 50–74 · 🔴 <50 hoặc P>median×1.05 · ⚪ chưa đủ dữ liệu.
- **Fake Sale v0:** giảm niêm yết ≥20% nhưng P≥median×0.95, hoặc tăng giá trước sale (median 14d > median 60d ×1.15).

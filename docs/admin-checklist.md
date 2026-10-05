# ✅ Checklist Admin — Personal Shopping Intelligence

> Tách từ mục **1.8 Admin tối thiểu** của [`feature-checklist.md`](feature-checklist.md) (Giai đoạn 1), cập nhật
> 2026-10-05 sau đợt **nguồn dữ liệu thật** (Shopee/TikTok Affiliate), **tự tìm sản phẩm** và **gom bản nháp**.
> **Admin là một app riêng (repo khác), chỉ một người quản lý (chủ dự án).** Kairo không có trang `/admin`. Trong lúc
> chưa có app, mọi việc admin làm trong Supabase Studio. Đánh dấu `[x]` khi hoàn thành.
> Thứ tự ưu tiên: **P0** cần ngay khi bật dữ liệu thật · **P1** cần trong vài tuần đầu · **P2** làm sau.
> Mỗi tính năng ghi rõ cách làm: **[DB]** app admin đọc/ghi Supabase trực tiếp · **[RPC]** cần một hàm SQL mới trong
> migration của Kairo (thao tác nhiều bảng, phải chạy trong một transaction) · **[API]** gọi endpoint admin của Kairo (cần
> logic chỉ có trong code Kairo).

## Đã có sẵn trong code / DB (điểm nối)
- **Catalog & matching:** `products.status` (`draft` / `verified`), `products.draft_key` (khóa gom bản nháp, 0019),
  `offers.match_status` (`auto` / `manual` / `rejected` / `pending`), hàng đợi `match_candidates`.
- **Nguồn dữ liệu:** `marketplace_credentials` (token TikTok, hạn `access_expires_at` / `refresh_expires_at`),
  `configuredMarketplaces()` cho biết sàn nào đang bật.
- **Collector:** `collector_runs` (`items_ok`, `items_failed`, `error_summary`, `per_marketplace`),
  `listings.last_observed_at` / `last_attempt_at` (0018 — lần thử gần nhất kể cả khi lỗi), `listings.status`.
- **Tự tìm sản phẩm:** `sourcing_queries` (`origin` `seed` / `demand`, `active`, `request_count`, `last_requested_at`,
  `next_page`, `last_run_at`), `sourcing_runs` (số sản phẩm thấy / thêm / bỏ qua / lỗi theo sàn).
- **Cron (pg_cron):** `kairo-collector`, `kairo-alerts`, `kairo-conversions`, `kairo-backtest`, `kairo-sourcing`,
  `kairo-sourcing-demand` — lịch sử chạy ở `cron.job_run_details`.
- **Báo cáo:** view `affiliate_daily`, `affiliate_by_alert`, `metrics_*` (người dùng, Watch, retention),
  `metrics_matching_quality`, `alert_click_rate_daily`.

## Kiến trúc app admin (repo riêng)
- **Kết nối dữ liệu:** dùng chung project Supabase với Kairo. App admin giữ `SUPABASE_SERVICE_ROLE_KEY` **chỉ ở phía server**
  (server action / route handler) — không bao giờ gửi xuống trình duyệt. Bảng private (`marketplace_credentials`,
  `sourcing_*`, `match_candidates`…) chỉ đọc được bằng service role.
- **Đăng nhập (một người):** một tài khoản duy nhất. Gợi ý: Supabase Auth email + mật khẩu, server kiểm `user.email ===
  ADMIN_EMAIL` (env của app admin) trước mọi thao tác; thêm 2FA (TOTP của Supabase Auth). Không cần hệ thống vai trò.
- **Nói chuyện với Kairo:** việc nào cần logic của Kairo thì gọi endpoint `/api/admin/*` của Kairo, kèm header
  `Authorization: Bearer <ADMIN_API_SECRET>` (secret riêng, khác `CRON_SECRET`), chỉ gọi từ server của app admin.
- **Kiểu dữ liệu:** copy `src/lib/database.types.ts` của Kairo (sinh lại bằng `supabase gen types` trỏ cùng project) —
  schema chỉ thay đổi qua migration trong repo Kairo, không tạo bảng/cột từ app admin.

## Quyết định cần chốt trước khi làm
- [ ] Nhật ký thao tác (`admin_audit`: thao tác, bảng, id, trước/sau, thời điểm): dù chỉ một người, vẫn nên có để xem lại /
  hoàn tác thủ công khi gộp/tách sản phẩm sai
- [ ] Host app admin ở đâu (tên miền riêng, có chặn thêm bằng IP / Cloudflare Access không)

## Việc phía Kairo cần làm để app admin dùng được
- [ ] **P0** Endpoint `/api/admin/*` + kiểm `ADMIN_API_SECRET` (so sánh constant-time như `isAuthorizedCronRequest`), không
  dùng cookie, `Cache-Control: no-store`
- [ ] **P0** [API] `GET /api/admin/status` → sàn nào đã cấu hình, thật hay giả lập, có link affiliate chưa (`configuredMarketplaces()`)
- [ ] **P0** [API] `POST /api/admin/tiktok/authorize-url` → trả link ủy quyền TikTok (state ký bằng `CRON_SECRET` nằm ở Kairo)
- [ ] **P1** [API] `POST /api/admin/probe` `{ marketplace, input }` → dữ liệu gốc (đã che secret) + `MarketplaceItem` (logic
  `pnpm marketplace:probe`)
- [ ] **P1** [API] `POST /api/admin/sourcing/run` `{ marketplace?, mode }` → chạy một lượt sourcing (dùng chung khóa `sourcing`)
- [ ] **P0** [RPC] `admin_promote_draft(product_id, fields, variants)` — duyệt bản nháp → verified (một transaction)
- [ ] **P0** [RPC] `admin_move_offer(offer_id, target_variant_id | null, block_reclustering)` — tách offer khỏi bản nháp gom
  nhầm (null = tạo bản nháp mới); `block_reclustering` ghi dấu để `ingest_listing` không gom offer này lại
- [ ] **P0** [RPC] `admin_review_match(candidate_id, decision, variant_id?)` — duyệt / từ chối / gán lại gợi ý trong `match_candidates`, cập nhật `offers.match_status` + giá hiện tại
- [ ] **P1** [API] `POST /api/admin/conversions/import` (CSV, logic của `pnpm conversions:import`)
- [ ] **P1** [RPC] `admin_merge_products(source_id, target_id, variant_map)` — chuyển variant / offer / Watch / lịch sử giá,
  rồi `refresh_variant_current_price` + tính lại Deal Score
- [ ] **P1** [RPC] `admin_set_listings_inactive(listing_ids[])`, `admin_cron_status()` (đọc `cron.job_run_details`, vốn không
  lộ qua PostgREST)
- [ ] **P1** Ghi `admin_audit` bên trong các RPC trên (nếu chốt có nhật ký)

## Nền tảng (app admin)
- [ ] **P0** Đăng nhập một tài khoản + kiểm `ADMIN_EMAIL` ở server trước mọi thao tác
- [ ] **P1** Trang tổng quan (đếm nhanh: nháp chờ duyệt, gợi ý match chờ, listing lỗi, lượt cron lỗi 24 giờ, hạn token TikTok)

## Kết nối sàn & nguồn dữ liệu
- [ ] **P0** [API] Trạng thái kết nối từng sàn: đã cấu hình chưa (env của Kairo — app admin không đọc được, cần `GET /api/admin/status`), thật hay giả lập, lần lấy giá thành công gần nhất
- [ ] **P0** [DB + API] TikTok: hạn access token / refresh token, cảnh báo khi còn < 7 ngày hoặc đã hết, nút "Kết nối lại" (in link
  ủy quyền như `pnpm tiktok:authorize`, thay cho việc phải chạy script)
- [ ] **P1** [API] Chạy thử nguồn ngay trên trang (tương đương `pnpm marketplace:probe`): dán URL / từ khóa → xem dữ liệu gốc và
  dữ liệu sau chuẩn hóa, cảnh báo field trống — để kiểm giả định S1–S3 / T1–T4 khi sàn đổi API

## Sức khỏe pipeline
- [ ] **P0** [DB] Dashboard collector: lượt gần nhất, tỷ lệ lỗi theo **từng sàn** (`per_marketplace`), sàn bị dừng (`aborted`),
  `error_summary`
- [ ] **P0** [RPC] Trạng thái cron: lượt chạy gần nhất + lỗi của từng job `kairo-*` (`cron.job_run_details`), job nào không chạy
  (thiếu secret Vault `kairo_app_url` / `kairo_cron_secret`)
- [ ] **P1** [DB + RPC] Listing lỗi liên tục: danh sách listing có `last_attempt_at` mới nhưng không có quan sát giá mới (sàn trả "không
  tìm thấy"), thao tác **tắt listing** hàng loạt — Kairo không tự đánh dấu `gone` khi API chỉ báo "không thấy"
- [ ] **P1** [DB] Offer stale > 48 giờ theo sàn (giá đang hiện có thể đã cũ)
- [ ] **P1** [DB] Cảnh báo cho admin (email — job định kỳ của app admin đọc DB) khi: tỷ lệ lỗi collector > 5%, một sàn bị dừng 3 lượt liên tiếp, cron không chạy
  > 2 giờ, token TikTok sắp hết hạn

## Tự tìm sản phẩm (sourcing)
- [ ] **P0** [DB] Quản lý `sourcing_queries`: thêm / bật / tắt / sửa từ khóa và danh mục theo sàn, xem `next_page` và lần chạy
  gần nhất, nút "chạy lại từ trang 1"
- [ ] **P0** [DB] Từ khóa nhu cầu (`origin = 'demand'`): danh sách theo `request_count`, **tắt từ khóa rác / không phù hợp**
  (bộ lọc chỉ chặn dữ liệu cá nhân, không chặn nội dung lạ), xem từ khóa nào đã ra sản phẩm
- [ ] **P1** [DB] Báo cáo `sourcing_runs`: sản phẩm mới mỗi ngày theo sàn, tỷ lệ trùng / lỗi, so với trần `SOURCING_DAILY_CAP` và
  `SOURCING_DEMAND_DAILY_CAP`
- [ ] **P2** [API] Chạy tay một lượt sourcing (tương đương `pnpm sourcing:run`) cho một sàn / chế độ `demand`

## Catalog: bản nháp & matching
- [ ] **P0** [DB] Hàng đợi bản nháp: danh sách `draft` sắp theo số nơi bán (bản nháp gom ≥ 2 shop lên trước — đây là bản đang
  hiện trên search), xem các tin bán, khoảng giá, `draft_key`
- [ ] **P0** [RPC] Duyệt bản nháp → `verified`: đặt tên chuẩn, hãng, model, danh mục, ảnh, thông số; tách thành variant đúng
  (dung lượng / màu / size). Mọi shop đã gom đi theo sản phẩm
- [ ] **P0** [RPC] **Tách tin bán khỏi bản nháp gom nhầm**: chuyển một offer sang bản nháp mới hoặc sang sản phẩm khác (khóa gom có
  thể sai — vd hàng xách tay, phiên bản khác vùng). Nên có nút "đánh dấu khác sản phẩm" để không bị gom lại
- [ ] **P0** [RPC] Hàng đợi duyệt matching: duyệt / từ chối / gán lại offer → variant từ `match_candidates`
- [ ] **P1** [RPC] Gộp sản phẩm: gộp bản nháp vào sản phẩm verified (hoặc 2 bản nháp khác khóa cùng một món) — chuyển variant,
  offer, Watch, lịch sử giá, Deal Score; ghi nhật ký
- [ ] **P1** [DB] Thêm / sửa sản phẩm và variant thủ công; sửa `products.gtin` (giúp matching v1 ghép chắc chắn)
- [ ] **P2** [DB] Danh sách hãng nhận diện: xem hãng đang dùng để gom (`product_brands()` + `KNOWN_BRANDS`), đề xuất thêm hãng /
  bí danh (hiện phải sửa `src/lib/matching/known-brands.ts` và `aliases.ts`)
- [ ] **P2** [DB] Dashboard chất lượng dữ liệu (G2): `metrics_matching_quality` (offer theo trạng thái match và theo sàn, tỷ lệ
  gợi ý được duyệt), tỷ lệ bản nháp được gom, số bản nháp bị tách sau duyệt (đo độ đúng của `draftKey`)

## Affiliate & doanh thu
- [ ] **P1** [DB] Báo cáo affiliate: doanh thu, tỷ lệ khớp đơn ↔ click (`affiliate_daily`, `affiliate_by_alert`), theo sàn
- [ ] **P1** [DB + API] Trạng thái kéo đơn (`kairo-conversions`): lượt gần nhất, số đơn mới, lỗi; nút nhập CSV (thay `pnpm conversions:import`)
- [ ] **P2** [API] Đánh dấu sàn chưa có link affiliate (TikTok hiện đi link gốc, chưa có hoa hồng)

## Extension
- [ ] **P2** [DB] Theo dõi đóng góp từ extension: số quan sát chờ / đã xác nhận, người góp bất thường

## Kiểm tra một lần trước khi bật dữ liệu thật (không phải tính năng — làm tay trong Studio)
- [ ] Offer Shopee có `external_model_id` khác `default` (`select count(*) from offers o join listings l on l.id = o.listing_id
  where l.marketplace = 'shopee' and o.external_model_id <> 'default';`) — nguồn Affiliate chỉ trả model `default`,
  các offer cũ đó sẽ ngừng nhận giá
- [ ] Production đã có `SHOPEE_AFFILIATE_APP_ID` / `SECRET` chưa (có rồi thì deploy là bật Shopee thật ngay)
- [ ] Đủ secret Vault cho cron: `kairo_app_url`, `kairo_cron_secret`
- [ ] Rà `sourcing_queries` seed (sinh từ tên danh mục): tắt các từ khóa quá chung trước lượt chạy đầu

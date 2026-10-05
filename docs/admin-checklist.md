# ✅ Checklist Admin — Personal Shopping Intelligence

> Tách từ mục **1.8 Admin tối thiểu** của [`feature-checklist.md`](feature-checklist.md) (Giai đoạn 1), cập nhật
> 2026-10-05 sau đợt **nguồn dữ liệu thật** (Shopee/TikTok Affiliate), **tự tìm sản phẩm** và **gom bản nháp**.
> Chưa có trang `/admin` — hiện mọi việc admin làm trong Supabase Studio. Đánh dấu `[x]` khi hoàn thành.
> Thứ tự ưu tiên: **P0** cần ngay khi bật dữ liệu thật · **P1** cần trong vài tuần đầu · **P2** làm sau.

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

## Quyết định cần chốt trước khi làm
- [ ] Ai là admin: `app_metadata.role = 'admin'` (kiểm được cả trong SQL / RLS) hay danh sách `ADMIN_EMAILS` trong env
- [ ] Phạm vi UI: trang `/admin` riêng cho việc hằng ngày (duyệt nháp, hàng đợi), Supabase Studio cho việc hiếm
- [ ] Nhật ký thao tác admin: có lưu ai sửa gì (bảng `admin_audit`) không — cần khi gộp/tách sản phẩm vì không hoàn tác được dễ

## Nền tảng
- [ ] **P0** Chặn quyền: helper `requireAdmin()`; mọi server action / route admin kiểm quyền trước rồi mới dùng client `admin`
- [ ] **P1** Layout `/admin` + trang tổng quan (đếm nhanh: nháp chờ duyệt, gợi ý match chờ, listing lỗi, lượt cron lỗi 24 giờ)

## Kết nối sàn & nguồn dữ liệu
- [ ] **P0** Trạng thái kết nối từng sàn: đã cấu hình chưa (env), thật hay giả lập, lần lấy giá thành công gần nhất
- [ ] **P0** TikTok: hạn access token / refresh token, cảnh báo khi còn < 7 ngày hoặc đã hết, nút "Kết nối lại" (in link
  ủy quyền như `pnpm tiktok:authorize`, thay cho việc phải chạy script)
- [ ] **P1** Chạy thử nguồn ngay trên trang (tương đương `pnpm marketplace:probe`): dán URL / từ khóa → xem dữ liệu gốc và
  dữ liệu sau chuẩn hóa, cảnh báo field trống — để kiểm giả định S1–S3 / T1–T4 khi sàn đổi API

## Sức khỏe pipeline
- [ ] **P0** Dashboard collector: lượt gần nhất, tỷ lệ lỗi theo **từng sàn** (`per_marketplace`), sàn bị dừng (`aborted`),
  `error_summary`
- [ ] **P0** Trạng thái cron: lượt chạy gần nhất + lỗi của từng job `kairo-*` (`cron.job_run_details`), job nào không chạy
  (thiếu secret Vault `kairo_app_url` / `kairo_cron_secret`)
- [ ] **P1** Listing lỗi liên tục: danh sách listing có `last_attempt_at` mới nhưng không có quan sát giá mới (sàn trả "không
  tìm thấy"), thao tác **tắt listing** hàng loạt — Kairo không tự đánh dấu `gone` khi API chỉ báo "không thấy"
- [ ] **P1** Offer stale > 48 giờ theo sàn (giá đang hiện có thể đã cũ)
- [ ] **P1** Cảnh báo cho admin (email) khi: tỷ lệ lỗi collector > 5%, một sàn bị dừng 3 lượt liên tiếp, cron không chạy
  > 2 giờ, token TikTok sắp hết hạn

## Tự tìm sản phẩm (sourcing)
- [ ] **P0** Quản lý `sourcing_queries`: thêm / bật / tắt / sửa từ khóa và danh mục theo sàn, xem `next_page` và lần chạy
  gần nhất, nút "chạy lại từ trang 1"
- [ ] **P0** Từ khóa nhu cầu (`origin = 'demand'`): danh sách theo `request_count`, **tắt từ khóa rác / không phù hợp**
  (bộ lọc chỉ chặn dữ liệu cá nhân, không chặn nội dung lạ), xem từ khóa nào đã ra sản phẩm
- [ ] **P1** Báo cáo `sourcing_runs`: sản phẩm mới mỗi ngày theo sàn, tỷ lệ trùng / lỗi, so với trần `SOURCING_DAILY_CAP` và
  `SOURCING_DEMAND_DAILY_CAP`
- [ ] **P2** Chạy tay một lượt sourcing (tương đương `pnpm sourcing:run`) cho một sàn / chế độ `demand`

## Catalog: bản nháp & matching
- [ ] **P0** Hàng đợi bản nháp: danh sách `draft` sắp theo số nơi bán (bản nháp gom ≥ 2 shop lên trước — đây là bản đang
  hiện trên search), xem các tin bán, khoảng giá, `draft_key`
- [ ] **P0** Duyệt bản nháp → `verified`: đặt tên chuẩn, hãng, model, danh mục, ảnh, thông số; tách thành variant đúng
  (dung lượng / màu / size). Mọi shop đã gom đi theo sản phẩm
- [ ] **P0** **Tách tin bán khỏi bản nháp gom nhầm**: chuyển một offer sang bản nháp mới hoặc sang sản phẩm khác (khóa gom có
  thể sai — vd hàng xách tay, phiên bản khác vùng). Nên có nút "đánh dấu khác sản phẩm" để không bị gom lại
- [ ] **P0** Hàng đợi duyệt matching: duyệt / từ chối / gán lại offer → variant từ `match_candidates`
- [ ] **P1** Gộp sản phẩm: gộp bản nháp vào sản phẩm verified (hoặc 2 bản nháp khác khóa cùng một món) — chuyển variant,
  offer, Watch, lịch sử giá, Deal Score; ghi nhật ký
- [ ] **P1** Thêm / sửa sản phẩm và variant thủ công; sửa `products.gtin` (giúp matching v1 ghép chắc chắn)
- [ ] **P2** Danh sách hãng nhận diện: xem hãng đang dùng để gom (`product_brands()` + `KNOWN_BRANDS`), đề xuất thêm hãng /
  bí danh (hiện phải sửa `src/lib/matching/known-brands.ts` và `aliases.ts`)
- [ ] **P2** Dashboard chất lượng dữ liệu (G2): `metrics_matching_quality` (offer theo trạng thái match và theo sàn, tỷ lệ
  gợi ý được duyệt), tỷ lệ bản nháp được gom, số bản nháp bị tách sau duyệt (đo độ đúng của `draftKey`)

## Affiliate & doanh thu
- [ ] **P1** Báo cáo affiliate: doanh thu, tỷ lệ khớp đơn ↔ click (`affiliate_daily`, `affiliate_by_alert`), theo sàn
- [ ] **P1** Trạng thái kéo đơn (`kairo-conversions`): lượt gần nhất, số đơn mới, lỗi; nút nhập CSV (thay `pnpm conversions:import`)
- [ ] **P2** Đánh dấu sàn chưa có link affiliate (TikTok hiện đi link gốc, chưa có hoa hồng)

## Extension
- [ ] **P2** Theo dõi đóng góp từ extension: số quan sát chờ / đã xác nhận, người góp bất thường

## Kiểm tra một lần trước khi bật dữ liệu thật (không phải tính năng — làm tay trong Studio)
- [ ] Offer Shopee có `external_model_id` khác `default` (`select count(*) from offers o join listings l on l.id = o.listing_id
  where l.marketplace = 'shopee' and o.external_model_id <> 'default';`) — nguồn Affiliate chỉ trả model `default`,
  các offer cũ đó sẽ ngừng nhận giá
- [ ] Production đã có `SHOPEE_AFFILIATE_APP_ID` / `SECRET` chưa (có rồi thì deploy là bật Shopee thật ngay)
- [ ] Đủ secret Vault cho cron: `kairo_app_url`, `kairo_cron_secret`
- [ ] Rà `sourcing_queries` seed (sinh từ tên danh mục): tắt các từ khóa quá chung trước lượt chạy đầu

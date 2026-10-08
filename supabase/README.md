# Supabase

## CLI

CLI được cài sẵn làm **devDependency** của dự án, nên ai clone repo về cũng có
đúng phiên bản. Không cần cài global.

```bash
corepack pnpm exec supabase --version
```

> Máy này chưa có `pnpm` trên PATH nên dùng `corepack pnpm`. Muốn gõ `pnpm`
> trực tiếp thì chạy `corepack enable` một lần.

## Cách 1 — SQL Editor (nhanh nhất, không cần cấu hình gì)

1. Vào Supabase Dashboard → **SQL Editor**.
2. Dán `migrations/0001_init.sql` → **Run**.
3. Lần lượt dán các file còn lại trong `migrations/` theo thứ tự số (`0002`, `0003`, `0004`…) → **Run** từng file.

## Cách 2 — CLI, đẩy lên project trên cloud

```bash
corepack pnpm exec supabase login     # mở trình duyệt, một lần
corepack pnpm db:link                 # hỏi project-ref và mật khẩu database
corepack pnpm db:push                 # đẩy mọi migration chưa áp dụng
```

## Cách 3 — Stack Supabase chạy local

**Cần Docker Desktop.** Máy hiện tại chưa cài, nên cách này chưa dùng được.

Nếu cài Docker rồi thì:

```bash
corepack pnpm exec supabase start     # dựng Postgres + Auth + Storage local
corepack pnpm exec supabase status    # in ra URL, anon key, service_role key
```

Ba giá trị in ra chép thẳng vào `.env.local`. Cách này cho phép chạy migration,
`seed-dev` và toàn bộ test tích hợp mà không cần project trên cloud và không
đụng vào dữ liệu thật.

`corepack pnpm seed:p4` thêm dữ liệu giả cho roadmap P4 (giá theo đơn vị, lịch mùa giá, hồ sơ shop, mẫu voucher, tìm kiếm
đã lưu, chờ sản phẩm, thư mục chia sẻ) — chỉ thêm, không xóa gì, chạy lại được, và từ chối chạy nếu URL không phải local.

## Sinh lại type từ DB

**Bắt buộc sau mỗi lần đổi schema.** `src/lib/database.types.ts` được sinh từ DB
local (đừng sửa tay). Áp migration lên DB local trước (`supabase migration up --local`), rồi:

```bash
corepack pnpm db:types
```

Lệnh dùng cờ `--local`. App `Admin-DealScore` giữ một bản sao y hệt của file này — chép sang
mỗi khi nó đổi.

## Ghi chú schema

- **RLS** bật cho mọi bảng dữ liệu người dùng (`users`, `watches`, `alert_events`,
  `alert_deliveries`, `click_events`, `notification_settings`, `push_subscriptions`,
  `user_preferences`, `watch_folders`, …) và các bảng vận hành / nội bộ (`lookup_requests`,
  `extension_*`, `admin_audit`, …). Catalog & price data đọc công khai; ghi qua
  **service role** (collector/cron) sẽ bỏ qua RLS. `tests/db/privileges.test.ts` (qua
  `privilege_report()`) giữ danh sách bảng `authenticated` được ghi và RPC definer công khai.
- `lookup_requests` bật RLS nhưng **không có policy nào** — chỉ service role
  đọc/ghi được.
- **Quyền bảng** (`0004`): Supabase mặc định cấp ALL trên schema `public` cho
  `anon`/`authenticated`. Không bật RLS **không** có nghĩa là chỉ đọc — `0004`
  thu hồi quyền ghi của hai role này trên mọi bảng catalog và đổi default
  privileges. Bảng thuộc người dùng tạo sau này phải `GRANT` quyền ghi cho
  `authenticated` một cách tường minh, kèm policy RLS.
- Hàm `security definer` mặc định ai cũng gọi được (`EXECUTE` cho `PUBLIC`) —
  luôn `revoke execute … from public, anon, authenticated`.
- Trigger `on_auth_user_created` tự tạo hồ sơ `public.users` khi có
  `auth.users` mới.
- `refresh_variant_daily_prices` ép ngày theo `Asia/Ho_Chi_Minh`. Đừng bỏ mệnh
  đề `at time zone` — biên ngày sẽ trôi theo `TimeZone` của session.
- `price_observations` nên **partition theo tháng** hoặc dùng **TimescaleDB**
  khi dữ liệu lớn (xem chú thích trong migration).

## Triển khai 0022–0028 lên môi trường có dữ liệu thật

Thứ tự chạy (một lần, lúc ít truy cập):

1. **Index không khóa bảng (0027).** `CREATE INDEX CONCURRENTLY` không chạy được trong transaction, nên
   0027 chỉ có đúng một lệnh. Supabase CLI v2.117 không bọc file migration trong transaction — đã kiểm bằng
   `supabase migration up --db-url …` trên một DB nháp. Nếu áp migration bằng cách khác (SQL Editor, công cụ
   bọc `BEGIN/COMMIT`) hoặc `db push` báo *cannot run inside a transaction block*, chạy tay **trước** bước 2,
   trên một kết nối riêng:

       create index concurrently if not exists idx_price_obs_observed_at on public.price_observations (observed_at);

   Build hỏng để lại index `INVALID` mà `if not exists` sẽ bỏ qua — kiểm
   `select indisvalid from pg_index where indexrelid = 'idx_price_obs_observed_at'::regclass;`, nếu `false` thì
   `drop index concurrently idx_price_obs_observed_at;` rồi chạy lại.
2. `corepack pnpm db:push` — áp 0022–0028. Không migration nào xóa hay dựng lại `variant_daily_prices`.
3. **Dựng lại lịch sử theo quy tắc mới** (`offer_in_history()`): `pnpm rollup:rebuild` (cần `.env.local` trỏ vào
   môi trường đó). Mỗi lô 500 variant (`--batch N`) là một transaction riêng: trang / search / alert luôn đọc
   được dòng cũ hoặc dòng mới, không bao giờ rỗng. Dừng giữa chừng thì chạy tiếp bằng `--after <uuid>` in ở
   dòng cuối. Chạy được khi collector đang chạy (khóa dòng theo cùng thứ tự `variant_id, day`); nếu một lô
   báo deadlock / timeout, chạy lại từ `--after` đó.
4. `pnpm scores:recompute` — verdict tính lại trên lịch sử mới.

## Checklist triển khai (ngoài migration)

- `LOOKUP_IP_SALT` **bắt buộc** ở production: thiếu thì throttle đăng nhập vẫn đếm nhưng mỗi lượt gửi
  `reportError` ("Missing LOOKUP_IP_SALT"), còn `/api/extension/observations` trả 500.
- Đăng nhập Google: thử trọn luồng trên một host **https** giống production (không chỉ `next start` http) —
  CSP `form-action` được Chrome áp cho cả chuỗi redirect của form POST.
- HSTS có `includeSubDomains`: xác nhận **mọi** subdomain của domain đã chạy https trước khi bật domain thật.
- Bật lại listing do admin tắt: RPC `admin_set_listings_active(listing_ids, note)` (service role, ghi `admin_audit`).

## Auth production (Dashboard — không nằm trong repo)

- **SMTP:** host `smtp.resend.com`, port `465`, user `resend`, pass = `RESEND_API_KEY`, sender = `EMAIL_FROM`.
- **Site URL** = `NEXT_PUBLIC_SITE_URL`; **Redirect URLs** = `${NEXT_PUBLIC_SITE_URL}/**`.
- **Providers → Email:** bật *Confirm email*; mật khẩu tối thiểu 8 ký tự, yêu cầu *letters and digits*
  (khớp `config.toml` và `src/lib/auth/password.ts`).
- **Template** `Confirm signup` = `supabase/templates/confirm-signup.html` (subject "Xác nhận email DealScore");
  `Reset Password` = `supabase/templates/reset-password.html` (subject "Đặt lại mật khẩu DealScore").
- **Rate limit** gửi email mỗi giờ: đặt theo gói Resend. `max_frequency` = 60 giây.
- **Xác minh domain gửi** trên Resend (SPF, DKIM, DMARC) **trước** khi mở đăng ký.
- Đổi `config.toml` ở local thì phải `supabase stop && supabase start` — Auth chỉ nạp cấu hình lúc khởi động.
- **Test tích hợp** `pnpm test:db` chỉ chạy trên Supabase local (helper tự chặn URL khác).

## Lịch chạy (pg_cron) — mỗi môi trường

Migration 0006 tạo job `dealscore-alerts` (mỗi 15 phút). Job đọc URL và secret từ Vault lúc chạy:

    select vault.create_secret('https://dealscore.vn', 'dealscore_app_url');   -- local: http://host.docker.internal:3000
    select vault.create_secret('<CRON_SECRET>', 'dealscore_cron_secret');  -- trùng env CRON_SECRET của app

Tên job và secret: các migration 0006–0023 tạo job tên `kairo-*` đọc secret `kairo_app_url` / `kairo_cron_secret`;
migration 0029 đổi chúng thành `dealscore-*` (cùng lịch, cùng lệnh) và đổi tên hai secret Vault nếu đã có (giữ nguyên
giá trị). Bên dưới dùng tên sau 0029. Môi trường dựng mới chỉ cần tạo hai secret `dealscore_*` ở trên. Job dọn dữ liệu
vận hành (0023) là `dealscore-retention` (03:23 giờ VN).

Xem lịch sử chạy: `select * from cron.job_run_details order by start_time desc limit 20;`
Ở local không đặt Vault thì dùng `pnpm alerts:run`.

Migration 0007 thêm job `dealscore-conversions` (phút 7, mỗi 6 giờ) — dùng chung hai secret Vault ở trên.
Chưa đặt `SHOPEE_AFFILIATE_APP_ID` / `SHOPEE_AFFILIATE_SECRET` thì route trả `{ skipped: "not_configured" }`.

Migration 0009 thêm hai job, cùng hai secret Vault ở trên:

- `dealscore-collector` (phút 17 mỗi giờ) → `/api/cron/collector`. Mỗi sàn chỉ được làm mới khi có nguồn dữ liệu
  (`configuredMarketplaces()` — Shopee Affiliate API / TikTok Shop API / fake ở dev); chưa sàn nào có thì route trả
  `{ skipped: "not_configured" }` và **không** ghi `collector_runs`. Một sàn sập không chặn sàn khác. Ở local:
  `SHOPEE_CLIENT=fake` rồi `pnpm collector:run`.
- `dealscore-backtest` (03:00 thứ Hai giờ VN) → `/api/cron/backtest`, ghi `backtest_runs`. Chạy tay: `pnpm backtest:run`.
  Xem kết quả: `select ran_at, samples, accuracy, buy_correct, buy_n, wait_correct, wait_n from backtest_runs order by ran_at desc;`

Migration 0017 thêm job `dealscore-sourcing` (02:41 giờ VN mỗi ngày) → `/api/cron/sourcing`, cùng hai secret Vault ở trên:
tự lấy sản phẩm mới cho từng sàn đã cấu hình, có trần mỗi ngày, ghi `sourcing_runs`. Chạy tay: `pnpm sourcing:run`.
Migration 0019 thêm job `dealscore-sourcing-demand` (`11 */3 * * *`) → `/api/cron/sourcing?mode=demand`: chỉ chạy các từ khóa nhu cầu
(`origin = 'demand'`) đang chờ. Chạy tay: `pnpm sourcing:run all demand`.

## Giám sát (1.10)

- **Uptime:** trỏ công cụ ngoài (UptimeRobot / Better Stack, chu kỳ 5 phút) vào `GET /api/health`.
  - HTTP 503 = DB không truy cập được (sự cố).
  - HTTP 200 nhưng body có `"degraded"` = collector đã cấu hình mà lượt gần nhất xong quá 6 giờ → đặt thêm
    **keyword monitor** báo khi body chứa `degraded`.
- **Lỗi:** Sentry, chỉ bật khi có biến môi trường:
  - `SENTRY_DSN` (server/edge) và `NEXT_PUBLIC_SENTRY_DSN` (trình duyệt).
  - Tùy chọn, để upload source map lúc build: `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, `SENTRY_PROJECT`.
  - Lỗi đã bắt trong cron (alerts, collector, backtest) được gửi qua `reportError()` (`src/lib/observability.ts`).

## Backup DB (1.10)

| Lớp | Cách | Giữ |
|---|---|---|
| 1. Supabase | Backup hằng ngày tự động (gói Pro). Bật thêm **PITR** khi có người dùng trả tiền / dữ liệu Watch lớn | 7 ngày (Pro), PITR theo add-on |
| 2. Ngoài Supabase | `pnpm db:backup` (cần `SUPABASE_DB_URL` = connection string Session pooler) → `backups/dealscore-YYYYMMDD-HHmm-{schema,data}.sql`. Chạy **hằng tuần**, chép lên kho lưu trữ khác (vd Google Drive / S3) | 8 bản gần nhất |

Mục tiêu: **RPO ≤ 24 giờ** (lớp 1), **RTO ≤ 4 giờ**. Khôi phục bản ngoài Supabase vào project mới:

    psql "$NEW_DB_URL" -f backups/dealscore-…-schema.sql
    psql "$NEW_DB_URL" -f backups/dealscore-…-data.sql

Lịch sử giá (`price_observations`) là thứ **không lấy lại được** nếu mất — ưu tiên kiểm tra bản backup có nó.
Diễn tập khôi phục vào Supabase local mỗi quý (`supabase start` rồi hai lệnh `psql` ở trên với DB local).

## Google login (Giai đoạn 2)

1. Google Cloud Console → OAuth client (Web). *Authorized redirect URI* = `<SUPABASE_URL>/auth/v1/callback`
   (local: `http://127.0.0.1:54321/auth/v1/callback`).
2. Cloud: Dashboard → Authentication → Providers → Google: dán client id / secret.
   Local: đặt `SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID` / `_SECRET`, sửa `enabled = true` trong `config.toml`,
   `supabase stop && supabase start`.
3. App: `NEXT_PUBLIC_GOOGLE_AUTH=1`. Luồng: `signInWithGoogle` → Google → `/auth/callback` (đổi code lấy phiên)
   → AuthGate như đăng nhập bằng mật khẩu. Email Google trùng email đã đăng ký sẽ được Supabase gộp tài khoản.

## Chrome extension (Giai đoạn 2)

Migration 0013: `extension_observations` (giá thô do người dùng chia sẻ) chỉ vào `price_observations`
(`source='extension'`) khi được xác nhận chéo — xem `src/lib/extension/corroborate.ts`. Đặt `EXTENSION_IDS` ở
production. Hướng dẫn nạp extension: `extension/README.md`.

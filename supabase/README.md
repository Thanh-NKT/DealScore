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

## Sinh lại type từ DB

**Bắt buộc sau mỗi lần đổi schema.** `src/lib/database.types.ts` hiện viết tay
và chưa biết gì về các bảng thêm ở `0002` — `tsc` sẽ đỏ khi chạy `seed-dev`.

```bash
corepack pnpm db:types
```

Lệnh này cần `db:link` chạy trước (nó dùng cờ `--linked`).

## Ghi chú schema

- **RLS** chỉ bật cho dữ liệu người dùng (`users`, `watches`, `alert_events`,
  `click_events`) và bảng vận hành `lookup_requests`. Catalog & price data đọc
  công khai; ghi qua **service role** (collector/cron) sẽ bỏ qua RLS.
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

## Auth production (Dashboard — không nằm trong repo)

- **SMTP:** host `smtp.resend.com`, port `465`, user `resend`, pass = `RESEND_API_KEY`, sender = `EMAIL_FROM`.
- **Site URL** = `NEXT_PUBLIC_SITE_URL`; **Redirect URLs** = `${NEXT_PUBLIC_SITE_URL}/**`.
- **Template** `Magic Link` **và** `Confirm signup` = nội dung `supabase/templates/dang-nhap.html`,
  subject "Đăng nhập Kairo". Người dùng mới nhận template confirm, người cũ nhận magic link.
- **Rate limit** gửi email mỗi giờ: đặt theo gói Resend. `max_frequency` = 60 giây.
- **Xác minh domain gửi** trên Resend (SPF, DKIM, DMARC) **trước** khi mở đăng ký.
- Đổi `config.toml` ở local thì phải `supabase stop && supabase start` — Auth chỉ nạp cấu hình lúc khởi động.
- **Test tích hợp** `pnpm test:db` chỉ chạy trên Supabase local (helper tự chặn URL khác).

## Lịch chạy (pg_cron) — mỗi môi trường

Migration 0006 tạo job `kairo-alerts` (mỗi 15 phút). Job đọc URL và secret từ Vault lúc chạy:

    select vault.create_secret('https://kairo.vn', 'kairo_app_url');   -- local: http://host.docker.internal:3000
    select vault.create_secret('<CRON_SECRET>', 'kairo_cron_secret');  -- trùng env CRON_SECRET của app

Xem lịch sử chạy: `select * from cron.job_run_details order by start_time desc limit 20;`
Ở local không đặt Vault thì dùng `pnpm alerts:run`.

Migration 0007 thêm job `kairo-conversions` (phút 7, mỗi 6 giờ) — dùng chung hai secret Vault ở trên.
Chưa đặt `SHOPEE_AFFILIATE_APP_ID` / `SHOPEE_AFFILIATE_SECRET` thì route trả `{ skipped: "not_configured" }`.

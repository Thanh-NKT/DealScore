# Supabase

## Cách 1 — SQL Editor (nhanh nhất)

1. Vào Supabase Dashboard → **SQL Editor**.
2. Dán toàn bộ `migrations/0001_init.sql` → **Run**.

## Cách 2 — Supabase CLI

```bash
# Cài CLI (một lần)
pnpm add -g supabase

# Đăng nhập & liên kết project
supabase login
supabase link --project-ref <your-project-ref>

# Đẩy migration lên
supabase db push
```

## Sinh lại type từ DB

Sau khi đổi schema, regen `src/lib/database.types.ts` để TypeScript luôn khớp:

```bash
npx supabase gen types typescript \
  --project-id <your-project-ref> \
  --schema public > ../src/lib/database.types.ts
```

## Ghi chú schema

- **RLS** chỉ bật cho dữ liệu người dùng (`users`, `watches`, `alert_events`,
  `click_events`). Catalog & price data đọc công khai; ghi qua **service role**
  (collector/cron) sẽ bỏ qua RLS.
- Trigger `on_auth_user_created` tự tạo hồ sơ `public.users` khi có `auth.users` mới.
- `price_observations` nên **partition theo tháng** hoặc dùng **TimescaleDB** khi
  dữ liệu lớn (xem chú thích trong migration).

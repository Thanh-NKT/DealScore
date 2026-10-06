# DealScore — Personal Shopping Intelligence

> "Đừng chỉ tìm giá rẻ. Tìm đúng thời điểm để mua."

Next.js (App Router, TypeScript, Tailwind v4) + Supabase. Nền tảng theo dõi giá
chuẩn hóa theo variant, chấm **Deal Score** có giải thích, và trả lời
**Nên mua / Có thể chờ / Chưa nên mua**.

## Bắt đầu

> **Package manager: pnpm.** Bật qua corepack (đi kèm Node ≥ 20):
> `corepack enable` — phiên bản pnpm được ghim ở trường `packageManager` trong
> `package.json`. Không dùng `npm install` (dự án chỉ commit `pnpm-lock.yaml`).

1. **Cấu hình Supabase** — tạo project tại [supabase.com](https://supabase.com/dashboard),
   copy các key vào `.env.local`:

   ```bash
   cp .env.local.example .env.local
   # rồi điền NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY,
   # SUPABASE_SERVICE_ROLE_KEY
   ```

2. **Chạy schema** — mở Supabase SQL Editor, dán nội dung
   [`supabase/migrations/0001_init.sql`](supabase/migrations/0001_init.sql) và Run.
   (Hoặc dùng Supabase CLI — xem [`supabase/README.md`](supabase/README.md).)

3. **Dev server**

   ```bash
   pnpm install   # lần đầu: cài dependency (dùng corepack, xem bên dưới)
   pnpm dev
   ```

   Mở http://localhost:3000. Muốn kiểm tra kết nối và migration, chạy `supabase status`
   và `pnpm test:db` (Supabase local).

## Cấu trúc

```
src/
  app/                     App Router
    page.tsx               Landing + demo Deal Score
    layout.tsx
  components/
  lib/
    deal-score.ts          Deal Score v0 + Buy/Wait + Fake Sale (mục C)
    database.types.ts       Kiểu DB (khớp migration; nên regen bằng CLI)
    supabase/
      client.ts            Browser client (anon key + RLS)
      server.ts            Server client (cookies + RLS)
      admin.ts             Service-role client (bỏ qua RLS) — CHỈ ở server
      middleware.ts        Làm mới session
  middleware.ts            Đăng ký session refresh
supabase/
  migrations/0001_init.sql Schema mục D (products → variants → offers → prices …)
```

## Deal Score

Xem [`src/lib/pricing/deal-score.ts`](src/lib/pricing/deal-score.ts). Công thức v0 gồm 3 thành phần
(percentile giá 50% · khoảng cách tới đáy 30% · so sánh giữa offer 20%), ngưỡng
dữ liệu tối thiểu 14 ngày / 10 quan sát, và Fake Sale Detector v0. Thuần hàm →
dễ backtest (mục C5).

## Lộ trình

Bám theo `product_backlog_personal_shopping_intelligence_v2.md`:
Giai đoạn 0 (collector + waitlist) → 1 (MVP Watch & Alert) → 2 (extension, đa sàn)
→ 3 (intelligence) → 4 (kinh doanh hóa).

**Nhắc lại điểm quan trọng nhất:** chạy collector ngay từ tuần đầu — lịch sử giá
đã bỏ lỡ thì không lấy lại được.

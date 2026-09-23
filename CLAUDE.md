# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

## Commands

```bash
pnpm dev         # start dev server (http://localhost:3000)
pnpm build       # production build
pnpm start       # serve the production build
pnpm lint        # eslint (flat config, eslint-config-next)
```

There is **no test runner configured yet**. `src/lib/deal-score.ts` is written as pure
functions specifically so it can be unit-tested / backtested — if you add tests, wire up a
runner (e.g. vitest) first.

Codebase comments and user-facing copy are in **Vietnamese**; match that language when
editing UI text or comments.

## Next.js 16 gotchas

This repo targets Next.js 16 (see `@AGENTS.md` — read `node_modules/next/dist/docs/` before
writing framework code). Two conventions already diverge from older Next.js:

- **Middleware is now `proxy`.** The root file is `src/proxy.ts` and it exports a `proxy()`
  function (not `middleware()`). It delegates to `updateSession` for Supabase session refresh.
- Path alias `@/*` → `./src/*` (tsconfig). Import internal modules as `@/lib/...`.

## Architecture

Next.js App Router + Supabase. The product is a price-tracking / "Deal Score" engine
(Personal Shopping Intelligence). Two mostly independent concerns:

### 1. Supabase access — three clients, chosen by trust boundary

Never mix these up; the choice encodes the security model.

- `src/lib/supabase/client.ts` — **browser** client, anon key + RLS. Client Components only.
- `src/lib/supabase/server.ts` — **server** client, anon key + RLS, reads/writes session via
  cookies. Server Components / Route Handlers / Server Actions.
- `src/lib/supabase/admin.ts` — **service-role** client, **bypasses RLS**. Trusted server code
  only (collector, cron, admin). **Never import into a Client Component.**
  Chỗ được dùng: collector / cron / scripts, `src/lib/ingest.ts`, `src/lib/rate-limit.ts`,
  `src/app/go/…/route.ts`, `src/app/tai-khoan/actions.ts`, `src/app/tai-khoan/xuat-du-lieu/route.ts`,
  `src/lib/account-purge.ts`, `src/lib/alerts/*`, `src/lib/push/index.ts`, `src/app/actions/push.ts`,
  `src/app/api/unsubscribe/route.ts`, `src/app/api/cron/alerts/route.ts`, `scripts/run-alerts.ts`,
  `src/lib/affiliate/import.ts`, `src/app/api/cron/conversions/route.ts`, `scripts/import-conversions.ts`.
  Luôn lấy danh tính bằng `getUser()` trước và lọc theo đúng `user.id` —
  không bao giờ nhận `userId` từ form.
- **Auth:** trang cần đăng nhập gọi `requireUser({ path })` từ `src/lib/auth/session.ts` (không kiểm
  quyền trong `proxy.ts`). Link email dùng luồng `token_hash` qua `src/app/auth/xac-nhan/route.ts`.
- **Watch & Alert (1.3/1.4):** hàm thuần `decideAlert()` (`src/lib/watch/decide.ts`) quyết định có báo
  không; `tests/lib/alerts/scenarios.test.ts` là cam kết "không spam" — đừng sửa kỳ vọng ở đó để test xanh.
  Ngưỡng nằm ở `src/lib/watch/constants.ts` (và `50` trong trigger `watches_enforce_limit`). Truy vấn có thể
  vượt 1.000 dòng phải chia lô — PostgREST cắt âm thầm (xem `src/lib/watch/snapshot.ts`).
- **Affiliate (1.5):** `/go` ghi click rồi redirect link `an_redir` với `sub_id = {clickHex}-{source}`
  (`src/lib/affiliate/link.ts`). Đơn hàng vào `conversions` qua RPC `upsert_conversions` từ API
  (`/api/cron/conversions`) hoặc CSV (`pnpm conversions:import`). Mọi hiểu biết về Shopee Affiliate API là
  **giả định G1–G6** chưa spike — xem `docs/superpowers/specs/2026-09-23-affiliate-design.md` §1.
  Deal Score / search / alert **không** được đọc dữ liệu affiliate (test `no-bias`).
- **Test DB:** `pnpm test:db` chạy `tests/db/**` trên Supabase local (helper tự chặn URL khác). Script
  chạy bằng `tsx` bị biên dịch sang CJS — **không** dùng `await` ở cấp cao nhất, bọc trong `main()`.
- `src/lib/supabase/middleware.ts` — `updateSession()`, called from `src/proxy.ts` on every
  request to refresh the auth token. Do not insert logic between `createServerClient` and the
  `getUser()` call there.

**RLS model** (`supabase/migrations/0001_init.sql`): RLS is enabled **only** on user-owned
tables (`users`, `watches`, `alert_events`, `click_events`). Catalog and price data are
public-read; all writes go through the service-role client, which bypasses RLS. A trigger
(`on_auth_user_created`) auto-creates a `public.users` row for each new `auth.users` record.

### 2. Deal Score engine — `src/lib/deal-score.ts`

Pure, DB-free functions (input = price + observation history, output = score + recommendation).
Keep it that way so it stays backtestable.

- `computeDealScore()` — score 0–100 from three weighted components (price percentile 50% /
  distance to historical low 30% / cross-offer comparison 20%; reweights to 62.5/37.5 when no
  `bestOffer`). Returns `insufficient_data` below the `MIN_DAYS_FOR_SCORE` (14) /
  `MIN_OBSERVATIONS_FOR_SCORE` (10) thresholds. Excludes flash sales and invalid observations.
- `classify()` maps score → `buy` / `wait` / `avoid`.
- `detectFakeSale()` — v0 heuristics for inflated "list price" discounts and pre-sale price hikes.

### Data model

Normalized catalog with a matching layer, feeding a time-series price table:

```
products → product_variants → offers → price_observations   (offers is the unit of price storage)
listings / sellers                       ← offers reference these (marketplace listings)
match_candidates                         ← review queue linking offers to variants
watches → alert_events / click_events    ← user-facing tracking + alerting
```

`src/lib/database.types.ts` is generated from the DB — **regenerate it after any schema change**
(see `supabase/README.md`) rather than hand-editing. `price_observations` is expected to grow
large; the migration notes partitioning / TimescaleDB as future work.

### Environment

Requires `.env.local` with `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, and
`SUPABASE_SERVICE_ROLE_KEY`. The landing page renders a live Supabase connection/schema status
(`src/components/supabase-status.tsx`) — useful for confirming env + migration are in place.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

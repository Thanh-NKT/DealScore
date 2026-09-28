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

Tests use vitest: `pnpm test` (unit, `tests/**` except `tests/db`) and `pnpm test:db` (local
Supabase). `src/lib/pricing/deal-score.ts` is pure so it can be unit-tested / backtested.

**Language:** code comments, identifiers, file/route names, test names and dev-facing
logs/errors are in **English**. User-facing copy (UI text, form errors, Deal Score reasons,
email/push bodies) stays **Vietnamese**. Applied migrations keep their function bodies and
`raise exception` texts as-is — only `--` comments are English.

## Project structure

Strategy from the Next.js docs "Store project files outside of `app`": `src/app/` is for
routing only (`page`, `layout`, `route`, …). Everything else lives outside it:

- `src/actions/` — Server Actions (`auth`, `account`, `watch`, `push`).
- `src/lib/<domain>/` — `account/`, `pricing/` (deal-score, price-history, variant-pricing,
  chart-series), `lookup/`, `product/`, `watch/`, `alerts/`, `affiliate/`, `auth/`, `email/`,
  `push/`, `shopee/`, `supabase/`.
- `src/components/<feature>/` — UI grouped by feature.
- `tests/` mirrors `src/` (`tests/actions`, `tests/lib/<domain>`, `tests/app`, `tests/db`).
- Secret-bearing modules (`lib/supabase/admin.ts`, `lib/email/index.ts`, `lib/push/index.ts`)
  start with `import "server-only"`. Vitest aliases it to an empty stub; tsx scripts that import
  them run with `--conditions=react-server`.
- Routes are English (`/account`, `/login`, `/search`, `/unsubscribe`, `/auth/confirm`). The old
  Vietnamese paths 308-redirect via `LEGACY_ROUTES` in `next.config.ts` — keep them: links in
  already-sent emails depend on them.

## UI / design system

Visual system is `DESIGN.md` ("Bàn giá sáng", normative, tokens in its frontmatter; sidecar
`.impeccable/design.json`). Code checklist for new screens: `.impeccable/ui-conventions.md`.
Tokens live in `src/app/globals.css` (light + dark) — use token classes (`bg-surface`, `text-ink`,
`border-line-strong`, `bg-primary text-on-primary`, …), never hex literals (they break dark mode).
Reuse `VerdictTag` / `ScoreRing` (`src/components/product/verdict-tag.tsx`), `ProductCard`, and the
primitives in `src/components/ui/` (`Button`/`buttonClass`, `SegmentedControl`/`segmentClass`, `pillClass`,
`TextField`/`inputClass`, `Skeleton`). Font sizes and radii are `@theme` tokens (`text-label`, `rounded-tile`…);
ESLint rejects `text-[Npx]`, `rounded-[Npx]`, `rounded-xl` and `font-[family-name:…]`.
Numbers use the `num` utility (Plus Jakarta Sans, tabular), headings `display`; text ≥ 11px (11px only for nano labels). Page frame
`max-w-[1440px] px-4 sm:px-6 lg:px-14`. `UI-mockup/` is the original reference; `docs/design-system/specimen.html`
is the retired "Nhãn giá kệ hàng" world — don't copy it.

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
  only (collector, cron, admin). **Never import into a Client Component** (enforced by
  `server-only`).
  Chỗ được dùng: collector / cron / scripts, `src/lib/ingest.ts`, `src/lib/rate-limit.ts`,
  `src/app/go/…/route.ts`, `src/actions/account.ts`, `src/app/account/export/route.ts`,
  `src/lib/account/purge.ts`, `src/lib/alerts/*`, `src/lib/push/index.ts`, `src/actions/push.ts`,
  `src/app/api/unsubscribe/route.ts`, `src/app/api/cron/alerts/route.ts`, `scripts/run-alerts.ts`,
  `src/lib/affiliate/import.ts`, `src/app/api/cron/conversions/route.ts`, `scripts/import-conversions.ts`,
  `src/lib/collector/run.ts`, `src/lib/pricing/backtest-job.ts`, `src/app/api/cron/{collector,backtest}/route.ts`,
  `scripts/run-{collector,backtest}.ts`, `src/app/api/health/route.ts`, `src/lib/analytics/track.ts`,
  `src/lib/extension/contribute.ts`, `src/app/api/extension/observations/route.ts`,
  `src/lib/listing-extras.ts` + `src/lib/vouchers/store.ts` (`upsertVouchers`, called with the admin client),
  `src/app/api/vouchers/refresh/route.ts`.
  Luôn lấy danh tính bằng `getUser()` trước và lọc theo đúng `user.id` —
  không bao giờ nhận `userId` từ form.
- **Auth:** trang cần đăng nhập gọi `requireUser({ path })` từ `src/lib/auth/session.ts` (không kiểm
  quyền trong `proxy.ts`). Đăng nhập bằng **email + mật khẩu** (`src/actions/auth.ts`, quy tắc mật khẩu ở
  `src/lib/auth/password.ts`, khớp `config.toml`). Link email (xác nhận đăng ký, đặt lại mật khẩu) dùng luồng
  `token_hash` qua `src/app/auth/confirm/route.ts`; `type=recovery` đi thẳng `/reset-password`, bỏ qua AuthGate.
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
- **Matching v0 (1.9):** `src/lib/matching/` chấm offer ↔ variant **verified** (brand + model + dung lượng/màu/size).
  ≥ 0.95 → `ingest_shopee_item` gắn `auto`; thấp hơn → product draft + `match_candidates` (duyệt ở Admin — xem
  `docs/admin-checklist.md`). Giá hiện tại của variant luôn tính lại bằng RPC `refresh_variant_current_price`.
- **Collector (1.10):** `runCollector()` (`src/lib/collector/run.ts`) → `record_observations` → rollup →
  `recomputeDealScores()` → `evaluateWatches()`. Bỏ qua khi `isShopeeConfigured()` sai (chưa có Shopee API).
  Backtest hằng tuần: `src/lib/pricing/backtest.ts` (thuần) → `backtest_runs`. `/api/health` cho uptime; Sentry chỉ
  bật khi có `SENTRY_DSN`; lỗi đã bắt trong cron gửi qua `reportError()`.
- **SEO (1.7):** `src/lib/seo/` (metadata, JSON-LD, sitemap — thuần). Canonical sản phẩm là `/{category}/{slug}`
  không query; draft là `noindex`. Trang danh mục `/{category}` và `/brand/{slug}`.
- **Analytics (1.11):** first-party, bảng `analytics_events` + view `metrics_*`. Chỉ ghi qua `trackAfter()` phía server,
  thuộc tính theo allow-list trong `src/lib/analytics/events.ts` (thêm sự kiện = sửa cả check constraint).
- **Đa sàn (G2):** mọi hiểu biết về URL / nguồn dữ liệu / đích `/go` của từng sàn nằm trong `src/lib/marketplaces/`
  (TikTok Shop, Lazada: giả định, chưa có dữ liệu). So sánh giữa sàn chỉ hiện khi có ≥ 2 sàn thật.
- **Extension (G2):** `extension/` (MV3) chỉ nói chuyện với `/api/extension/*`; các route này chỉ nhận Origin của
  extension (`EXTENSION_IDS`). Giá do extension gửi chỉ vào lịch sử khi `corroborate()` xác nhận chéo.
- `src/lib/supabase/proxy.ts` — `updateSession()`, called from `src/proxy.ts` on every
  request to refresh the auth token. Do not insert logic between `createServerClient` and the
  `getUser()` call there.

**RLS model** (`supabase/migrations/0001_init.sql`): RLS is enabled **only** on user-owned
tables (`users`, `watches`, `alert_events`, `click_events`). Catalog and price data are
public-read; all writes go through the service-role client, which bypasses RLS. A trigger
(`on_auth_user_created`) auto-creates a `public.users` row for each new `auth.users` record.

### 2. Deal Score engine — `src/lib/pricing/deal-score.ts`

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
`SUPABASE_SERVICE_ROLE_KEY`. To confirm env + migrations are in place, run `supabase status` and
`pnpm test:db` (local Supabase).

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

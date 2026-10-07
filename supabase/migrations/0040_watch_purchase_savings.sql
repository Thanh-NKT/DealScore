-- 0040 — Savings report on "Đã mua" (roadmap P2 item B).
--
-- When a watch moves to status 'done' the DB snapshots what the purchase is compared with: the variant's
-- current price (only when in stock and > 0) and the median / day count of the daily low over the 30 VN
-- calendar days before today (today excluded) — the same window as medianWindow(rows, 30, 0) in TS
-- (src/lib/watch/savings.ts mirrors SAVINGS_MEDIAN_WINDOW_DAYS). Moving back out of 'done' clears all four.
-- The numbers are captured once so they never drift with later prices.
--
-- Separate trigger: watches_before_update (0041) is not touched. The columns are in no authenticated grant,
-- so a user can read them (table-level select) but never write them.

alter table public.watches
  add column if not exists purchased_at          timestamptz,
  add column if not exists purchased_price       numeric(14,2),
  add column if not exists purchased_median_30d  numeric(14,2),
  add column if not exists purchased_median_days smallint;

create or replace function public.watches_capture_purchase()
returns trigger language plpgsql set search_path = public as $$
declare
  v_today date := (now() at time zone 'Asia/Ho_Chi_Minh')::date;
begin
  if old.status is distinct from 'done' and new.status = 'done' then
    new.purchased_at := now();
    select vcp.price into new.purchased_price
    from variant_current_price vcp
    where vcp.variant_id = new.variant_id and vcp.in_stock and vcp.price > 0;
    select percentile_cont(0.5) within group (order by d.min_price), count(*)
      into new.purchased_median_30d, new.purchased_median_days
    from variant_daily_prices d
    where d.variant_id = new.variant_id
      and d.min_price > 0
      and d.day >= v_today - 30 and d.day < v_today;
    if new.purchased_median_days = 0 then
      new.purchased_median_30d := null;
    end if;
  elsif old.status = 'done' and new.status is distinct from 'done' then
    new.purchased_at := null;
    new.purchased_price := null;
    new.purchased_median_30d := null;
    new.purchased_median_days := null;
  elsif tg_op = 'UPDATE' then
    -- Engine / any other update never rewrites the snapshot.
    new.purchased_at := old.purchased_at;
    new.purchased_price := old.purchased_price;
    new.purchased_median_30d := old.purchased_median_30d;
    new.purchased_median_days := old.purchased_median_days;
  end if;
  return new;
end $$;

revoke execute on function public.watches_capture_purchase() from public, anon, authenticated;

drop trigger if exists watches_capture_purchase on public.watches;
create trigger watches_capture_purchase before update of status on public.watches
  for each row execute function public.watches_capture_purchase();

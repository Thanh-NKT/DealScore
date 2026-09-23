-- 0007_affiliate.sql: Conversions, đối soát click và view affiliate

drop table if exists public.conversions;

create table public.conversions (
  id              uuid primary key default gen_random_uuid(),
  marketplace     text not null default 'shopee',
  order_id        text not null,
  item_id         text not null,
  model_id        text not null default '',
  click_event_id  uuid references public.click_events(id) on delete set null,
  sub_ids         text[] not null default '{}',
  source_channel  text not null default 'unknown'
                  check (source_channel in ('web','email','push','extension','unknown')),
  purchase_time   timestamptz not null,
  complete_time   timestamptz,
  status          text not null check (status in ('pending','completed','cancelled','unknown')),
  raw_status      text not null,
  item_price      numeric(14,2),
  quantity        integer,
  order_value     numeric(14,2),
  commission      numeric(14,2),
  import_source   text not null check (import_source in ('api','csv')),
  raw             jsonb not null,
  first_seen_at   timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (marketplace, order_id, item_id, model_id)
);

create index if not exists idx_conversions_click on public.conversions (click_event_id);
create index if not exists idx_conversions_purchase on public.conversions (purchase_time desc);

alter table public.conversions enable row level security;
revoke all on public.conversions from anon, authenticated;

create or replace function public.upsert_conversions(p_rows jsonb)
returns table (inserted integer, updated integer, matched integer)
language plpgsql as $$
declare v_ins integer := 0; v_upd integer := 0; v_match integer := 0; r jsonb; v_click uuid; v_new boolean;
begin
  for r in select * from jsonb_array_elements(p_rows) loop
    -- select … into (không STRICT) không thấy dòng nào đã tự đặt v_click = null;
    -- đặt tường minh và bỏ qua truy vấn khi không có click_event_id cho dễ đọc.
    v_click := null;
    if r->>'click_event_id' is not null then
      select id into v_click from click_events where id = (r->>'click_event_id')::uuid;
    end if;

    insert into conversions as c (marketplace, order_id, item_id, model_id, click_event_id, sub_ids,
      source_channel, purchase_time, complete_time, status, raw_status, item_price, quantity,
      order_value, commission, import_source, raw)
    values ('shopee', r->>'order_id', r->>'item_id', coalesce(r->>'model_id', ''), v_click,
      array(select jsonb_array_elements_text(coalesce(r->'sub_ids', '[]'))),
      coalesce(r->>'source_channel', 'unknown'), (r->>'purchase_time')::timestamptz,
      (r->>'complete_time')::timestamptz, r->>'status', r->>'raw_status',
      (r->>'item_price')::numeric, (r->>'quantity')::integer, (r->>'order_value')::numeric,
      (r->>'commission')::numeric, r->>'import_source', r->'raw')
    on conflict (marketplace, order_id, item_id, model_id) do update set
      click_event_id = coalesce(excluded.click_event_id, c.click_event_id),
      sub_ids        = case when cardinality(excluded.sub_ids) > 0 then excluded.sub_ids else c.sub_ids end,
      source_channel = case when excluded.source_channel <> 'unknown' then excluded.source_channel
                            else c.source_channel end,
      complete_time  = coalesce(excluded.complete_time, c.complete_time),
      status = excluded.status, raw_status = excluded.raw_status,
      item_price = excluded.item_price, quantity = excluded.quantity,
      order_value = excluded.order_value, commission = excluded.commission,
      import_source = excluded.import_source, raw = excluded.raw, updated_at = now()
    returning (xmax = 0) into v_new;

    if v_new then v_ins := v_ins + 1; else v_upd := v_upd + 1; end if;
    if v_click is not null then v_match := v_match + 1; end if;
  end loop;
  return query select v_ins, v_upd, v_match;
end $$;

revoke execute on function public.upsert_conversions(jsonb) from public, anon, authenticated;
grant execute on function public.upsert_conversions(jsonb) to service_role;

create or replace view public.affiliate_daily with (security_invoker = true) as
with clicks as (
  select (created_at at time zone 'Asia/Ho_Chi_Minh')::date as day,
         coalesce(source, 'unknown') as channel, count(*) as clicks
  from click_events group by 1, 2
),
conv as (
  select (purchase_time at time zone 'Asia/Ho_Chi_Minh')::date as day,
         source_channel as channel,
         count(distinct order_id) as orders_total,
         count(distinct order_id) filter (where click_event_id is not null) as orders_matched,
         coalesce(sum(order_value) filter (where status = 'completed'), 0) as gmv_completed,
         coalesce(sum(commission)  filter (where status = 'completed'), 0) as commission_completed,
         coalesce(sum(order_value) filter (where status = 'pending'), 0)   as gmv_pending,
         coalesce(sum(commission)  filter (where status = 'pending'), 0)   as commission_pending
  from conversions group by 1, 2
)
select coalesce(k.day, v.day) as day, coalesce(k.channel, v.channel) as channel,
       coalesce(k.clicks, 0) as clicks,
       coalesce(v.orders_total, 0) as orders_total, coalesce(v.orders_matched, 0) as orders_matched,
       case when coalesce(v.orders_total, 0) = 0 then null
            else round(v.orders_matched::numeric / v.orders_total, 4) end as match_rate,
       coalesce(v.gmv_completed, 0) as gmv_completed, coalesce(v.commission_completed, 0) as commission_completed,
       coalesce(v.gmv_pending, 0) as gmv_pending, coalesce(v.commission_pending, 0) as commission_pending
from clicks k full join conv v on v.day = k.day and v.channel = k.channel;

create or replace view public.affiliate_by_alert with (security_invoker = true) as
select ce.alert_event_id,
       count(distinct c.order_id) as orders,
       coalesce(sum(c.commission) filter (where c.status = 'completed'), 0) as commission_completed
from conversions c join click_events ce on ce.id = c.click_event_id
where ce.alert_event_id is not null
group by 1;

revoke all on public.affiliate_daily, public.affiliate_by_alert from anon, authenticated;

-- Kéo conversion mỗi 6 giờ, phút 7 để không trùng lượt alert. Dùng lại secret Vault của 0006.
-- URL và secret đọc từ Vault LÚC CHẠY: mỗi môi trường tự đặt, không nằm trong repo.
-- Thiếu secret → http_post lỗi, job ghi lỗi vào cron.job_run_details, không ảnh hưởng gì khác.
select cron.schedule('kairo-conversions', '7 */6 * * *', $job$
  select net.http_post(
    url     := (select decrypted_secret from vault.decrypted_secrets where name = 'kairo_app_url')
               || '/api/cron/conversions',
    headers := jsonb_build_object(
                 'Content-Type', 'application/json',
                 'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets
                                                where name = 'kairo_cron_secret')),
    body    := '{}'::jsonb,
    timeout_milliseconds := 60000)
$job$);

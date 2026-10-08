-- Final roadmap review Minor 4: alert_click_rate_daily (0006) measures alert → /go click-through. Since 0061,
-- alert_events also holds discovery alerts (saved_search / demand_found), which link to product pages and never
-- to /go, so they lowered the rate for reasons unrelated to alert quality. Same view, same columns, watch alerts
-- only. admin_user_kpis.alerts_sent_7d (0053) deliberately keeps counting every sent notification (Admin /users
-- "Thông báo đã gửi 7 ngày"); see Admin docs/admin-checklist.md.
create or replace view public.alert_click_rate_daily
with (security_invoker = true) as
select (e.created_at at time zone 'Asia/Ho_Chi_Minh')::date as day,
       count(*)                                              as alerts_sent,
       count(*) filter (where exists (select 1 from click_events c
                                      where c.alert_event_id = e.id)) as alerts_clicked
from alert_events e
where e.watch_id is not null
  and exists (select 1 from alert_deliveries d where d.alert_event_id = e.id and d.status = 'sent')
group by 1;
revoke all on public.alert_click_rate_daily from anon, authenticated;

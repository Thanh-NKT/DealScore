-- 0055: an anomaly review that changes an observation also clears that offer's offers.effective_price /
-- _at / _until (review P3 I2). Without it an invalidated drop kept showing as the after-voucher price on
-- search cards, in the effective_asc sort and in alert emails until the collector touched the listing again.
-- Redefined from the 0051 body; only the effective-price block is new. Signature and grants unchanged.

create or replace function public.admin_review_price_anomalies(p_ids uuid[], p_decision text, p_note text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_note    text := nullif(btrim(coalesce(p_note, '')), '');
  v_target  text;
  v_ids     uuid[];
  v_updated integer := 0;
  v_vids    uuid[] := '{}';
  v_now_ok  boolean;
  v_changed integer;
  a         record;
begin
  if p_decision is null or p_decision not in ('invalidate', 'keep', 'reopen') then
    raise exception 'admin_review_price_anomalies: quyết định không hợp lệ';
  end if;
  if p_ids is null or coalesce(cardinality(p_ids), 0) < 1 or cardinality(p_ids) > 100 then
    raise exception 'admin_review_price_anomalies: chọn từ 1 đến 100 giá bất thường';
  end if;
  if v_note is not null and char_length(v_note) > 500 then
    raise exception 'admin_review_price_anomalies: ghi chú dài quá 500 ký tự';
  end if;
  v_target := case p_decision when 'invalidate' then 'invalidated' when 'keep' then 'kept' else 'open' end;
  v_ids := array(select distinct x from unnest(p_ids) x where x is not null);

  -- Locks: anomalies by id, then their observations by id.
  perform 1 from price_anomalies where id = any(v_ids) order by id for update;
  perform 1 from price_observations po
  where (po.id, po.observed_at) in (select pa.observation_id, pa.observed_at from price_anomalies pa where pa.id = any(v_ids))
  order by po.id for update;

  for a in
    select pa.*, po.is_valid as obs_valid, o.variant_id, pv.product_id
    from price_anomalies pa
    join offers o on o.id = pa.offer_id
    left join product_variants pv on pv.id = o.variant_id
    left join price_observations po on po.id = pa.observation_id and po.observed_at = pa.observed_at
    where pa.id = any(v_ids)
    order by pa.id
  loop
    continue when a.status = v_target; -- repeating a decision is a no-op: no write, no audit row

    update price_anomalies
       set status      = v_target,
           reviewed_at = case when v_target = 'open' then null else now() end,
           review_note = coalesce(v_note, review_note)
     where id = a.id;

    if v_target = 'invalidated' then
      update price_observations set is_valid = false, invalid_reason = 'admin_anomaly'
       where id = a.observation_id and observed_at = a.observed_at and is_valid;
    else
      -- Only undo the admin's own invalidation: a 'no_price' observation never becomes valid.
      update price_observations set is_valid = true, invalid_reason = null
       where id = a.observation_id and observed_at = a.observed_at and invalid_reason = 'admin_anomaly';
    end if;
    get diagnostics v_changed = row_count;
    -- 0055: the "price after voucher" cache was computed against the old current price; drop it so search,
    -- the effective_asc sort and alert emails stop using it. The next collector pass recomputes it from the
    -- observations that are valid now (refreshEffectivePrices).
    if v_changed > 0 then
      update offers set effective_price = null, effective_price_at = null, effective_price_until = null
       where id = a.offer_id and (effective_price is not null or effective_price_at is not null
                                  or effective_price_until is not null);
    end if;
    if v_changed > 0 and a.variant_id is not null and not (a.variant_id = any(v_vids)) then
      v_vids := v_vids || a.variant_id;
    end if;
    select po.is_valid into v_now_ok from price_observations po
     where po.id = a.observation_id and po.observed_at = a.observed_at;

    perform admin_log('price_anomaly.' || p_decision, 'price_anomaly', a.id::text,
      jsonb_build_object('status', a.status, 'observation_valid', a.obs_valid, 'offer_id', a.offer_id,
                         'product_id', a.product_id, 'price', a.price, 'kind', a.kind),
      jsonb_build_object('status', v_target, 'observation_valid', v_now_ok, 'offer_id', a.offer_id,
                         'product_id', a.product_id, 'price', a.price, 'kind', a.kind),
      v_note);
    v_updated := v_updated + 1;
  end loop;

  perform admin_rebuild_variant_rollup(v_vids);
  return jsonb_build_object('updated', v_updated, 'skipped', cardinality(v_ids) - v_updated,
                            'variant_ids', to_jsonb(v_vids));
end $$;

revoke execute on function public.admin_review_price_anomalies(uuid[], text, text) from public, anon, authenticated;
grant execute on function public.admin_review_price_anomalies(uuid[], text, text) to service_role;

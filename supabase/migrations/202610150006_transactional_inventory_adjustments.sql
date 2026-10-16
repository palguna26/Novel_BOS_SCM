-- All manual inventory changes use a balanced, immutable stock transaction.

create or replace function inventory.adjust_stock(
  p_company_id uuid,
  p_site_id uuid,
  p_location_id uuid,
  p_item_id uuid,
  p_uom_id uuid,
  p_delta numeric,
  p_reason text,
  p_actor_id uuid,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, inventory, master_data, platform, iam
as $$
declare
  v_target master_data.locations%rowtype;
  v_counterparty master_data.locations%rowtype;
  v_item master_data.items%rowtype;
  v_uom uuid;
  v_transaction_id uuid;
  v_existing jsonb;
  v_amount numeric;
  v_result jsonb;
  v_counterparty_type text;
  v_counterparty_code text;
begin
  if not iam.actor_can_write(p_actor_id, p_company_id) then
    raise exception 'Actor cannot adjust stock for this company';
  end if;
  if coalesce(p_delta, 0) = 0 then raise exception 'Adjustment quantity cannot be zero'; end if;
  if nullif(trim(coalesce(p_reason, '')), '') is null then raise exception 'A reason is required for every stock adjustment'; end if;

  select * into v_target
  from master_data.locations
  where company_id = p_company_id and site_id = p_site_id
    and (p_location_id is null or id = p_location_id)
    and location_type not in ('EXTERNAL_SOURCE','EXTERNAL_SINK','CUSTOMER','TRANSIT')
    and active
  order by created_at
  limit 1;
  if not found then raise exception 'An active internal stock location is required'; end if;

  select * into v_item from master_data.items where id = p_item_id and company_id = p_company_id;
  if not found then raise exception 'Item not found'; end if;
  v_uom := coalesce(p_uom_id, v_item.base_uom_id);
  if not exists (select 1 from master_data.uoms where id = v_uom and active) then
    raise exception 'Active UOM not found';
  end if;

  v_existing := platform.claim_idempotency(p_company_id, 'ADJUST_STOCK', p_idempotency_key);
  if v_existing is not null then return v_existing; end if;

  v_amount := abs(p_delta);
  v_counterparty_type := case when p_delta > 0 then 'EXTERNAL_SOURCE' else 'EXTERNAL_SINK' end;
  v_counterparty_code := case when p_delta > 0 then 'ADJUSTMENT-SOURCE' else 'ADJUSTMENT-SINK' end;
  select * into v_counterparty
  from master_data.locations
  where company_id = p_company_id and site_id = p_site_id
    and location_type = v_counterparty_type and active
  order by created_at
  limit 1;
  if not found then
    insert into master_data.locations(company_id, site_id, code, name, location_type, virtual)
    values (p_company_id, p_site_id, v_counterparty_code,
      case when p_delta > 0 then 'Inventory adjustment source' else 'Inventory adjustment sink' end,
      v_counterparty_type, true)
    on conflict (site_id, code) do update set active = true
    returning * into v_counterparty;
  end if;

  insert into inventory.stock_transactions(
    company_id, transaction_type, document_type, document_id, reason, idempotency_key, posted_by
  ) values (
    p_company_id, 'ADJUSTMENT', 'INVENTORY_ADJUSTMENT', gen_random_uuid(), trim(p_reason), p_idempotency_key, p_actor_id
  ) returning id into v_transaction_id;

  if p_delta > 0 then
    insert into inventory.stock_ledger_entries(
      company_id, stock_transaction_id, line_number, site_id, location_id,
      item_id, stock_state, uom_id, quantity_delta
    ) values
      (p_company_id, v_transaction_id, 1, v_counterparty.site_id, v_counterparty.id, p_item_id, 'RELEASED', v_uom, -v_amount),
      (p_company_id, v_transaction_id, 2, v_target.site_id, v_target.id, p_item_id, 'RELEASED', v_uom, v_amount);
  else
    insert into inventory.stock_ledger_entries(
      company_id, stock_transaction_id, line_number, site_id, location_id,
      item_id, stock_state, uom_id, quantity_delta
    ) values
      (p_company_id, v_transaction_id, 1, v_target.site_id, v_target.id, p_item_id, 'RELEASED', v_uom, -v_amount),
      (p_company_id, v_transaction_id, 2, v_counterparty.site_id, v_counterparty.id, p_item_id, 'RELEASED', v_uom, v_amount);
  end if;

  v_result := jsonb_build_object(
    'transactionId', v_transaction_id,
    'delta', p_delta,
    'quantity', v_amount,
    'locationId', v_target.id,
    'transactionType', 'ADJUSTMENT'
  );
  perform platform.write_audit(p_company_id, p_actor_id, 'STOCK_ADJUSTED', 'STOCK_TRANSACTION', v_transaction_id, null, v_result, p_reason);
  perform platform.finish_idempotency(p_company_id, 'ADJUST_STOCK', p_idempotency_key, v_result);
  return v_result;
end;
$$;

revoke all on function inventory.adjust_stock(uuid,uuid,uuid,uuid,uuid,numeric,text,uuid,text) from public, anon;
grant execute on function inventory.adjust_stock(uuid,uuid,uuid,uuid,uuid,numeric,text,uuid,text) to authenticated, service_role;

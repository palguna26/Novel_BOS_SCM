-- Keep prior PO lines for reservation and audit history when a PO is corrected.
alter table scm.purchase_order_lines add column if not exists active boolean not null default true;

create index if not exists purchase_order_lines_current_idx
  on scm.purchase_order_lines(purchase_order_id, line_number) where active;

create or replace function scm.update_purchase_order(
  p_purchase_order_id uuid,
  p_payload jsonb,
  p_actor_id uuid,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, scm, inventory, master_data, platform, iam
as $$
declare
  v_po scm.purchase_orders%rowtype;
  v_old jsonb;
  v_result jsonb;
  v_existing jsonb;
  v_reservation inventory.reservations%rowtype;
  v_reversal_id uuid;
  v_entry record;
  v_shipment record;
  v_appointment record;
  v_line jsonb;
  v_item master_data.items%rowtype;
  v_line_number integer;
  v_source_site_id uuid;
  v_source_location_id uuid;
  v_lines_changed boolean := p_payload ? 'lines';
  v_source_changed boolean;
  v_route_changed boolean;
  v_destination text;
begin
  select * into v_po from scm.purchase_orders
  where id = p_purchase_order_id for update;
  if not found then raise exception 'Purchase order not found'; end if;
  if not iam.actor_can_write(p_actor_id, v_po.company_id) then
    raise exception 'Actor cannot edit this purchase order';
  end if;
  select result into v_existing from platform.idempotency_keys
  where company_id = v_po.company_id and operation = 'UPDATE_PURCHASE_ORDER'
    and idempotency_key = p_idempotency_key;
  if found and v_existing is not null then return v_existing; end if;
  if p_payload ? 'expectedUpdatedAt'
    and v_po.updated_at is distinct from (p_payload->>'expectedUpdatedAt')::timestamptz then
    raise exception 'This PO changed since it was opened. Refresh and try again';
  end if;
  if v_po.status in ('REJECTED','CANCELLED','CLOSED','INVOICE_UPLOADED') then
    raise exception 'Closed, invoiced, cancelled or rejected purchase orders cannot be edited';
  end if;

  v_destination := trim(coalesce(p_payload->>'destination', v_po.destination_key));
  if nullif(trim(coalesce(p_payload->>'externalId', v_po.external_id)), '') is null
    or nullif(v_destination, '') is null then
    raise exception 'PO ID and destination are required';
  end if;
  if p_payload ? 'platformId'
    and nullif(p_payload->>'platformId', '')::uuid is distinct from v_po.channel_id
    and not exists (
    select 1 from master_data.channels where id = nullif(p_payload->>'platformId', '')::uuid
      and company_id = v_po.company_id and active
  ) then raise exception 'Selected platform is invalid or inactive'; end if;
  v_source_site_id := case when p_payload ? 'sourceWarehouseId'
    then nullif(p_payload->>'sourceWarehouseId', '')::uuid else v_po.source_site_id end;
  v_source_location_id := case when p_payload ? 'sourceLocationId'
    then nullif(p_payload->>'sourceLocationId', '')::uuid else v_po.source_location_id end;
  if v_source_site_id is null and v_source_location_id is not null then
    raise exception 'Select a source warehouse for the stock location';
  end if;
  if v_source_site_id is not null then
    if v_source_site_id is distinct from v_po.source_site_id and not exists (select 1 from master_data.sites where id = v_source_site_id
      and company_id = v_po.company_id and site_type = 'WAREHOUSE' and active) then
      raise exception 'Selected source warehouse is invalid or inactive';
    end if;
    if v_source_location_id is null then
      select id into v_source_location_id from master_data.locations
      where company_id = v_po.company_id and site_id = v_source_site_id
        and location_type = 'WAREHOUSE' and active and not virtual
      order by created_at limit 1;
    end if;
    if v_source_location_id is null or not exists (
      select 1 from master_data.locations where id = v_source_location_id
        and company_id = v_po.company_id and site_id = v_source_site_id
        and (active or id = v_po.source_location_id) and not virtual
    ) then raise exception 'Selected warehouse needs an active stock location'; end if;
  end if;
  v_source_changed := v_source_site_id is distinct from v_po.source_site_id
    or v_source_location_id is distinct from v_po.source_location_id;
  v_route_changed := v_source_changed or v_destination is distinct from v_po.destination_key
    or (p_payload ? 'platformId' and nullif(p_payload->>'platformId', '')::uuid is distinct from v_po.channel_id)
    or (p_payload ? 'destinationAddress' and nullif(p_payload->>'destinationAddress', '') is distinct from v_po.destination_address)
    or (p_payload ? 'sourceAddress' and nullif(p_payload->>'sourceAddress', '') is distinct from v_po.source_address)
    or (p_payload ? 'destinationName' and nullif(p_payload->>'destinationName', '') is distinct from v_po.destination_name)
    or (p_payload ? 'destinationCity' and nullif(p_payload->>'destinationCity', '') is distinct from v_po.destination_city)
    or (p_payload ? 'destinationState' and nullif(p_payload->>'destinationState', '') is distinct from v_po.destination_state)
    or (p_payload ? 'destinationPostalCode' and nullif(p_payload->>'destinationPostalCode', '') is distinct from v_po.destination_postal_code)
    or (p_payload ? 'sourceCity' and nullif(p_payload->>'sourceCity', '') is distinct from v_po.source_city)
    or (p_payload ? 'sourceState' and nullif(p_payload->>'sourceState', '') is distinct from v_po.source_state)
    or (p_payload ? 'sourcePostalCode' and nullif(p_payload->>'sourcePostalCode', '') is distinct from v_po.source_postal_code);
  if exists (
    select 1 from scm.shipments where purchase_order_id = p_purchase_order_id
      and status not in ('PLANNED','VEHICLE_ASSIGNED','LOADING','CANCELLED')
  ) then raise exception 'PO corrections are available only before shipment dispatch'; end if;
  if (v_lines_changed or v_source_changed) and v_po.status = 'SHORT_CLOSED' then
    raise exception 'SKU lines and source warehouse cannot change after short close';
  end if;
  if v_lines_changed and (jsonb_typeof(p_payload->'lines') <> 'array'
    or jsonb_array_length(p_payload->'lines') = 0) then
    raise exception 'The PO needs at least one SKU line';
  end if;
  if v_source_site_id is null and exists (
    select 1 from scm.acceptance_decisions where purchase_order_id = p_purchase_order_id
      and decision = 'ACCEPTED' and active
  ) then raise exception 'An accepted PO needs a source warehouse'; end if;

  v_old := jsonb_build_object('po', to_jsonb(v_po), 'lines',
    (select coalesce(jsonb_agg(to_jsonb(pol) order by line_number), '[]'::jsonb)
     from scm.purchase_order_lines pol where pol.purchase_order_id = p_purchase_order_id and pol.active));
  v_existing := platform.claim_idempotency(v_po.company_id, 'UPDATE_PURCHASE_ORDER', p_idempotency_key);
  if v_existing is not null then return v_existing; end if;

  if v_lines_changed or v_route_changed then
    for v_shipment in select id, status from scm.shipments
      where purchase_order_id = p_purchase_order_id
        and status in ('PLANNED','VEHICLE_ASSIGNED','LOADING') for update loop
      update scm.shipments set status = 'CANCELLED' where id = v_shipment.id;
      perform platform.write_audit(v_po.company_id, p_actor_id, 'SHIPMENT_CANCELLED_FOR_PO_CORRECTION',
        'SCM_SHIPMENT', v_shipment.id, to_jsonb(v_shipment),
        jsonb_build_object('status', 'CANCELLED'));
    end loop;
  end if;

  if v_route_changed then
    for v_appointment in select id, status, match_status from scm.appointments
      where purchase_order_id = p_purchase_order_id and active
        and match_status <> 'MISMATCHED' for update loop
      update scm.appointments set status = 'MISMATCHED', match_status = 'MISMATCHED'
      where id = v_appointment.id;
      perform platform.write_audit(v_po.company_id, p_actor_id, 'APPOINTMENT_REVIEW_REQUIRED_FOR_PO_CORRECTION',
        'SCM_APPOINTMENT', v_appointment.id, to_jsonb(v_appointment),
        jsonb_build_object('status', 'MISMATCHED', 'match_status', 'MISMATCHED'));
    end loop;
  end if;

  select * into v_reservation from inventory.reservations
  where purchase_order_id = p_purchase_order_id and status = 'ACTIVE' for update;
  if v_reservation.id is not null and (v_lines_changed or v_route_changed) then
    if v_reservation.stock_transaction_id is null then
      raise exception 'Active reservation has no stock transaction';
    end if;
    if exists (select 1 from inventory.stock_transactions
      where reverses_transaction_id = v_reservation.stock_transaction_id) then
      raise exception 'Reservation stock has already been reversed';
    end if;
    insert into inventory.stock_transactions(
      company_id, transaction_type, document_type, document_id, document_number,
      reverses_transaction_id, reason, idempotency_key, posted_by
    ) values (
      v_po.company_id, 'REVERSAL', 'SCM_RESERVATION', v_reservation.id,
      v_po.external_id, v_reservation.stock_transaction_id,
      coalesce(nullif(p_payload->>'reason', ''), 'PO correction'), p_idempotency_key || ':reverse', p_actor_id
    ) returning id into v_reversal_id;
    for v_entry in select * from inventory.stock_ledger_entries
      where stock_transaction_id = v_reservation.stock_transaction_id order by line_number loop
      insert into inventory.stock_ledger_entries(
        company_id, stock_transaction_id, line_number, site_id, location_id,
        item_id, batch_id, stock_state, uom_id, quantity_delta, unit_value, value_delta
      ) values (
        v_entry.company_id, v_reversal_id, v_entry.line_number, v_entry.site_id,
        v_entry.location_id, v_entry.item_id, v_entry.batch_id, v_entry.stock_state,
        v_entry.uom_id, -v_entry.quantity_delta, v_entry.unit_value, -v_entry.value_delta
      );
    end loop;
    update inventory.reservations set status = 'SUPERSEDED' where id = v_reservation.id;
  end if;

  update scm.purchase_orders set
    channel_id = coalesce(nullif(p_payload->>'platformId', '')::uuid, channel_id),
    external_id = coalesce(nullif(trim(p_payload->>'externalId'), ''), external_id),
    po_date = coalesce(nullif(p_payload->>'poDate', '')::timestamptz, po_date),
    deadline = case when p_payload ? 'deadline' then nullif(p_payload->>'deadline', '')::timestamptz else deadline end,
    destination_key = v_destination,
    destination_name = coalesce(nullif(p_payload->>'destinationName', ''), nullif(p_payload->>'destinationAddress', ''), v_destination),
    destination_address = case when p_payload ? 'destinationAddress' then nullif(p_payload->>'destinationAddress', '') else destination_address end,
    destination_city = case when p_payload ? 'destinationCity' then nullif(p_payload->>'destinationCity', '') else destination_city end,
    destination_state = case when p_payload ? 'destinationState' then nullif(p_payload->>'destinationState', '') else destination_state end,
    destination_postal_code = case when p_payload ? 'destinationPostalCode' then nullif(p_payload->>'destinationPostalCode', '') else destination_postal_code end,
    customer_name = case when p_payload ? 'customer' then nullif(p_payload->>'customer', '') else customer_name end,
    source_site_id = v_source_site_id,
    source_location_id = v_source_location_id,
    source_address = case when p_payload ? 'sourceAddress' then nullif(p_payload->>'sourceAddress', '') else source_address end,
    source_city = case when p_payload ? 'sourceCity' then nullif(p_payload->>'sourceCity', '') else source_city end,
    source_state = case when p_payload ? 'sourceState' then nullif(p_payload->>'sourceState', '') else source_state end,
    source_postal_code = case when p_payload ? 'sourcePostalCode' then nullif(p_payload->>'sourcePostalCode', '') else source_postal_code end,
    total_value = coalesce((p_payload->>'totalValue')::numeric, total_value),
    currency = coalesce(nullif(p_payload->>'currency', ''), currency)
  where id = p_purchase_order_id;

  if v_lines_changed then
    update scm.purchase_order_lines set active = false
    where purchase_order_id = p_purchase_order_id and active;
    select coalesce(max(line_number), 0) into v_line_number
    from scm.purchase_order_lines where purchase_order_id = p_purchase_order_id;
    for v_line in select value from jsonb_array_elements(p_payload->'lines') loop
      v_line_number := v_line_number + 1;
      select * into v_item from master_data.items where id = nullif(v_line->>'itemId', '')::uuid
        and company_id = v_po.company_id and lifecycle_status = 'ACTIVE';
      if not found then raise exception 'PO line % has an invalid or inactive SKU', v_line_number; end if;
      if coalesce((v_line->>'ordered')::numeric, 0) <= 0
        or coalesce((v_line->>'unitPrice')::numeric, 0) < 0 then
        raise exception 'PO line % needs a positive quantity and nonnegative price', v_line_number;
      end if;
      insert into scm.purchase_order_lines(
        company_id, purchase_order_id, line_number, item_id, channel_item_code,
        description, ordered_quantity, uom_id, unit_price, tax_rate,
        delivery_window_start, delivery_window_end, minimum_residual_shelf_life_days
      ) values (
        v_po.company_id, p_purchase_order_id, v_line_number, v_item.id,
        nullif(v_line->>'channelItemCode', ''), nullif(v_line->>'description', ''),
        (v_line->>'ordered')::numeric, coalesce(nullif(v_line->>'uomId', '')::uuid, v_item.base_uom_id),
        coalesce((v_line->>'unitPrice')::numeric, 0),
        coalesce((v_line->>'taxRate')::numeric, 0),
        nullif(v_line->>'deliveryWindowStart', '')::timestamptz,
        nullif(v_line->>'deliveryWindowEnd', '')::timestamptz,
        coalesce((v_line->>'minimumResidualShelfLifeDays')::integer, 0)
      );
    end loop;
  end if;

  if v_lines_changed or v_route_changed then
    perform scm.try_create_reservation(p_purchase_order_id, p_actor_id,
      p_idempotency_key || ':reserve');
  end if;
  perform scm.refresh_po_status(p_purchase_order_id);
  select jsonb_build_object('po', to_jsonb(po), 'lines',
    (select coalesce(jsonb_agg(to_jsonb(pol) order by line_number), '[]'::jsonb)
     from scm.purchase_order_lines pol where pol.purchase_order_id = p_purchase_order_id and pol.active))
  into v_result from scm.purchase_orders po where po.id = p_purchase_order_id;
  perform platform.write_audit(v_po.company_id, p_actor_id, 'PO_UPDATED',
    'SCM_PURCHASE_ORDER', p_purchase_order_id, v_old, v_result,
    nullif(p_payload->>'reason', ''));
  perform platform.finish_idempotency(v_po.company_id, 'UPDATE_PURCHASE_ORDER', p_idempotency_key, v_result);
  return v_result;
end;
$$;

revoke all on function scm.update_purchase_order(uuid,jsonb,uuid,text) from public, anon, authenticated;
grant execute on function scm.update_purchase_order(uuid,jsonb,uuid,text) to service_role;

create or replace view compat.purchase_order_lines with (security_invoker = true) as
select
  pol.id,
  pol.purchase_order_id as po_id,
  pol.item_id as sku_id,
  pol.ordered_quantity as ordered,
  pol.unit_price,
  coalesce((
    select sum(rl.reserved_quantity)
    from inventory.reservation_lines rl
    join inventory.reservations r on r.id = rl.reservation_id
    where rl.purchase_order_line_id = pol.id
      and r.status in ('ACTIVE','PARTIALLY_DISPATCHED')
  ), 0) as allocated,
  coalesce((
    select sum(sl.delivered_quantity)
    from scm.shipment_lines sl
    join scm.shipments s on s.id = sl.shipment_id
    where sl.purchase_order_line_id = pol.id and s.status <> 'CANCELLED'
  ), 0) as delivered
from scm.purchase_order_lines pol
where pol.active;

-- Existing workflows must use only the current PO lines.
create or replace function scm.refresh_po_status(p_purchase_order_id uuid)
returns text
language plpgsql
security definer
set search_path = pg_catalog, scm, inventory
as $$
declare
  v_po scm.purchase_orders%rowtype;
  v_gate record;
  v_status text;
  v_ordered numeric(18,6);
  v_reserved numeric(18,6);
  v_shortage numeric(18,6);
  v_dispatched numeric(18,6);
  v_delivered numeric(18,6);
  v_open_exceptions integer;
begin
  select * into v_po from scm.purchase_orders where id = p_purchase_order_id for update;
  if not found then raise exception 'Purchase order not found'; end if;

  if v_po.status in ('REJECTED','CANCELLED','ON_HOLD','CLOSED','INVOICE_UPLOADED') then
    return v_po.status;
  end if;

  select * into v_gate from scm.po_gate_state_v where purchase_order_id = p_purchase_order_id;
  select coalesce(sum(ordered_quantity), 0) into v_ordered
  from scm.purchase_order_lines where purchase_order_id = p_purchase_order_id and active;
  select coalesce(sum(rl.reserved_quantity), 0), coalesce(sum(rl.shortage_quantity), 0)
  into v_reserved, v_shortage
  from inventory.reservation_lines rl
  join inventory.reservations r on r.id = rl.reservation_id
  where r.purchase_order_id = p_purchase_order_id
    and r.status in ('ACTIVE','PARTIALLY_DISPATCHED','FULFILLED','RELEASED');
  select coalesce(sum(sl.dispatched_quantity), 0), coalesce(sum(sl.delivered_quantity), 0)
  into v_dispatched, v_delivered
  from scm.shipment_lines sl
  join scm.shipments s on s.id = sl.shipment_id
  where s.purchase_order_id = p_purchase_order_id and s.status <> 'CANCELLED';
  select count(*) into v_open_exceptions
  from scm.delivery_exceptions
  where purchase_order_id = p_purchase_order_id and status in ('OPEN','INVESTIGATING');

  if exists (select 1 from scm.short_close_decisions where purchase_order_id = p_purchase_order_id and status = 'APPROVED') then
    v_status := 'SHORT_CLOSED';
  elsif v_open_exceptions > 0 then
    v_status := 'DELIVERY_ISSUE';
  elsif v_ordered > 0 and v_delivered >= v_ordered then
    v_status := 'FULLY_DELIVERED';
  elsif v_delivered > 0 then
    v_status := 'PARTIALLY_DELIVERED';
  elsif v_reserved > 0 and v_dispatched >= v_reserved then
    v_status := 'FULLY_DISPATCHED';
  elsif v_dispatched > 0 then
    v_status := 'PARTIALLY_DISPATCHED';
  elsif exists (select 1 from inventory.reservations where purchase_order_id = p_purchase_order_id) then
    v_status := case when v_shortage > 0 then 'INVENTORY_SHORTAGE' else 'SHIPMENT_PLANNING' end;
  elsif v_gate.ready_for_reservation then
    v_status := 'READY_FOR_RESERVATION';
  elsif v_gate.acceptance_complete then
    v_status := 'ACCEPTED_AWAITING_APPOINTMENT';
  elsif v_gate.appointment_complete then
    v_status := 'APPOINTMENT_MATCHED_AWAITING_ACCEPTANCE';
  else
    v_status := 'ACCEPTANCE_PENDING';
  end if;

  if v_status is distinct from v_po.status then
    update scm.purchase_orders set status = v_status where id = p_purchase_order_id;
    insert into workflow.status_history(company_id, entity_type, entity_id, from_status, to_status)
    values (v_po.company_id, 'SCM_PURCHASE_ORDER', p_purchase_order_id, v_po.status, v_status);
  end if;
  return v_status;
end;
$$;

create or replace function scm.try_create_reservation(
  p_purchase_order_id uuid,
  p_actor_id uuid,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, scm, inventory, master_data, platform, iam
as $$
declare
  v_po scm.purchase_orders%rowtype;
  v_gate record;
  v_existing jsonb;
  v_reservation_id uuid;
  v_transaction_id uuid;
  v_reservation_line_id uuid;
  v_line record;
  v_stock record;
  v_required numeric(18,6);
  v_released numeric(18,6);
  v_threshold numeric(18,6);
  v_target numeric(18,6);
  v_remaining numeric(18,6);
  v_take numeric(18,6);
  v_line_number integer := 0;
  v_version integer;
  v_effective_key text;
  v_result jsonb;
begin
  select * into v_po from scm.purchase_orders where id = p_purchase_order_id for update;
  if not found then raise exception 'Purchase order not found'; end if;
  if not iam.actor_can_write(p_actor_id, v_po.company_id) then raise exception 'Actor cannot reserve stock for this company'; end if;
  -- The old automatic key may belong to a superseded reservation after a PO correction.
  select coalesce(max(version), 0) + 1 into v_version
  from inventory.reservations where purchase_order_id = p_purchase_order_id;
  v_effective_key := case when p_idempotency_key like 'AUTO-RESERVE:%'
    then p_idempotency_key || ':v' || v_version::text else p_idempotency_key end;

  select result into v_existing from platform.idempotency_keys
  where company_id = v_po.company_id and operation = 'CREATE_RESERVATION' and idempotency_key = v_effective_key;
  if found and v_existing is not null then return v_existing; end if;

  select to_jsonb(r) into v_existing
  from inventory.reservations r
  where r.purchase_order_id = p_purchase_order_id
    and r.status in ('ACTIVE','PARTIALLY_DISPATCHED');
  if v_existing is not null then return v_existing; end if;

  select * into v_gate from scm.po_gate_state_v where purchase_order_id = p_purchase_order_id;
  if not coalesce(v_gate.ready_for_reservation, false) then
    perform scm.refresh_po_status(p_purchase_order_id);
    return null;
  end if;
  if v_po.source_site_id is null or v_po.source_location_id is null then
    raise exception 'Source warehouse mapping is required';
  end if;
  if not exists (select 1 from scm.purchase_order_lines where purchase_order_id = p_purchase_order_id and active) then
    raise exception 'Purchase order has no lines';
  end if;

  v_existing := platform.claim_idempotency(v_po.company_id, 'CREATE_RESERVATION', v_effective_key);
  if v_existing is not null then return v_existing; end if;

  select coalesce(max(version), 0) + 1 into v_version
  from inventory.reservations where purchase_order_id = p_purchase_order_id;

  insert into inventory.reservations(
    company_id, purchase_order_id, version, source_site_id, source_location_id,
    idempotency_key, created_by
  ) values (
    v_po.company_id, p_purchase_order_id, v_version, v_po.source_site_id,
    v_po.source_location_id, v_effective_key, p_actor_id
  ) returning id into v_reservation_id;

  insert into inventory.stock_transactions(
    company_id, transaction_type, document_type, document_id, document_number,
    idempotency_key, posted_by
  ) values (
    v_po.company_id, 'RESERVE', 'SCM_RESERVATION', v_reservation_id,
    v_po.external_id, v_effective_key || ':ledger', p_actor_id
  ) returning id into v_transaction_id;

  for v_line in
    select pol.*, i.batch_controlled
    from scm.purchase_order_lines pol
    join master_data.items i on i.id = pol.item_id
    where pol.purchase_order_id = p_purchase_order_id and pol.active
    order by pol.line_number
  loop
    v_required := v_line.ordered_quantity;
    select coalesce(s.released, 0), coalesce(s.threshold, 0)
    into v_released, v_threshold
    from inventory.inventory_summary_v s
    where s.company_id = v_po.company_id
      and s.site_id = v_po.source_site_id
      and s.item_id = v_line.item_id
      and s.uom_id = v_line.uom_id;
    if not found then v_released := 0; v_threshold := 0; end if;
    v_target := least(v_required, greatest(v_released - v_threshold, 0));

    insert into inventory.reservation_lines(
      company_id, reservation_id, purchase_order_line_id, required_quantity,
      reserved_quantity, uom_id
    ) values (
      v_po.company_id, v_reservation_id, v_line.id, v_required, 0, v_line.uom_id
    ) returning id into v_reservation_line_id;

    v_remaining := v_target;
    for v_stock in
      select b.location_id, b.batch_id, b.quantity, bt.expiry_date
      from inventory.stock_balance_v b
      join master_data.locations loc on loc.id = b.location_id
      left join inventory.batches bt on bt.id = b.batch_id
      where b.company_id = v_po.company_id
        and b.site_id = v_po.source_site_id
        and b.item_id = v_line.item_id
        and b.uom_id = v_line.uom_id
        and b.stock_state = 'RELEASED'
        and b.quantity > 0
        and loc.location_type not in ('TRANSIT','CUSTOMER','EXTERNAL_SOURCE','EXTERNAL_SINK')
        and (bt.expiry_date is null or bt.expiry_date >= current_date + v_line.minimum_residual_shelf_life_days)
      order by bt.expiry_date nulls last, bt.manufacturing_date nulls last, b.location_id
    loop
      exit when v_remaining <= 0;
      v_take := least(v_remaining, v_stock.quantity);
      insert into inventory.reservation_allocations(
        company_id, reservation_line_id, batch_id, location_id, quantity
      ) values (
        v_po.company_id, v_reservation_line_id, v_stock.batch_id, v_stock.location_id, v_take
      );
      v_line_number := v_line_number + 1;
      insert into inventory.stock_ledger_entries(
        company_id, stock_transaction_id, line_number, site_id, location_id,
        item_id, batch_id, stock_state, uom_id, quantity_delta
      ) values (
        v_po.company_id, v_transaction_id, v_line_number, v_po.source_site_id,
        v_stock.location_id, v_line.item_id, v_stock.batch_id, 'RELEASED', v_line.uom_id, -v_take
      );
      v_line_number := v_line_number + 1;
      insert into inventory.stock_ledger_entries(
        company_id, stock_transaction_id, line_number, site_id, location_id,
        item_id, batch_id, stock_state, uom_id, quantity_delta
      ) values (
        v_po.company_id, v_transaction_id, v_line_number, v_po.source_site_id,
        v_stock.location_id, v_line.item_id, v_stock.batch_id, 'RESERVED', v_line.uom_id, v_take
      );
      v_remaining := v_remaining - v_take;
    end loop;

    update inventory.reservation_lines
    set reserved_quantity = v_target - v_remaining
    where id = v_reservation_line_id;
  end loop;

  update inventory.reservations set stock_transaction_id = v_transaction_id where id = v_reservation_id;
  perform scm.refresh_po_status(p_purchase_order_id);
  select to_jsonb(r) into v_result from inventory.reservations r where r.id = v_reservation_id;
  perform platform.write_audit(v_po.company_id, p_actor_id, 'RESERVATION_CREATED', 'SCM_RESERVATION', v_reservation_id, null, v_result);
  perform platform.finish_idempotency(v_po.company_id, 'CREATE_RESERVATION', v_effective_key, v_result);
  return v_result;
end;
$$;

create or replace function scm.short_close_purchase_order(
  p_purchase_order_id uuid,
  p_reason text,
  p_remaining_quantity numeric,
  p_actor_id uuid,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, scm, inventory, master_data, platform, iam
as $$
declare
  v_po scm.purchase_orders%rowtype;
  v_reservation inventory.reservations%rowtype;
  v_allocation record;
  v_actual_remaining numeric(18,6);
  v_release numeric(18,6);
  v_transaction_id uuid;
  v_decision_id uuid;
  v_entry_number integer := 0;
  v_existing jsonb;
  v_result jsonb;
begin
  if nullif(trim(p_reason), '') is null then raise exception 'Short-close reason is required'; end if;
  if p_remaining_quantity is null or p_remaining_quantity <= 0 then raise exception 'Remaining quantity must be positive'; end if;
  select * into v_po from scm.purchase_orders where id = p_purchase_order_id for update;
  if not found then raise exception 'Purchase order not found'; end if;
  if not iam.actor_can_approve(p_actor_id, v_po.company_id) then raise exception 'Manager or administrator approval is required'; end if;

  select result into v_existing from platform.idempotency_keys
  where company_id = v_po.company_id and operation = 'SHORT_CLOSE_PO' and idempotency_key = p_idempotency_key;
  if found and v_existing is not null then return v_existing; end if;
  select
    (select coalesce(sum(pol.ordered_quantity), 0)
     from scm.purchase_order_lines pol
     where pol.purchase_order_id = p_purchase_order_id and pol.active)
    -
    (select coalesce(sum(sl.delivered_quantity), 0)
     from scm.shipment_lines sl
     join scm.shipments s on s.id = sl.shipment_id
     where s.purchase_order_id = p_purchase_order_id and s.status <> 'CANCELLED')
  into v_actual_remaining;
  if abs(v_actual_remaining - p_remaining_quantity) > 0.000001 then
    raise exception 'Remaining quantity changed; expected %, received %', v_actual_remaining, p_remaining_quantity;
  end if;

  v_existing := platform.claim_idempotency(v_po.company_id, 'SHORT_CLOSE_PO', p_idempotency_key);
  if v_existing is not null then return v_existing; end if;
  select * into v_reservation from inventory.reservations
  where purchase_order_id = p_purchase_order_id and status in ('ACTIVE','PARTIALLY_DISPATCHED') for update;

  insert into inventory.stock_transactions(
    company_id, transaction_type, document_type, document_id, document_number,
    idempotency_key, posted_by, reason
  ) values (
    v_po.company_id, 'RELEASE', 'SCM_PURCHASE_ORDER', p_purchase_order_id,
    v_po.external_id, p_idempotency_key || ':ledger', p_actor_id, p_reason
  ) returning id into v_transaction_id;

  if v_reservation.id is not null then
    for v_allocation in
      select ra.*, pol.item_id, rl.uom_id
      from inventory.reservation_allocations ra
      join inventory.reservation_lines rl on rl.id = ra.reservation_line_id
      join scm.purchase_order_lines pol on pol.id = rl.purchase_order_line_id
      where rl.reservation_id = v_reservation.id
        and ra.quantity > ra.dispatched_quantity + ra.released_quantity
      order by ra.id for update of ra
    loop
      v_release := v_allocation.quantity - v_allocation.dispatched_quantity - v_allocation.released_quantity;
      update inventory.reservation_allocations set released_quantity = released_quantity + v_release where id = v_allocation.id;
      v_entry_number := v_entry_number + 1;
      insert into inventory.stock_ledger_entries(
        company_id, stock_transaction_id, line_number, site_id, location_id,
        item_id, batch_id, stock_state, uom_id, quantity_delta
      ) values (
        v_po.company_id, v_transaction_id, v_entry_number, v_reservation.source_site_id,
        v_allocation.location_id, v_allocation.item_id, v_allocation.batch_id,
        'RESERVED', v_allocation.uom_id, -v_release
      );
      v_entry_number := v_entry_number + 1;
      insert into inventory.stock_ledger_entries(
        company_id, stock_transaction_id, line_number, site_id, location_id,
        item_id, batch_id, stock_state, uom_id, quantity_delta
      ) values (
        v_po.company_id, v_transaction_id, v_entry_number, v_reservation.source_site_id,
        v_allocation.location_id, v_allocation.item_id, v_allocation.batch_id,
        'RELEASED', v_allocation.uom_id, v_release
      );
    end loop;
    update inventory.reservations set status = 'RELEASED', released_at = statement_timestamp()
    where id = v_reservation.id;
  end if;

  insert into scm.short_close_decisions(
    company_id, purchase_order_id, reason, remaining_quantity, approved_by,
    release_stock_transaction_id, idempotency_key
  ) values (
    v_po.company_id, p_purchase_order_id, p_reason, p_remaining_quantity, p_actor_id,
    v_transaction_id, p_idempotency_key
  ) returning id into v_decision_id;
  update scm.purchase_orders set status = 'SHORT_CLOSED' where id = p_purchase_order_id;

  select to_jsonb(d) into v_result from scm.short_close_decisions d where d.id = v_decision_id;
  perform platform.write_audit(v_po.company_id, p_actor_id, 'SHORT_CLOSE_APPROVED', 'SCM_PURCHASE_ORDER', p_purchase_order_id, null, v_result, p_reason);
  perform platform.finish_idempotency(v_po.company_id, 'SHORT_CLOSE_PO', p_idempotency_key, v_result);
  return v_result;
end;
$$;


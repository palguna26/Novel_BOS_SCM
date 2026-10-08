-- Keep original addresses for display/audit while routing uses canonical warehouse/city fields.
alter table scm.shipments
  add column if not exists source_address text,
  add column if not exists source_city text,
  add column if not exists source_state text,
  add column if not exists source_postal_code text,
  add column if not exists destination_address text,
  add column if not exists destination_city text,
  add column if not exists destination_state text,
  add column if not exists destination_postal_code text,
  add column if not exists destination_code text;

create or replace function scm.create_shipment(
  p_purchase_order_id uuid,
  p_lines jsonb,
  p_vehicle jsonb,
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
  v_appointment scm.appointments%rowtype;
  v_transit_location master_data.locations%rowtype;
  v_route master_data.routes%rowtype;
  v_line jsonb;
  v_reservation_line inventory.reservation_lines%rowtype;
  v_already_planned numeric(18,6);
  v_planned numeric(18,6);
  v_shipment_id uuid;
  v_number text;
  v_existing jsonb;
  v_result jsonb;
  v_destination_city text;
  v_source_address text;
  v_source_city text;
  v_source_state text;
  v_source_postal_code text;
  v_destination_address text;
  v_destination_state text;
  v_destination_postal_code text;
  v_destination_code text;
begin
  select * into v_po from scm.purchase_orders where id = p_purchase_order_id for update;
  if not found then raise exception 'Purchase order not found'; end if;
  if not iam.actor_can_write(p_actor_id, v_po.company_id) then raise exception 'Actor cannot create a shipment for this company'; end if;

  select result into v_existing from platform.idempotency_keys where company_id = v_po.company_id and operation = 'CREATE_SHIPMENT' and idempotency_key = p_idempotency_key;
  if found and v_existing is not null then return v_existing; end if;
  select * into v_reservation from inventory.reservations where purchase_order_id = p_purchase_order_id and status in ('ACTIVE','PARTIALLY_DISPATCHED') for update;
  if not found then raise exception 'An active reservation is required'; end if;
  select * into v_appointment from scm.appointments where purchase_order_id = p_purchase_order_id and active and match_status in ('MATCHED','WAIVED') and status not in ('CANCELLED','REPLACED');
  if not found then raise exception 'A matched appointment is required'; end if;
  select * into v_transit_location from master_data.locations where company_id = v_po.company_id and location_type = 'TRANSIT' and active order by created_at limit 1;
  if not found then raise exception 'A company transit location is required'; end if;

  v_destination_city := coalesce(nullif(trim(v_po.destination_city), ''), nullif(trim(v_po.destination_key), ''));
  select * into v_route from master_data.routes
  where company_id = v_po.company_id and source_site_id = v_po.source_site_id and active
    and (lower(destination_key) = lower(v_po.destination_key)
      or master_data.normalize_city(coalesce(destination_city, destination_key)) = master_data.normalize_city(v_destination_city))
  order by case when lower(destination_key) = lower(v_po.destination_key) then 0 else 1 end, created_at
  limit 1;

  v_source_address := coalesce(v_appointment.source_address, v_po.source_address);
  v_source_city := coalesce(v_appointment.source_city, v_po.source_city);
  v_source_state := coalesce(v_appointment.source_state, v_po.source_state);
  v_source_postal_code := coalesce(v_appointment.source_postal_code, v_po.source_postal_code);
  v_destination_address := coalesce(v_appointment.destination_address, v_po.destination_address, v_po.destination_name);
  v_destination_city := coalesce(v_appointment.destination_city, v_po.destination_city, v_destination_city);
  v_destination_state := coalesce(v_appointment.destination_state, v_po.destination_state);
  v_destination_postal_code := coalesce(v_appointment.destination_postal_code, v_po.destination_postal_code);
  v_destination_code := coalesce(v_appointment.destination_code, v_po.destination_key);

  v_existing := platform.claim_idempotency(v_po.company_id, 'CREATE_SHIPMENT', p_idempotency_key);
  if v_existing is not null then return v_existing; end if;
  v_number := platform.next_document_number(v_po.company_id, 'SHIPMENT', current_date);
  insert into scm.shipments(
    company_id, shipment_number, purchase_order_id, reservation_id, appointment_id,
    source_site_id, source_location_id, transit_location_id, destination_name,
    source_address, source_city, source_state, source_postal_code,
    destination_address, destination_city, destination_state, destination_postal_code, destination_code,
    truck_number, truck_type, truck_capacity, driver_name, driver_phone,
    planned_dispatch_at, expected_arrival_at, estimated_cost, route_snapshot,
    idempotency_key, created_by
  ) values (
    v_po.company_id, v_number, p_purchase_order_id, v_reservation.id, v_appointment.id,
    v_po.source_site_id, v_po.source_location_id, v_transit_location.id, v_po.destination_name,
    v_source_address, v_source_city, v_source_state, v_source_postal_code,
    v_destination_address, v_destination_city, v_destination_state, v_destination_postal_code, v_destination_code,
    nullif(p_vehicle->>'truckNumber', ''), nullif(p_vehicle->>'truckType', ''), nullif(p_vehicle->>'truckCapacity', '')::numeric,
    nullif(p_vehicle->>'driverName', ''), nullif(p_vehicle->>'driverPhone', ''), nullif(p_vehicle->>'plannedDispatchAt', '')::timestamptz,
    coalesce(nullif(p_vehicle->>'expectedArrivalAt', '')::timestamptz, case when v_route.id is null then null else statement_timestamp() + make_interval(hours => v_route.transit_hours) end),
    coalesce(v_route.estimated_cost, 0),
    jsonb_build_object('route', coalesce(to_jsonb(v_route), '{}'::jsonb), 'sourceCity', v_source_city, 'destinationCity', v_destination_city, 'destinationCode', v_destination_code, 'sourceAddress', v_source_address, 'destinationAddress', v_destination_address),
    p_idempotency_key, p_actor_id
  ) returning id into v_shipment_id;

  if jsonb_array_length(coalesce(p_lines, '[]'::jsonb)) = 0 then raise exception 'Shipment requires at least one line'; end if;
  for v_line in select value from jsonb_array_elements(p_lines)
  loop
    v_planned := coalesce((v_line->>'planned')::numeric, 0);
    if v_planned <= 0 then raise exception 'Shipment line quantity must be positive'; end if;
    select rl.* into v_reservation_line from inventory.reservation_lines rl where rl.reservation_id = v_reservation.id and rl.purchase_order_line_id = (v_line->>'poLineId')::uuid;
    if not found then raise exception 'Shipment line is not part of the active reservation'; end if;
    select coalesce(sum(sl.planned_quantity), 0) into v_already_planned from scm.shipment_lines sl join scm.shipments s on s.id = sl.shipment_id where sl.reservation_line_id = v_reservation_line.id and s.status <> 'CANCELLED';
    if v_already_planned + v_planned > v_reservation_line.reserved_quantity then raise exception 'Shipment quantity exceeds the reserved balance'; end if;
    insert into scm.shipment_lines(company_id, shipment_id, purchase_order_line_id, reservation_line_id, planned_quantity, uom_id)
    values (v_po.company_id, v_shipment_id, v_reservation_line.purchase_order_line_id, v_reservation_line.id, v_planned, v_reservation_line.uom_id);
  end loop;

  perform scm.refresh_po_status(p_purchase_order_id);
  select to_jsonb(s) into v_result from scm.shipments s where s.id = v_shipment_id;
  perform platform.write_audit(v_po.company_id, p_actor_id, 'SHIPMENT_CREATED', 'SCM_SHIPMENT', v_shipment_id, null, v_result);
  perform platform.finish_idempotency(v_po.company_id, 'CREATE_SHIPMENT', p_idempotency_key, v_result);
  return v_result;
end;
$$;

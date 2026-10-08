-- Resolve the source warehouse while creating a PO when the document contains a source city.
create or replace function scm.create_purchase_order(
  p_payload jsonb,
  p_actor_id uuid,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, scm, master_data, platform, iam
as $$
declare
  v_company_id uuid := (p_payload->>'companyId')::uuid;
  v_channel_id uuid := (p_payload->>'channelId')::uuid;
  v_mapping record;
  v_source_site_id uuid := nullif(p_payload->>'sourceWarehouseId', '')::uuid;
  v_source_location_id uuid := nullif(p_payload->>'sourceLocationId', '')::uuid;
  v_source_city text := nullif(trim(p_payload->>'sourceCity'), '');
  v_destination_city text := nullif(trim(p_payload->>'destinationCity'), '');
  v_po_id uuid;
  v_line jsonb;
  v_line_number integer := 0;
  v_item master_data.items%rowtype;
  v_existing jsonb;
  v_result jsonb;
begin
  if v_company_id is null or v_channel_id is null or nullif(p_payload->>'externalId', '') is null
    or nullif(p_payload->>'destination', '') is null or p_payload->>'poDate' is null then
    raise exception 'Company, channel, external PO ID, PO date and destination are required';
  end if;
  if not iam.actor_can_write(p_actor_id, v_company_id) then raise exception 'Actor cannot create a PO for this company'; end if;
  select result into v_existing from platform.idempotency_keys where company_id = v_company_id and operation = 'CREATE_PURCHASE_ORDER' and idempotency_key = p_idempotency_key;
  if found and v_existing is not null then return v_existing; end if;
  if exists (select 1 from scm.purchase_orders where company_id = v_company_id and channel_id = v_channel_id and external_id = p_payload->>'externalId' and status not in ('CANCELLED','CLOSED')) then raise exception 'Duplicate channel purchase order'; end if;

  if v_source_site_id is not null then
    if not exists (select 1 from master_data.sites where id = v_source_site_id and company_id = v_company_id and site_type = 'WAREHOUSE' and active) then raise exception 'Selected source warehouse is invalid or inactive'; end if;
    if v_source_location_id is null then
      select id into v_source_location_id from master_data.locations where company_id = v_company_id and site_id = v_source_site_id and active and not virtual and location_type = 'WAREHOUSE' order by created_at limit 1;
    elsif not exists (select 1 from master_data.locations where id = v_source_location_id and company_id = v_company_id and site_id = v_source_site_id and active and not virtual) then raise exception 'Selected stock location is invalid or inactive'; end if;
  elsif v_source_city is not null then
    v_source_site_id := master_data.resolve_warehouse_city(v_company_id, v_source_city);
    if v_source_site_id is not null then
      select id into v_source_location_id from master_data.locations where company_id = v_company_id and site_id = v_source_site_id and active and location_type = 'WAREHOUSE' order by created_at limit 1;
    end if;
  end if;
  -- Legacy destination mappings are used only when the PO has no source city.
  if v_source_site_id is null and v_source_city is null then
    select dm.* into v_mapping from master_data.destination_mappings dm where dm.company_id = v_company_id and dm.channel_id = v_channel_id and lower(dm.destination_key) = lower(p_payload->>'destination') and dm.active limit 1;
    v_source_site_id := v_mapping.source_site_id;
    v_source_location_id := v_mapping.source_location_id;
  end if;

  v_existing := platform.claim_idempotency(v_company_id, 'CREATE_PURCHASE_ORDER', p_idempotency_key);
  if v_existing is not null then return v_existing; end if;
  insert into scm.purchase_orders(
    company_id, channel_id, external_id, po_date, deadline, destination_key,
    destination_name, customer_name, source_site_id, source_location_id,
    source_address, source_city, source_state, source_postal_code,
    destination_address, destination_city, destination_state, destination_postal_code,
    currency, total_value, status, source_document_version_id, created_by
  ) values (
    v_company_id, v_channel_id, p_payload->>'externalId', (p_payload->>'poDate')::timestamptz,
    nullif(p_payload->>'deadline', '')::timestamptz, coalesce(v_destination_city, p_payload->>'destination'),
    coalesce(nullif(p_payload->>'destinationName', ''), nullif(p_payload->>'destinationAddress', ''), p_payload->>'destination'),
    nullif(p_payload->>'customer', ''), v_source_site_id, v_source_location_id,
    nullif(p_payload->>'sourceAddress', ''), v_source_city, nullif(p_payload->>'sourceState', ''), nullif(p_payload->>'sourcePostalCode', ''),
    nullif(p_payload->>'destinationAddress', ''), v_destination_city, nullif(p_payload->>'destinationState', ''), nullif(p_payload->>'destinationPostalCode', ''),
    coalesce(nullif(p_payload->>'currency', ''), 'INR'), coalesce((p_payload->>'totalValue')::numeric, 0),
    case when v_source_site_id is null or v_source_location_id is null then 'WAREHOUSE_MAPPING_REQUIRED' else 'UNDER_REVIEW' end,
    nullif(p_payload->>'documentVersionId', '')::uuid, p_actor_id
  ) returning id into v_po_id;

  for v_line in select value from jsonb_array_elements(coalesce(p_payload->'lines', '[]'::jsonb)) loop
    v_line_number := v_line_number + 1;
    select * into v_item from master_data.items where id = (v_line->>'itemId')::uuid and company_id = v_company_id and lifecycle_status = 'ACTIVE';
    if not found then raise exception 'PO line % has an invalid or inactive item', v_line_number; end if;
    if coalesce((v_line->>'ordered')::numeric, 0) <= 0 then raise exception 'PO line % quantity must be positive', v_line_number; end if;
    insert into scm.purchase_order_lines(company_id, purchase_order_id, line_number, item_id, channel_item_code, description, ordered_quantity, uom_id, unit_price, tax_rate, delivery_window_start, delivery_window_end, minimum_residual_shelf_life_days)
    values (v_company_id, v_po_id, coalesce((v_line->>'lineNumber')::integer, v_line_number), v_item.id, nullif(v_line->>'channelItemCode', ''), nullif(v_line->>'description', ''), (v_line->>'ordered')::numeric, coalesce(nullif(v_line->>'uomId', '')::uuid, v_item.base_uom_id), coalesce((v_line->>'unitPrice')::numeric, 0), coalesce((v_line->>'taxRate')::numeric, 0), nullif(v_line->>'deliveryWindowStart', '')::timestamptz, nullif(v_line->>'deliveryWindowEnd', '')::timestamptz, coalesce((v_line->>'minimumResidualShelfLifeDays')::integer, 0));
  end loop;
  if v_line_number = 0 then raise exception 'Purchase order requires at least one line'; end if;
  select to_jsonb(po) into v_result from scm.purchase_orders po where po.id = v_po_id;
  perform platform.write_audit(v_company_id, p_actor_id, 'PO_CREATED', 'SCM_PURCHASE_ORDER', v_po_id, null, v_result);
  perform platform.finish_idempotency(v_company_id, 'CREATE_PURCHASE_ORDER', p_idempotency_key, v_result);
  return v_result;
end;
$$;

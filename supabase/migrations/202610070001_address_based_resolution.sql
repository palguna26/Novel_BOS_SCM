-- Address-first warehouse and destination resolution for appointment documents.
alter table scm.purchase_orders
  add column if not exists source_address text,
  add column if not exists source_city text,
  add column if not exists source_state text,
  add column if not exists source_postal_code text,
  add column if not exists destination_address text,
  add column if not exists destination_city text,
  add column if not exists destination_state text,
  add column if not exists destination_postal_code text;

alter table scm.appointments
  add column if not exists source_address text,
  add column if not exists source_city text,
  add column if not exists source_state text,
  add column if not exists source_postal_code text,
  add column if not exists destination_address text,
  add column if not exists destination_city text,
  add column if not exists destination_state text,
  add column if not exists destination_postal_code text,
  add column if not exists facility_name text,
  add column if not exists resolution_status text not null default 'PENDING',
  add column if not exists resolution_confidence numeric;

alter table master_data.routes
  add column if not exists destination_city text;

create or replace function master_data.normalize_city(p_value text)
returns text
language sql
immutable
as $$
  select replace(replace(replace(regexp_replace(lower(trim(coalesce(p_value, ''))), '[^a-z0-9]+', '', 'g'), 'bangalore', 'bengaluru'), 'mysore', 'mysuru'), 'gurgaon', 'gurugram');
$$;

create or replace function master_data.resolve_warehouse_city(p_company_id uuid, p_city text)
returns uuid
language plpgsql
stable
security definer
set search_path = pg_catalog, master_data
as $$
declare
  v_count integer;
  v_site uuid;
begin
  if nullif(trim(p_city), '') is null then return null; end if;
  select count(*), (array_agg(id))[1]
    into v_count, v_site
  from master_data.sites
  where company_id = p_company_id
    and site_type = 'WAREHOUSE'
    and active
    and master_data.normalize_city(city) = master_data.normalize_city(p_city);
  return case when v_count = 1 then v_site else null end;
end;
$$;

create or replace function scm.record_appointment(
  p_purchase_order_id uuid,
  p_appointment_number text,
  p_appointment_at timestamptz,
  p_location_name text,
  p_match_status text,
  p_document_version_id uuid,
  p_actor_id uuid,
  p_idempotency_key text,
  p_match_details jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, scm, documents, master_data, inventory, platform, iam
as $$
declare
  v_po scm.purchase_orders%rowtype;
  v_existing jsonb;
  v_old_id uuid;
  v_appointment_id uuid;
  v_result jsonb;
  v_source_site_id uuid;
  v_source_location_id uuid;
  v_source_city text := nullif(trim(p_match_details->>'sourceCity'), '');
  v_destination_city text := nullif(trim(p_match_details->>'destinationCity'), '');
  v_source_address text := nullif(trim(p_match_details->>'sourceAddress'), '');
  v_destination_address text := nullif(trim(p_match_details->>'destinationAddress'), '');
  v_source_state text := nullif(trim(p_match_details->>'sourceState'), '');
  v_destination_state text := nullif(trim(p_match_details->>'destinationState'), '');
  v_source_postal_code text := nullif(trim(p_match_details->>'sourcePostalCode'), '');
  v_destination_postal_code text := nullif(trim(p_match_details->>'destinationPostalCode'), '');
  v_facility_name text := nullif(trim(p_match_details->>'facilityName'), '');
  v_resolution_status text := 'UNRESOLVED';
  v_source_conflict boolean := false;
  v_effective_match_status text := p_match_status;
  v_details jsonb := coalesce(p_match_details, '{}'::jsonb);
begin
  if p_match_status not in ('PENDING','MATCHED','MISMATCHED','WAIVED') then raise exception 'Invalid appointment match status'; end if;
  if p_appointment_at is null then raise exception 'Appointment time is required'; end if;
  if p_match_status = 'MATCHED' and p_document_version_id is null then raise exception 'Matched appointment requires a document version'; end if;
  select * into v_po from scm.purchase_orders where id = p_purchase_order_id for update;
  if not found then raise exception 'Purchase order not found'; end if;
  if not iam.actor_can_write(p_actor_id, v_po.company_id) then raise exception 'Actor cannot update this company'; end if;
  if p_match_status = 'WAIVED' and not iam.actor_can_approve(p_actor_id, v_po.company_id) then raise exception 'Appointment-match waiver requires approval'; end if;
  if p_match_status not in ('MATCHED','WAIVED') and exists (select 1 from inventory.reservations where purchase_order_id = p_purchase_order_id and status in ('ACTIVE','PARTIALLY_DISPATCHED','FULFILLED')) then raise exception 'Release or reverse the active reservation before replacing the matched appointment'; end if;
  if p_document_version_id is not null and not exists (select 1 from documents.document_versions where id = p_document_version_id and company_id = v_po.company_id) then raise exception 'Appointment document does not belong to the company'; end if;
  select result into v_existing from platform.idempotency_keys where company_id = v_po.company_id and operation = 'RECORD_APPOINTMENT' and idempotency_key = p_idempotency_key;
  if found and v_existing is not null then return v_existing; end if;
  v_existing := platform.claim_idempotency(v_po.company_id, 'RECORD_APPOINTMENT', p_idempotency_key);
  if v_existing is not null then return v_existing; end if;

  v_source_site_id := master_data.resolve_warehouse_city(v_po.company_id, v_source_city);
  if v_source_site_id is not null then
    select id into v_source_location_id from master_data.locations where company_id = v_po.company_id and site_id = v_source_site_id and active and location_type = 'WAREHOUSE' order by created_at limit 1;
  end if;
  if v_source_site_id is not null and v_po.source_site_id is not null and v_po.source_site_id <> v_source_site_id then
    v_source_conflict := true;
    v_resolution_status := 'SOURCE_CONFLICT_REVIEW';
  elsif v_source_site_id is not null and v_source_location_id is not null then
    v_resolution_status := 'RESOLVED';
  elsif v_source_city is null then
    v_resolution_status := 'MISSING_SOURCE_CITY';
  else
    v_resolution_status := 'WAREHOUSE_REVIEW_REQUIRED';
  end if;
  if p_match_status = 'MATCHED' and v_resolution_status <> 'RESOLVED' then v_effective_match_status := 'MISMATCHED'; end if;
  v_details := v_details || jsonb_build_object('warehouseResolution', v_resolution_status, 'resolvedSourceSiteId', v_source_site_id, 'resolvedSourceLocationId', v_source_location_id);

  select id into v_old_id from scm.appointments where purchase_order_id = p_purchase_order_id and active for update;
  update scm.appointments set active = false, status = 'REPLACED' where purchase_order_id = p_purchase_order_id and active;
  insert into scm.appointments(company_id, purchase_order_id, appointment_number, appointment_at, location_name, destination_code, status, match_status, match_details, source_address, source_city, source_state, source_postal_code, destination_address, destination_city, destination_state, destination_postal_code, facility_name, resolution_status, resolution_confidence, supersedes_appointment_id, created_by, idempotency_key)
  values (v_po.company_id, p_purchase_order_id, p_appointment_number, p_appointment_at, p_location_name, nullif(p_match_details->>'fcCode',''), case when v_effective_match_status = 'MATCHED' then 'MATCHED' else 'BOOKED' end, v_effective_match_status, v_details, v_source_address, v_source_city, v_source_state, v_source_postal_code, v_destination_address, v_destination_city, v_destination_state, v_destination_postal_code, v_facility_name, v_resolution_status, case when v_resolution_status = 'RESOLVED' then 1 else 0 end, v_old_id, p_actor_id, p_idempotency_key)
  returning id into v_appointment_id;

  update scm.purchase_orders set source_site_id = case when v_source_conflict then source_site_id else coalesce(v_source_site_id, source_site_id) end, source_location_id = case when v_source_conflict then source_location_id else coalesce(v_source_location_id, source_location_id) end, source_address = coalesce(v_source_address, source_address), source_city = coalesce(v_source_city, source_city), source_state = coalesce(v_source_state, source_state), source_postal_code = coalesce(v_source_postal_code, source_postal_code), destination_name = coalesce(v_destination_address, destination_name), destination_key = coalesce(v_destination_city, destination_key), destination_address = coalesce(v_destination_address, destination_address), destination_city = coalesce(v_destination_city, destination_city), destination_state = coalesce(v_destination_state, destination_state), destination_postal_code = coalesce(v_destination_postal_code, destination_postal_code) where id = p_purchase_order_id;
  if p_document_version_id is not null then insert into scm.appointment_documents(company_id, appointment_id, document_version_id) values (v_po.company_id, v_appointment_id, p_document_version_id); end if;
  perform scm.refresh_po_status(p_purchase_order_id);
  if v_effective_match_status in ('MATCHED','WAIVED') then perform scm.try_create_reservation(p_purchase_order_id, p_actor_id, 'AUTO-RESERVE:' || p_purchase_order_id::text); end if;
  select to_jsonb(a) into v_result from scm.appointments a where a.id = v_appointment_id;
  perform platform.write_audit(v_po.company_id, p_actor_id, 'APPOINTMENT_RECORDED', 'SCM_APPOINTMENT', v_appointment_id, null, v_result);
  perform platform.finish_idempotency(v_po.company_id, 'RECORD_APPOINTMENT', p_idempotency_key, v_result);
  return v_result;
end;
$$;

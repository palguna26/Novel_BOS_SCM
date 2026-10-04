-- API cutover helpers for atomic document registration and manual stock receipts.

create or replace function documents.register_extraction(
  p_payload jsonb,
  p_actor_id uuid,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, documents, platform, iam
as $$
declare
  v_company_id uuid := (p_payload->>'companyId')::uuid;
  v_file_id uuid;
  v_version_number integer;
  v_version_id uuid;
  v_run_id uuid;
  v_existing jsonb;
  v_result jsonb;
begin
  if not iam.actor_can_write(p_actor_id, v_company_id) then
    raise exception 'Actor cannot register documents for this company';
  end if;
  if nullif(p_payload->>'filename', '') is null or nullif(p_payload->>'sha256', '') is null then
    raise exception 'Filename and SHA-256 are required';
  end if;

  select jsonb_build_object('documentVersionId', dv.id, 'fileId', dv.file_id, 'duplicate', true)
  into v_existing
  from documents.document_versions dv
  where dv.company_id = v_company_id and dv.sha256 = p_payload->>'sha256'
  order by dv.uploaded_at desc limit 1;
  if v_existing is not null then return v_existing; end if;

  v_existing := platform.claim_idempotency(v_company_id, 'REGISTER_DOCUMENT', p_idempotency_key);
  if v_existing is not null then return v_existing; end if;

  select id, current_version + 1 into v_file_id, v_version_number
  from documents.files
  where company_id = v_company_id
    and document_type = coalesce(nullif(p_payload->>'documentType', ''), 'OTHER')
    and nullif(p_payload->>'businessKey', '') is not null
    and business_key = nullif(p_payload->>'businessKey', '')
  for update;
  if not found then
    insert into documents.files(company_id, document_type, business_key, created_by)
    values (
      v_company_id,
      coalesce(nullif(p_payload->>'documentType', ''), 'OTHER'),
      nullif(p_payload->>'businessKey', ''),
      p_actor_id
    ) returning id into v_file_id;
    v_version_number := 1;
  end if;

  insert into documents.document_versions(
    company_id, file_id, version_number, filename, storage_bucket, storage_path,
    media_type, byte_size, sha256, uploaded_by
  ) values (
    v_company_id, v_file_id, v_version_number, p_payload->>'filename',
    coalesce(nullif(p_payload->>'storageBucket', ''), 'local'), p_payload->>'storagePath',
    coalesce(nullif(p_payload->>'mediaType', ''), 'application/octet-stream'),
    nullif(p_payload->>'byteSize', '')::bigint, p_payload->>'sha256', p_actor_id
  ) returning id into v_version_id;

  update documents.files set current_version = v_version_number where id = v_file_id;
  insert into documents.extraction_runs(
    company_id, document_version_id, engine, engine_version, status,
    overall_confidence, raw_output, started_at, completed_at
  ) values (
    v_company_id, v_version_id, 'SCM_NORMALIZER', '1.0',
    case when coalesce((p_payload->>'confidence')::numeric, 0) >= 0.8 then 'COMPLETED' else 'REVIEW_REQUIRED' end,
    coalesce((p_payload->>'confidence')::numeric, 0), p_payload->'extracted',
    statement_timestamp(), statement_timestamp()
  ) returning id into v_run_id;

  insert into documents.extracted_fields(
    company_id, extraction_run_id, field_path, extracted_value, confidence
  ) values (v_company_id, v_run_id, '$', p_payload->'extracted', coalesce((p_payload->>'confidence')::numeric, 0));

  v_result := jsonb_build_object(
    'documentVersionId', v_version_id,
    'fileId', v_file_id,
    'extractionRunId', v_run_id,
    'duplicate', false
  );
  perform platform.write_audit(v_company_id, p_actor_id, 'DOCUMENT_REGISTERED', 'DOCUMENT_VERSION', v_version_id, null, v_result);
  perform platform.finish_idempotency(v_company_id, 'REGISTER_DOCUMENT', p_idempotency_key, v_result);
  return v_result;
end;
$$;

create or replace function inventory.add_stock(
  p_company_id uuid,
  p_site_id uuid,
  p_location_id uuid,
  p_item_id uuid,
  p_uom_id uuid,
  p_quantity numeric,
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
  v_source master_data.locations%rowtype;
  v_item master_data.items%rowtype;
  v_transaction_id uuid;
  v_existing jsonb;
  v_result jsonb;
begin
  if not iam.actor_can_write(p_actor_id, p_company_id) then raise exception 'Actor cannot add stock for this company'; end if;
  if coalesce(p_quantity, 0) <= 0 then raise exception 'Quantity must be positive'; end if;

  select result into v_existing from platform.idempotency_keys
  where company_id = p_company_id and operation = 'ADD_STOCK' and idempotency_key = p_idempotency_key;
  if found and v_existing is not null then return v_existing; end if;

  select * into v_target from master_data.locations
  where company_id = p_company_id and site_id = p_site_id
    and (p_location_id is null or id = p_location_id)
    and location_type not in ('EXTERNAL_SOURCE','EXTERNAL_SINK','CUSTOMER','TRANSIT') and active
  order by created_at limit 1;
  if not found then raise exception 'An active internal stock location is required'; end if;

  select * into v_source from master_data.locations
  where company_id = p_company_id and location_type = 'EXTERNAL_SOURCE' and active
  order by created_at limit 1;
  if not found then raise exception 'An external source location is required'; end if;

  select * into v_item from master_data.items where id = p_item_id and company_id = p_company_id;
  if not found then raise exception 'Item not found'; end if;

  v_existing := platform.claim_idempotency(p_company_id, 'ADD_STOCK', p_idempotency_key);
  if v_existing is not null then return v_existing; end if;

  insert into inventory.stock_transactions(
    company_id, transaction_type, document_type, document_id, reason, idempotency_key, posted_by
  ) values (
    p_company_id, 'RECEIPT', 'MANUAL_RECEIPT', gen_random_uuid(), p_reason, p_idempotency_key, p_actor_id
  ) returning id into v_transaction_id;

  insert into inventory.stock_ledger_entries(
    company_id, stock_transaction_id, line_number, site_id, location_id,
    item_id, stock_state, uom_id, quantity_delta
  ) values
    (p_company_id, v_transaction_id, 1, v_source.site_id, v_source.id, p_item_id, 'RELEASED', coalesce(p_uom_id, v_item.base_uom_id), -p_quantity),
    (p_company_id, v_transaction_id, 2, p_site_id, v_target.id, p_item_id, 'RELEASED', coalesce(p_uom_id, v_item.base_uom_id), p_quantity);

  v_result := jsonb_build_object('transactionId', v_transaction_id, 'quantity', p_quantity, 'locationId', v_target.id);
  perform platform.write_audit(p_company_id, p_actor_id, 'STOCK_ADDED', 'STOCK_TRANSACTION', v_transaction_id, null, v_result, p_reason);
  perform platform.finish_idempotency(p_company_id, 'ADD_STOCK', p_idempotency_key, v_result);
  return v_result;
end;
$$;

grant execute on function documents.register_extraction(jsonb,uuid,text) to authenticated, service_role;
grant execute on function inventory.add_stock(uuid,uuid,uuid,uuid,uuid,numeric,text,uuid,text) to authenticated, service_role;

create or replace function platform.queue_invoice_notifications()
returns trigger
language plpgsql
set search_path = pg_catalog, platform, scm
as $$
declare
  v_recipient text;
  v_po_number text;
begin
  select external_id into v_po_number from scm.purchase_orders where id = new.purchase_order_id;
  for v_recipient in select jsonb_array_elements_text(coalesce(new.recipients, '[]'::jsonb))
  loop
    insert into platform.notifications(
      company_id, entity_type, entity_id, notification_type, recipient, subject, payload
    ) values (
      new.company_id, 'SCM_INVOICE', new.id, 'INVOICE_EMAIL', v_recipient,
      'Invoice ' || new.invoice_number || ' for PO ' || v_po_number,
      jsonb_build_object('invoiceId', new.id, 'purchaseOrderId', new.purchase_order_id, 'invoiceNumber', new.invoice_number, 'amount', new.amount, 'body', 'Invoice ' || new.invoice_number || ' is ready for PO ' || v_po_number || '.')
    );
  end loop;
  return new;
end;
$$;

create trigger queue_invoice_notifications
after insert on scm.invoices
for each row execute function platform.queue_invoice_notifications();

create or replace function scm.record_shipment_event(
  p_shipment_id uuid,
  p_status text,
  p_event_at timestamptz,
  p_location_name text,
  p_notes text,
  p_actor_id uuid,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, scm, platform, iam
as $$
declare
  v_shipment scm.shipments%rowtype;
  v_event_id uuid;
  v_existing jsonb;
  v_result jsonb;
begin
  select * into v_shipment from scm.shipments where id = p_shipment_id for update;
  if not found then raise exception 'Shipment not found'; end if;
  if not iam.actor_can_write(p_actor_id, v_shipment.company_id) then raise exception 'Actor cannot update this shipment'; end if;
  if p_status not in ('VEHICLE_ASSIGNED','LOADING','DISPATCHED','IN_TRANSIT','ARRIVED','UNLOADING','PARTIALLY_DELIVERED','DELIVERED','DELIVERY_ISSUE','RETURNED','CANCELLED') then raise exception 'Invalid shipment status'; end if;
  v_existing := platform.claim_idempotency(v_shipment.company_id, 'RECORD_SHIPMENT_EVENT', p_idempotency_key);
  if v_existing is not null then return v_existing; end if;
  insert into scm.shipment_events(company_id, shipment_id, status, event_at, location_name, notes, entered_by)
  values (v_shipment.company_id, p_shipment_id, p_status, coalesce(p_event_at, statement_timestamp()), p_location_name, p_notes, p_actor_id)
  returning id into v_event_id;
  update scm.shipments set status = p_status, actual_arrival_at = case when p_status = 'ARRIVED' then coalesce(p_event_at, statement_timestamp()) else actual_arrival_at end where id = p_shipment_id;
  select to_jsonb(e) into v_result from scm.shipment_events e where e.id = v_event_id;
  perform platform.write_audit(v_shipment.company_id, p_actor_id, 'SHIPMENT_EVENT_RECORDED', 'SCM_SHIPMENT', p_shipment_id, to_jsonb(v_shipment), v_result);
  perform platform.finish_idempotency(v_shipment.company_id, 'RECORD_SHIPMENT_EVENT', p_idempotency_key, v_result);
  return v_result;
end;
$$;

grant execute on function scm.record_shipment_event(uuid,text,timestamptz,text,text,uuid,text) to authenticated, service_role;

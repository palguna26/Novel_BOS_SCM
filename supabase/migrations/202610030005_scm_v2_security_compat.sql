-- Read security and legacy-shaped compatibility views.
-- The existing public schema remains active until a controlled API cutover.

create or replace view compat.users with (security_invoker = true) as
select id, email, display_name as name, role, active, created_at
from iam.users;

create or replace view compat.platforms with (security_invoker = true) as
select id, name, code, active
from master_data.channels;

create or replace view compat.warehouses with (security_invoker = true) as
select id, name, code, coalesce(city, '') as city, coalesce(state, '') as state, active
from master_data.sites
where site_type = 'WAREHOUSE';

create or replace view compat.skus with (security_invoker = true) as
select id, code, name, (lifecycle_status = 'ACTIVE') as active
from master_data.items;

create or replace view compat.warehouse_sku_policies with (security_invoker = true) as
select id, site_id as warehouse_id, item_id as sku_id, threshold_quantity as threshold
from inventory.inventory_policies
where effective_from <= current_date and (effective_to is null or effective_to >= current_date);

create or replace view compat.inventory_balances with (security_invoker = true) as
select
  md5(company_id::text || ':' || site_id::text || ':' || item_id::text || ':' || uom_id::text)::uuid as id,
  site_id as warehouse_id,
  item_id as sku_id,
  physical,
  blocked,
  in_transit
from inventory.inventory_summary_v;

create or replace view compat.destination_mappings with (security_invoker = true) as
select
  id,
  channel_id as platform_id,
  destination_name as destination,
  fc_code,
  null::text as city,
  null::text as state,
  source_site_id as warehouse_id,
  active
from master_data.destination_mappings;

create or replace view compat.route_estimates with (security_invoker = true) as
select id, source_site_id as warehouse_id, destination_key as destination,
       transit_hours, estimated_cost as cost, active
from master_data.routes;

create or replace view compat.purchase_orders with (security_invoker = true) as
select
  po.id,
  po.channel_id as platform_id,
  po.external_id,
  po.po_date,
  po.deadline,
  po.destination_name as destination,
  po.customer_name as customer,
  po.total_value,
  po.status,
  po.source_site_id as warehouse_id,
  coalesce((
    select sum(rl.shortage_quantity)
    from inventory.reservation_lines rl
    join inventory.reservations r on r.id = rl.reservation_id
    where r.purchase_order_id = po.id
      and r.version = (select max(r2.version) from inventory.reservations r2 where r2.purchase_order_id = po.id)
  ), 0) as shortage,
  gate.accepted_at,
  po.created_at,
  po.created_by as user_id
from scm.purchase_orders po
left join scm.po_gate_state_v gate on gate.purchase_order_id = po.id;

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
      and r.version = (select max(r2.version) from inventory.reservations r2 where r2.purchase_order_id = pol.purchase_order_id)
  ), 0) as allocated,
  coalesce((
    select sum(sl.delivered_quantity)
    from scm.shipment_lines sl
    join scm.shipments s on s.id = sl.shipment_id
    where sl.purchase_order_line_id = pol.id and s.status <> 'CANCELLED'
  ), 0) as delivered
from scm.purchase_order_lines pol;

create or replace view compat.po_documents with (security_invoker = true) as
select
  f.id,
  po.id as po_id,
  dv.filename,
  dv.storage_path as path,
  dv.sha256,
  er.raw_output as extracted_json,
  er.overall_confidence as confidence,
  (
    select jsonb_object_agg(ef.field_path, coalesce(ef.corrected_value, ef.extracted_value))
    from documents.extracted_fields ef where ef.extraction_run_id = er.id
  ) as corrected_json,
  dv.uploaded_at
from scm.purchase_orders po
join documents.document_versions dv on dv.id = po.source_document_version_id
join documents.files f on f.id = dv.file_id
left join lateral (
  select x.* from documents.extraction_runs x
  where x.document_version_id = dv.id order by x.created_at desc limit 1
) er on true;

create or replace view compat.stock_reservations with (security_invoker = true) as
select id, purchase_order_id as po_id, status, created_at
from inventory.reservations;

create or replace view compat.appointments with (security_invoker = true) as
select
  a.id,
  a.purchase_order_id as po_id,
  a.appointment_number as appointment_id,
  a.booking_at as booking_date,
  a.appointment_at,
  a.location_name as location,
  a.status,
  dv.storage_path as document_path
from scm.appointments a
left join scm.appointment_documents ad on ad.appointment_id = a.id and ad.is_primary
left join documents.document_versions dv on dv.id = ad.document_version_id
where a.active;

create or replace view compat.shipments with (security_invoker = true) as
select
  id,
  shipment_number as number,
  purchase_order_id as po_id,
  source_site_id as source_warehouse_id,
  destination_name as destination,
  truck_number,
  driver_name,
  driver_phone,
  status,
  planned_dispatch_at as planned_dispatch,
  expected_arrival_at as expected_arrival,
  actual_dispatch_at as actual_dispatch,
  actual_arrival_at as actual_arrival,
  estimated_cost,
  actual_cost
from scm.shipments;

create or replace view compat.shipment_lines with (security_invoker = true) as
select
  id,
  shipment_id,
  purchase_order_line_id as po_line_id,
  planned_quantity as planned,
  dispatched_quantity as dispatched,
  delivered_quantity as delivered
from scm.shipment_lines;

create or replace view compat.shipment_events with (security_invoker = true) as
select id, shipment_id, status, event_at, location_name as location, notes
from scm.shipment_events;

create or replace view compat.pods with (security_invoker = true) as
select
  p.id,
  p.purchase_order_id as po_id,
  dv.filename,
  dv.storage_path as path,
  dv.sha256,
  p.delivery_at,
  p.receiver_name as receiver,
  p.confirmed_at
from scm.pods p
join documents.document_versions dv on dv.id = p.document_version_id
where p.status = 'CONFIRMED';

create or replace view compat.pod_lines with (security_invoker = true) as
select
  pl.id,
  pl.pod_id,
  sl.purchase_order_line_id as po_line_id,
  pl.confirmed_quantity as confirmed,
  pl.short_quantity as short,
  pl.damaged_quantity as damaged,
  pl.rejected_quantity as rejected
from scm.pod_lines pl
join scm.shipment_lines sl on sl.id = pl.shipment_line_id;

create or replace view compat.invoices with (security_invoker = true) as
select
  i.id,
  i.purchase_order_id as po_id,
  i.invoice_number as number,
  i.invoice_date,
  i.amount,
  dv.filename,
  dv.storage_path as path,
  i.uploaded_at,
  i.sent_at,
  i.send_status
from scm.invoices i
join documents.document_versions dv on dv.id = i.document_version_id;

create or replace view compat.inventory_movements with (security_invoker = true) as
select
  e.id,
  t.transaction_type as type,
  e.site_id as warehouse_id,
  e.item_id as sku_id,
  e.quantity_delta as quantity,
  t.document_type as reference_type,
  t.document_id as reference_id,
  t.reason,
  t.created_at,
  t.posted_by as user_id
from inventory.stock_ledger_entries e
join inventory.stock_transactions t on t.id = e.stock_transaction_id;

create or replace view compat.audit_events with (security_invoker = true) as
select
  id,
  actor_id as user_id,
  action,
  entity_type as record_type,
  entity_id as record_id,
  old_value,
  new_value,
  reason,
  case when entity_type = 'SCM_PURCHASE_ORDER' then entity_id else null end as po_id,
  occurred_at as created_at
from platform.audit_events;

create or replace view compat.notifications with (security_invoker = true) as
select
  id,
  case when entity_type = 'SCM_PURCHASE_ORDER' then entity_id else null end as po_id,
  notification_type as type,
  recipient,
  subject,
  status,
  null::text as error,
  created_at,
  sent_at
from platform.notifications;

do $$
declare
  r record;
begin
  for r in
    select n.nspname as schema_name, c.relname as table_name
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where c.relkind = 'r'
      and n.nspname in ('master_data','documents','workflow','scm','inventory','quality','planning','procurement','manufacturing','finance','platform')
      and exists (
        select 1 from pg_attribute a
        where a.attrelid = c.oid and a.attname = 'company_id' and not a.attisdropped
      )
  loop
    execute format('alter table %I.%I enable row level security', r.schema_name, r.table_name);
    execute format(
      'create policy company_read on %I.%I for select to authenticated using (iam.can_access_company(company_id))',
      r.schema_name, r.table_name
    );
  end loop;
end;
$$;

alter table iam.users enable row level security;
create policy users_read_self on iam.users for select to authenticated using (id = auth.uid());
alter table iam.user_company_access enable row level security;
create policy company_access_read_self on iam.user_company_access for select to authenticated using (user_id = auth.uid());

alter table master_data.uoms enable row level security;
create policy uoms_read_authenticated on master_data.uoms for select to authenticated using (true);

revoke all on schema iam, master_data, documents, workflow, scm, inventory, quality, planning, procurement, manufacturing, finance, platform, compat from anon, authenticated;
grant usage on schema iam, master_data, documents, workflow, scm, inventory, quality, planning, procurement, manufacturing, finance, platform, compat to authenticated;
grant select on all tables in schema compat to authenticated;
grant select on iam.users, iam.user_company_access, master_data.uoms to authenticated;
grant select on
  master_data.channels, master_data.sites, master_data.locations, master_data.items,
  master_data.destination_mappings, master_data.routes,
  documents.files, documents.document_versions, documents.extraction_runs, documents.extracted_fields,
  scm.purchase_orders, scm.purchase_order_lines, scm.acceptance_decisions, scm.appointments,
  scm.appointment_documents, scm.shipments, scm.shipment_lines, scm.shipment_events,
  scm.pods, scm.pod_lines, scm.invoices, scm.delivery_exceptions,
  inventory.inventory_policies, inventory.stock_transactions, inventory.stock_ledger_entries,
  inventory.reservations, inventory.reservation_lines,
  platform.audit_events, platform.notifications
to authenticated;
grant select on inventory.stock_balance_v, inventory.inventory_summary_v, scm.po_gate_state_v to authenticated;

revoke execute on all functions in schema iam, master_data, documents, workflow, scm, inventory, quality, planning, procurement, manufacturing, finance, platform from public, anon, authenticated;
grant execute on function iam.can_access_company(uuid), iam.can_write_company(uuid), iam.can_approve_company(uuid) to authenticated;
grant execute on function scm.create_purchase_order(jsonb,uuid,text) to authenticated, service_role;
grant execute on function scm.record_acceptance(uuid,text,text,uuid,text) to authenticated, service_role;
grant execute on function scm.record_appointment(uuid,text,timestamptz,text,text,uuid,uuid,text,jsonb) to authenticated, service_role;
grant execute on function scm.try_create_reservation(uuid,uuid,text) to authenticated, service_role;
grant execute on function scm.create_shipment(uuid,jsonb,jsonb,uuid,text) to authenticated, service_role;
grant execute on function scm.dispatch_shipment(uuid,uuid,text) to authenticated, service_role;
grant execute on function scm.record_pod(uuid,uuid,timestamptz,text,jsonb,uuid,text) to authenticated, service_role;
grant execute on function scm.short_close_purchase_order(uuid,text,numeric,uuid,text) to authenticated, service_role;
grant execute on function scm.upload_invoice(uuid,text,date,numeric,character,uuid,jsonb,uuid,text) to authenticated, service_role;
grant execute on function inventory.reverse_stock_transaction(uuid,text,uuid,text) to authenticated, service_role;

grant usage on schema iam, master_data, documents, workflow, scm, inventory, quality, planning, procurement, manufacturing, finance, platform, compat to service_role;
grant all on all tables in schema iam, master_data, documents, workflow, scm, inventory, quality, planning, procurement, manufacturing, finance, platform to service_role;
grant select on all tables in schema compat to service_role;
grant execute on all functions in schema iam, master_data, documents, workflow, scm, inventory, quality, planning, procurement, manufacturing, finance, platform to service_role;

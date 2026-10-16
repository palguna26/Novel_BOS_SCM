-- Product workflow fixes for UAT:
-- 1. Acceptance is the point at which stock is reserved. Appointment data is
--    attached afterwards and must not block PO acceptance.
-- 2. Appointment document matching is independent from warehouse resolution.
--    A valid appointment must not be downgraded just because a warehouse map
--    still needs review.
-- 3. Accept/reject are approval actions, not ordinary write actions.

create or replace view scm.po_gate_state_v with (security_invoker = true) as
select
  po.id as purchase_order_id,
  po.company_id,
  (ad.decision = 'ACCEPTED') as acceptance_complete,
  (ap.match_status in ('MATCHED','WAIVED') and ap.status not in ('CANCELLED','REPLACED')) as appointment_complete,
  (ad.decision = 'ACCEPTED') as ready_for_reservation,
  ad.decided_at as accepted_at,
  ap.id as appointment_id,
  ap.appointment_at
from scm.purchase_orders po
left join scm.acceptance_decisions ad
  on ad.purchase_order_id = po.id and ad.active
left join scm.appointments ap
  on ap.purchase_order_id = po.id and ap.active;

do $$
declare
  v_function text;
  v_old text := $old$if p_match_status = 'MATCHED' and v_resolution_status <> 'RESOLVED' then v_effective_match_status := 'MISMATCHED'; end if;$old$;
  v_new text := $new$null;$new$;
begin
  select pg_get_functiondef('scm.record_appointment(uuid,text,timestamptz,text,text,uuid,uuid,text,jsonb)'::regprocedure)
    into v_function;
  if position(v_old in v_function) = 0 then
    raise exception 'Expected appointment matching guard was not found';
  end if;
  execute replace(v_function, v_old, v_new);
end $$;

-- Prevent cross-company child rows even when a service-role client is used.
do $$
begin
  if exists (select 1 from scm.purchase_order_lines l join scm.purchase_orders p on p.id = l.purchase_order_id where l.company_id <> p.company_id)
    then raise exception 'Existing cross-company purchase order line found'; end if;
  if exists (select 1 from scm.shipment_lines l join scm.shipments s on s.id = l.shipment_id where l.company_id <> s.company_id)
    then raise exception 'Existing cross-company shipment line found'; end if;
  if exists (select 1 from inventory.reservation_lines l join inventory.reservations r on r.id = l.reservation_id where l.company_id <> r.company_id)
    then raise exception 'Existing cross-company reservation line found'; end if;
end $$;

create or replace function platform.enforce_company_match()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, platform
as $$
declare
  v_child_company uuid := (to_jsonb(new)->>'company_id')::uuid;
  v_parent_id uuid := nullif(to_jsonb(new)->>tg_argv[2], '')::uuid;
  v_parent_company uuid;
begin
  if v_child_company is null or v_parent_id is null then return new; end if;
  execute format('select company_id from %I.%I where id = $1', tg_argv[0], tg_argv[1])
    into v_parent_company using v_parent_id;
  if v_parent_company is null then
    raise exception 'Referenced % %.% was not found', tg_argv[0], tg_argv[1], v_parent_id;
  end if;
  if v_parent_company <> v_child_company then
    raise exception 'Cross-company relationship is not allowed';
  end if;
  return new;
end;
$$;

drop trigger if exists purchase_order_lines_company_match on scm.purchase_order_lines;
create trigger purchase_order_lines_company_match before insert or update on scm.purchase_order_lines
for each row execute function platform.enforce_company_match('scm', 'purchase_orders', 'purchase_order_id');
drop trigger if exists appointments_company_match on scm.appointments;
create trigger appointments_company_match before insert or update on scm.appointments
for each row execute function platform.enforce_company_match('scm', 'purchase_orders', 'purchase_order_id');
drop trigger if exists shipments_company_match on scm.shipments;
create trigger shipments_company_match before insert or update on scm.shipments
for each row execute function platform.enforce_company_match('scm', 'purchase_orders', 'purchase_order_id');
drop trigger if exists shipment_lines_company_match on scm.shipment_lines;
create trigger shipment_lines_company_match before insert or update on scm.shipment_lines
for each row execute function platform.enforce_company_match('scm', 'shipments', 'shipment_id');
drop trigger if exists reservation_lines_company_match on inventory.reservation_lines;
create trigger reservation_lines_company_match before insert or update on inventory.reservation_lines
for each row execute function platform.enforce_company_match('inventory', 'reservations', 'reservation_id');
drop trigger if exists reservation_allocations_company_match on inventory.reservation_allocations;
create trigger reservation_allocations_company_match before insert or update on inventory.reservation_allocations
for each row execute function platform.enforce_company_match('inventory', 'reservation_lines', 'reservation_line_id');
drop trigger if exists stock_ledger_company_match on inventory.stock_ledger_entries;
create trigger stock_ledger_company_match before insert or update on inventory.stock_ledger_entries
for each row execute function platform.enforce_company_match('inventory', 'stock_transactions', 'stock_transaction_id');
drop trigger if exists pod_lines_company_match on scm.pod_lines;
create trigger pod_lines_company_match before insert or update on scm.pod_lines
for each row execute function platform.enforce_company_match('scm', 'pods', 'pod_id');

-- POD exceptions must leave IN_TRANSIT inventory as well. The main POD
-- command creates the stock transaction first and links it to the POD at the
-- end, so reconcile after that link is written.
create or replace function inventory.reconcile_pod_exception_stock()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, scm, inventory, master_data
as $$
declare
  v_line record;
  v_allocation record;
  v_category record;
  v_remaining numeric(18,6);
  v_take numeric(18,6);
  v_entry integer;
begin
  if new.stock_transaction_id is null or old.stock_transaction_id is not distinct from new.stock_transaction_id then
    return new;
  end if;

  for v_line in
    select pl.*, sl.shipment_id, s.transit_location_id, transit.site_id as transit_site_id
    from scm.pod_lines pl
    join scm.shipment_lines sl on sl.id = pl.shipment_line_id
    join scm.shipments s on s.id = sl.shipment_id
    join master_data.locations transit on transit.id = s.transit_location_id
    where pl.pod_id = new.id
  loop
    for v_category in
      select * from (values
        ('SCRAP'::text, v_line.short_quantity),
        ('QUARANTINE'::text, v_line.damaged_quantity),
        ('REJECTED'::text, v_line.rejected_quantity)
      ) categories(stock_state, quantity)
      where quantity > 0
    loop
      v_remaining := v_category.quantity;
      for v_allocation in
        select sla.*, pol.item_id, sl.uom_id
        from scm.shipment_line_allocations sla
        join scm.shipment_lines sl on sl.id = sla.shipment_line_id
        join scm.purchase_order_lines pol on pol.id = sl.purchase_order_line_id
        where sla.shipment_line_id = v_line.shipment_line_id
          and sla.dispatched_quantity > sla.delivered_quantity
        order by sla.id
        for update of sla
      loop
        exit when v_remaining <= 0;
        v_take := least(v_remaining, v_allocation.dispatched_quantity - v_allocation.delivered_quantity);
        update scm.shipment_line_allocations
        set delivered_quantity = delivered_quantity + v_take
        where id = v_allocation.id;

        select coalesce(max(line_number), 0) into v_entry
        from inventory.stock_ledger_entries
        where stock_transaction_id = new.stock_transaction_id;
        insert into inventory.stock_ledger_entries(company_id, stock_transaction_id, line_number, site_id, location_id, item_id, batch_id, stock_state, uom_id, quantity_delta)
        values (new.company_id, new.stock_transaction_id, v_entry + 1, v_line.transit_site_id, v_line.transit_location_id, v_allocation.item_id, v_allocation.batch_id, 'IN_TRANSIT', v_allocation.uom_id, -v_take);
        insert into inventory.stock_ledger_entries(company_id, stock_transaction_id, line_number, site_id, location_id, item_id, batch_id, stock_state, uom_id, quantity_delta)
        values (new.company_id, new.stock_transaction_id, v_entry + 2, v_line.transit_site_id, v_line.transit_location_id, v_allocation.item_id, v_allocation.batch_id, v_category.stock_state, v_allocation.uom_id, v_take);
        v_remaining := v_remaining - v_take;
      end loop;
      if v_remaining > 0 then raise exception 'POD exception quantity exceeds tracked in-transit allocation'; end if;
    end loop;
  end loop;
  return new;
end;
$$;

drop trigger if exists pod_exception_stock_reconciliation on scm.pods;
create trigger pod_exception_stock_reconciliation
after update of stock_transaction_id on scm.pods
for each row execute function inventory.reconcile_pod_exception_stock();

-- Serialize version allocation per entity and enforce the invariant in the
-- change feed. The ranking also repairs duplicate versions from older data.
with ranked as (
  select sequence_id,
    row_number() over (partition by company_id, entity_type, entity_id order by sequence_id) as version_number
  from integration.change_log
)
update integration.change_log c
set entity_version = ranked.version_number
from ranked
where ranked.sequence_id = c.sequence_id;

create unique index if not exists change_log_entity_version_uq
  on integration.change_log(company_id, entity_type, entity_id, entity_version);

do $$
declare
  v_function text;
  v_old text := '  insert into integration.change_log(company_id, entity_type, entity_id, operation, entity_version, data)';
  v_new text := $new$  perform pg_advisory_xact_lock(hashtextextended(v_company::text || ':' || v_type || ':' || v_id::text, 0));
$new$ || v_old;
begin
  select pg_get_functiondef('integration.record_change()'::regprocedure) into v_function;
  if position(v_old in v_function) = 0 then
    raise exception 'Expected change-log insert was not found';
  end if;
  execute replace(v_function, v_old, v_new);
end $$;

do $$
declare
  v_function text;
  v_old text := $old$if not iam.actor_can_write(p_actor_id, v_po.company_id) then raise exception 'Actor cannot update this company'; end if;$old$;
  v_new text := $new$if not iam.actor_can_approve(p_actor_id, v_po.company_id) then raise exception 'Approval access is required to accept or reject this PO'; end if;$new$;
begin
  select pg_get_functiondef('scm.record_acceptance(uuid,text,text,uuid,text)'::regprocedure)
    into v_function;
  if position(v_old in v_function) = 0 then
    raise exception 'Expected acceptance permission guard was not found';
  end if;
  execute replace(v_function, v_old, v_new);
end $$;

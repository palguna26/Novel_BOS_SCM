-- Transaction-safe workflow functions and database protections.

create table platform.document_sequences (
  company_id uuid not null references master_data.companies(id) on delete restrict,
  document_type text not null,
  financial_year text not null,
  prefix text not null,
  last_number bigint not null default 0 check (last_number >= 0),
  primary key (company_id, document_type, financial_year)
);

create or replace function iam.actor_can_write(p_actor_id uuid, p_company_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, iam
as $$
  select exists (
    select 1
    from iam.users u
    join iam.user_company_access a on a.user_id = u.id
    where u.id = p_actor_id
      and a.company_id = p_company_id
      and (auth.uid() is null or auth.uid() = p_actor_id)
      and u.active
      and a.can_write
      and u.role <> 'QC'
  );
$$;

create or replace function iam.actor_can_approve(p_actor_id uuid, p_company_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, iam
as $$
  select exists (
    select 1
    from iam.users u
    join iam.user_company_access a on a.user_id = u.id
    where u.id = p_actor_id
      and a.company_id = p_company_id
      and (auth.uid() is null or auth.uid() = p_actor_id)
      and u.active
      and a.can_approve
      and u.role in ('MANAGER','ADMIN','SUPER_ADMIN','QA','FINANCE')
  );
$$;

create or replace function platform.next_document_number(
  p_company_id uuid,
  p_document_type text,
  p_document_date date default current_date
)
returns text
language plpgsql
security definer
set search_path = pg_catalog, platform
as $$
declare
  v_financial_year text;
  v_prefix text;
  v_number bigint;
begin
  v_financial_year := case
    when extract(month from p_document_date) >= 4
      then extract(year from p_document_date)::int::text || '-' || right((extract(year from p_document_date)::int + 1)::text, 2)
    else (extract(year from p_document_date)::int - 1)::text || '-' || right(extract(year from p_document_date)::int::text, 2)
  end;
  v_prefix := upper(left(p_document_type, 4));

  insert into platform.document_sequences(company_id, document_type, financial_year, prefix, last_number)
  values (p_company_id, p_document_type, v_financial_year, v_prefix, 1)
  on conflict (company_id, document_type, financial_year)
  do update set last_number = platform.document_sequences.last_number + 1
  returning last_number into v_number;

  return v_prefix || '-' || v_financial_year || '-' || lpad(v_number::text, 6, '0');
end;
$$;

create or replace function platform.write_audit(
  p_company_id uuid,
  p_actor_id uuid,
  p_action text,
  p_entity_type text,
  p_entity_id uuid,
  p_old_value jsonb default null,
  p_new_value jsonb default null,
  p_reason text default null,
  p_source text default 'DATABASE'
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, platform, iam
as $$
declare
  v_id uuid;
  v_role text;
begin
  select role into v_role from iam.users where id = p_actor_id;
  insert into platform.audit_events(
    company_id, actor_id, actor_role, action, entity_type, entity_id,
    old_value, new_value, reason, source
  ) values (
    p_company_id, p_actor_id, v_role, p_action, p_entity_type, p_entity_id,
    p_old_value, p_new_value, p_reason, p_source
  ) returning id into v_id;
  return v_id;
end;
$$;

create or replace function platform.finish_idempotency(
  p_company_id uuid,
  p_operation text,
  p_idempotency_key text,
  p_result jsonb
)
returns void
language sql
security definer
set search_path = pg_catalog, platform
as $$
  update platform.idempotency_keys
  set status = 'COMPLETED', result = p_result, completed_at = statement_timestamp()
  where company_id = p_company_id
    and operation = p_operation
    and idempotency_key = p_idempotency_key;
$$;

create or replace function platform.claim_idempotency(
  p_company_id uuid,
  p_operation text,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, platform
as $$
declare
  v_inserted boolean := false;
  v_status text;
  v_result jsonb;
begin
  insert into platform.idempotency_keys(company_id, operation, idempotency_key)
  values (p_company_id, p_operation, p_idempotency_key)
  on conflict (company_id, operation, idempotency_key) do nothing
  returning true into v_inserted;

  if v_inserted then return null; end if;
  select status, result into v_status, v_result
  from platform.idempotency_keys
  where company_id = p_company_id and operation = p_operation and idempotency_key = p_idempotency_key;
  if v_status = 'COMPLETED' and v_result is not null then return v_result; end if;
  raise exception 'Operation % with this idempotency key is already in progress', p_operation;
end;
$$;

create or replace function inventory.assert_stock_transaction_balanced()
returns trigger
language plpgsql
set search_path = pg_catalog, inventory
as $$
begin
  if exists (
    select 1
    from inventory.stock_ledger_entries e
    where e.stock_transaction_id = new.stock_transaction_id
    group by e.item_id, e.batch_id, e.uom_id
    having abs(sum(e.quantity_delta)) > 0.000001
  ) then
    raise exception 'Stock transaction % is not quantity-balanced', new.stock_transaction_id;
  end if;
  return null;
end;
$$;

create constraint trigger stock_transaction_balanced
after insert on inventory.stock_ledger_entries
deferrable initially deferred
for each row execute function inventory.assert_stock_transaction_balanced();

create or replace function inventory.prevent_negative_internal_stock()
returns trigger
language plpgsql
set search_path = pg_catalog, inventory, master_data
as $$
declare
  v_balance numeric(18,6);
  v_location_type text;
begin
  select location_type into v_location_type
  from master_data.locations
  where id = new.location_id;

  if v_location_type not in ('CUSTOMER','EXTERNAL_SOURCE','EXTERNAL_SINK') then
    select coalesce(sum(e.quantity_delta), 0)
    into v_balance
    from inventory.stock_ledger_entries e
    join inventory.stock_transactions t on t.id = e.stock_transaction_id
    where t.status = 'POSTED'
      and e.company_id = new.company_id
      and e.location_id = new.location_id
      and e.item_id = new.item_id
      and e.batch_id is not distinct from new.batch_id
      and e.stock_state = new.stock_state
      and e.uom_id = new.uom_id;

    if v_balance < -0.000001 then
      raise exception 'Stock cannot become negative for location %, item %, state %', new.location_id, new.item_id, new.stock_state;
    end if;
  end if;
  return null;
end;
$$;

create constraint trigger stock_nonnegative
after insert on inventory.stock_ledger_entries
deferrable initially deferred
for each row execute function inventory.prevent_negative_internal_stock();

create or replace function master_data.enforce_item_activation()
returns trigger
language plpgsql
set search_path = pg_catalog, master_data, quality
as $$
begin
  if new.lifecycle_status = 'ACTIVE'
     and (tg_op = 'INSERT' or old.lifecycle_status is distinct from 'ACTIVE') then
    if (select count(*) from master_data.item_approvals a where a.item_id = new.id and a.decision = 'APPROVED') <> 4 then
      raise exception 'Item requires Category/NPD, Costing, QA and Finance approval before activation';
    end if;
    if new.inspection_plan_required and not exists (
      select 1 from quality.inspection_plans p
      where p.item_id = new.id and p.status = 'ACTIVE'
        and p.effective_from <= current_date
        and (p.effective_to is null or p.effective_to >= current_date)
    ) then
      raise exception 'Item requires an active inspection plan before activation';
    end if;
  end if;
  return new;
end;
$$;

create trigger items_activation_guard
before insert or update of lifecycle_status on master_data.items
for each row execute function master_data.enforce_item_activation();

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
  from scm.purchase_order_lines where purchase_order_id = p_purchase_order_id;
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
  v_result jsonb;
begin
  select * into v_po from scm.purchase_orders where id = p_purchase_order_id for update;
  if not found then raise exception 'Purchase order not found'; end if;
  if not iam.actor_can_write(p_actor_id, v_po.company_id) then raise exception 'Actor cannot reserve stock for this company'; end if;

  select result into v_existing from platform.idempotency_keys
  where company_id = v_po.company_id and operation = 'CREATE_RESERVATION' and idempotency_key = p_idempotency_key;
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
  if not exists (select 1 from scm.purchase_order_lines where purchase_order_id = p_purchase_order_id) then
    raise exception 'Purchase order has no lines';
  end if;

  v_existing := platform.claim_idempotency(v_po.company_id, 'CREATE_RESERVATION', p_idempotency_key);
  if v_existing is not null then return v_existing; end if;

  select coalesce(max(version), 0) + 1 into v_version
  from inventory.reservations where purchase_order_id = p_purchase_order_id;

  insert into inventory.reservations(
    company_id, purchase_order_id, version, source_site_id, source_location_id,
    idempotency_key, created_by
  ) values (
    v_po.company_id, p_purchase_order_id, v_version, v_po.source_site_id,
    v_po.source_location_id, p_idempotency_key, p_actor_id
  ) returning id into v_reservation_id;

  insert into inventory.stock_transactions(
    company_id, transaction_type, document_type, document_id, document_number,
    idempotency_key, posted_by
  ) values (
    v_po.company_id, 'RESERVE', 'SCM_RESERVATION', v_reservation_id,
    v_po.external_id, p_idempotency_key || ':ledger', p_actor_id
  ) returning id into v_transaction_id;

  for v_line in
    select pol.*, i.batch_controlled
    from scm.purchase_order_lines pol
    join master_data.items i on i.id = pol.item_id
    where pol.purchase_order_id = p_purchase_order_id
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
  perform platform.finish_idempotency(v_po.company_id, 'CREATE_RESERVATION', p_idempotency_key, v_result);
  return v_result;
end;
$$;

create or replace function scm.record_acceptance(
  p_purchase_order_id uuid,
  p_decision text,
  p_reason text,
  p_actor_id uuid,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, scm, platform, iam
as $$
declare
  v_po scm.purchase_orders%rowtype;
  v_existing jsonb;
  v_old jsonb;
  v_decision_id uuid;
  v_result jsonb;
begin
  if p_decision not in ('ACCEPTED','REJECTED') then raise exception 'Invalid acceptance decision'; end if;
  if p_decision = 'REJECTED' and nullif(trim(p_reason), '') is null then raise exception 'Rejection reason is required'; end if;

  select * into v_po from scm.purchase_orders where id = p_purchase_order_id for update;
  if not found then raise exception 'Purchase order not found'; end if;
  if not iam.actor_can_write(p_actor_id, v_po.company_id) then raise exception 'Actor cannot update this company'; end if;
  if p_decision = 'REJECTED' and exists (
    select 1 from inventory.reservations
    where purchase_order_id = p_purchase_order_id and status in ('ACTIVE','PARTIALLY_DISPATCHED','FULFILLED')
  ) then raise exception 'Release or reverse the active reservation before rejecting the PO'; end if;

  select result into v_existing from platform.idempotency_keys
  where company_id = v_po.company_id and operation = 'RECORD_ACCEPTANCE' and idempotency_key = p_idempotency_key;
  if found and v_existing is not null then return v_existing; end if;

  v_existing := platform.claim_idempotency(v_po.company_id, 'RECORD_ACCEPTANCE', p_idempotency_key);
  if v_existing is not null then return v_existing; end if;

  select to_jsonb(a) into v_old from scm.acceptance_decisions a
  where a.purchase_order_id = p_purchase_order_id and a.active for update;
  update scm.acceptance_decisions set active = false
  where purchase_order_id = p_purchase_order_id and active;

  insert into scm.acceptance_decisions(
    company_id, purchase_order_id, decision, reason, decided_by,
    supersedes_decision_id, idempotency_key
  ) values (
    v_po.company_id, p_purchase_order_id, p_decision, p_reason, p_actor_id,
    (v_old->>'id')::uuid, p_idempotency_key
  ) returning id into v_decision_id;

  if p_decision = 'REJECTED' then
    update scm.purchase_orders set status = 'REJECTED' where id = p_purchase_order_id;
  else
    perform scm.refresh_po_status(p_purchase_order_id);
    perform scm.try_create_reservation(p_purchase_order_id, p_actor_id, 'AUTO-RESERVE:' || p_purchase_order_id::text);
  end if;

  select to_jsonb(a) into v_result from scm.acceptance_decisions a where a.id = v_decision_id;
  perform platform.write_audit(v_po.company_id, p_actor_id, 'PO_' || p_decision, 'SCM_PURCHASE_ORDER', p_purchase_order_id, v_old, v_result, p_reason);
  perform platform.finish_idempotency(v_po.company_id, 'RECORD_ACCEPTANCE', p_idempotency_key, v_result);
  return v_result;
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
set search_path = pg_catalog, scm, documents, platform, iam
as $$
declare
  v_po scm.purchase_orders%rowtype;
  v_existing jsonb;
  v_old_id uuid;
  v_appointment_id uuid;
  v_result jsonb;
begin
  if p_match_status not in ('PENDING','MATCHED','MISMATCHED','WAIVED') then raise exception 'Invalid appointment match status'; end if;
  if p_appointment_at is null then raise exception 'Appointment time is required'; end if;
  if p_match_status = 'MATCHED' and p_document_version_id is null then raise exception 'Matched appointment requires a document version'; end if;

  select * into v_po from scm.purchase_orders where id = p_purchase_order_id for update;
  if not found then raise exception 'Purchase order not found'; end if;
  if not iam.actor_can_write(p_actor_id, v_po.company_id) then raise exception 'Actor cannot update this company'; end if;
  if p_match_status = 'WAIVED' and not iam.actor_can_approve(p_actor_id, v_po.company_id) then
    raise exception 'Appointment-match waiver requires approval';
  end if;
  if p_match_status not in ('MATCHED','WAIVED') and exists (
    select 1 from inventory.reservations
    where purchase_order_id = p_purchase_order_id and status in ('ACTIVE','PARTIALLY_DISPATCHED','FULFILLED')
  ) then raise exception 'Release or reverse the active reservation before replacing the matched appointment'; end if;
  if p_document_version_id is not null and not exists (
    select 1 from documents.document_versions where id = p_document_version_id and company_id = v_po.company_id
  ) then raise exception 'Appointment document does not belong to the company'; end if;

  select result into v_existing from platform.idempotency_keys
  where company_id = v_po.company_id and operation = 'RECORD_APPOINTMENT' and idempotency_key = p_idempotency_key;
  if found and v_existing is not null then return v_existing; end if;

  v_existing := platform.claim_idempotency(v_po.company_id, 'RECORD_APPOINTMENT', p_idempotency_key);
  if v_existing is not null then return v_existing; end if;

  select id into v_old_id from scm.appointments
  where purchase_order_id = p_purchase_order_id and active for update;
  update scm.appointments set active = false, status = 'REPLACED'
  where purchase_order_id = p_purchase_order_id and active;

  insert into scm.appointments(
    company_id, purchase_order_id, appointment_number, appointment_at,
    location_name, status, match_status, match_details,
    supersedes_appointment_id, created_by, idempotency_key
  ) values (
    v_po.company_id, p_purchase_order_id, p_appointment_number, p_appointment_at,
    p_location_name, case when p_match_status = 'MATCHED' then 'MATCHED' else 'BOOKED' end,
    p_match_status, coalesce(p_match_details, '{}'::jsonb), v_old_id, p_actor_id, p_idempotency_key
  ) returning id into v_appointment_id;

  if p_document_version_id is not null then
    insert into scm.appointment_documents(company_id, appointment_id, document_version_id)
    values (v_po.company_id, v_appointment_id, p_document_version_id);
  end if;

  perform scm.refresh_po_status(p_purchase_order_id);
  if p_match_status in ('MATCHED','WAIVED') then
    perform scm.try_create_reservation(p_purchase_order_id, p_actor_id, 'AUTO-RESERVE:' || p_purchase_order_id::text);
  end if;

  select to_jsonb(a) into v_result from scm.appointments a where a.id = v_appointment_id;
  perform platform.write_audit(v_po.company_id, p_actor_id, 'APPOINTMENT_RECORDED', 'SCM_APPOINTMENT', v_appointment_id, null, v_result);
  perform platform.finish_idempotency(v_po.company_id, 'RECORD_APPOINTMENT', p_idempotency_key, v_result);
  return v_result;
end;
$$;

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

  select result into v_existing from platform.idempotency_keys
  where company_id = v_company_id and operation = 'CREATE_PURCHASE_ORDER' and idempotency_key = p_idempotency_key;
  if found and v_existing is not null then return v_existing; end if;

  if exists (
    select 1 from scm.purchase_orders
    where company_id = v_company_id and channel_id = v_channel_id and external_id = p_payload->>'externalId'
      and status not in ('CANCELLED','CLOSED')
  ) then raise exception 'Duplicate channel purchase order'; end if;

  select dm.* into v_mapping
  from master_data.destination_mappings dm
  where dm.company_id = v_company_id
    and dm.channel_id = v_channel_id
    and lower(dm.destination_key) = lower(p_payload->>'destination')
    and dm.active
  limit 1;

  v_existing := platform.claim_idempotency(v_company_id, 'CREATE_PURCHASE_ORDER', p_idempotency_key);
  if v_existing is not null then return v_existing; end if;

  insert into scm.purchase_orders(
    company_id, channel_id, external_id, po_date, deadline, destination_key,
    destination_name, customer_name, source_site_id, source_location_id,
    currency, total_value, status, source_document_version_id, created_by
  ) values (
    v_company_id, v_channel_id, p_payload->>'externalId', (p_payload->>'poDate')::timestamptz,
    nullif(p_payload->>'deadline', '')::timestamptz, p_payload->>'destination',
    coalesce(nullif(p_payload->>'destinationName', ''), p_payload->>'destination'),
    nullif(p_payload->>'customer', ''), v_mapping.source_site_id, v_mapping.source_location_id,
    coalesce(nullif(p_payload->>'currency', ''), 'INR'), coalesce((p_payload->>'totalValue')::numeric, 0),
    case when v_mapping.id is null then 'WAREHOUSE_MAPPING_REQUIRED' else 'UNDER_REVIEW' end,
    nullif(p_payload->>'documentVersionId', '')::uuid, p_actor_id
  ) returning id into v_po_id;

  for v_line in select value from jsonb_array_elements(coalesce(p_payload->'lines', '[]'::jsonb))
  loop
    v_line_number := v_line_number + 1;
    select * into v_item from master_data.items
    where id = (v_line->>'itemId')::uuid and company_id = v_company_id and lifecycle_status = 'ACTIVE';
    if not found then raise exception 'PO line % has an invalid or inactive item', v_line_number; end if;
    if coalesce((v_line->>'ordered')::numeric, 0) <= 0 then raise exception 'PO line % quantity must be positive', v_line_number; end if;
    insert into scm.purchase_order_lines(
      company_id, purchase_order_id, line_number, item_id, channel_item_code,
      description, ordered_quantity, uom_id, unit_price, tax_rate,
      delivery_window_start, delivery_window_end, minimum_residual_shelf_life_days
    ) values (
      v_company_id, v_po_id, coalesce((v_line->>'lineNumber')::integer, v_line_number), v_item.id,
      nullif(v_line->>'channelItemCode', ''), nullif(v_line->>'description', ''),
      (v_line->>'ordered')::numeric, coalesce(nullif(v_line->>'uomId', '')::uuid, v_item.base_uom_id),
      coalesce((v_line->>'unitPrice')::numeric, 0), coalesce((v_line->>'taxRate')::numeric, 0),
      nullif(v_line->>'deliveryWindowStart', '')::timestamptz,
      nullif(v_line->>'deliveryWindowEnd', '')::timestamptz,
      coalesce((v_line->>'minimumResidualShelfLifeDays')::integer, 0)
    );
  end loop;
  if v_line_number = 0 then raise exception 'Purchase order requires at least one line'; end if;

  select to_jsonb(po) into v_result from scm.purchase_orders po where po.id = v_po_id;
  perform platform.write_audit(v_company_id, p_actor_id, 'PO_CREATED', 'SCM_PURCHASE_ORDER', v_po_id, null, v_result);
  perform platform.finish_idempotency(v_company_id, 'CREATE_PURCHASE_ORDER', p_idempotency_key, v_result);
  return v_result;
end;
$$;

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
begin
  select * into v_po from scm.purchase_orders where id = p_purchase_order_id for update;
  if not found then raise exception 'Purchase order not found'; end if;
  if not iam.actor_can_write(p_actor_id, v_po.company_id) then raise exception 'Actor cannot create a shipment for this company'; end if;

  select result into v_existing from platform.idempotency_keys
  where company_id = v_po.company_id and operation = 'CREATE_SHIPMENT' and idempotency_key = p_idempotency_key;
  if found and v_existing is not null then return v_existing; end if;

  select * into v_reservation from inventory.reservations
  where purchase_order_id = p_purchase_order_id and status in ('ACTIVE','PARTIALLY_DISPATCHED') for update;
  if not found then raise exception 'An active reservation is required'; end if;
  select * into v_appointment from scm.appointments
  where purchase_order_id = p_purchase_order_id and active
    and match_status in ('MATCHED','WAIVED') and status not in ('CANCELLED','REPLACED');
  if not found then raise exception 'A matched appointment is required'; end if;

  select * into v_transit_location from master_data.locations
  where company_id = v_po.company_id and location_type = 'TRANSIT' and active
  order by created_at limit 1;
  if not found then raise exception 'A company transit location is required'; end if;

  select * into v_route from master_data.routes
  where company_id = v_po.company_id and source_site_id = v_po.source_site_id
    and destination_key = v_po.destination_key and active limit 1;

  v_existing := platform.claim_idempotency(v_po.company_id, 'CREATE_SHIPMENT', p_idempotency_key);
  if v_existing is not null then return v_existing; end if;

  v_number := platform.next_document_number(v_po.company_id, 'SHIPMENT', current_date);
  insert into scm.shipments(
    company_id, shipment_number, purchase_order_id, reservation_id, appointment_id,
    source_site_id, source_location_id, transit_location_id, destination_name,
    truck_number, truck_type, truck_capacity, driver_name, driver_phone,
    planned_dispatch_at, expected_arrival_at, estimated_cost, route_snapshot,
    idempotency_key, created_by
  ) values (
    v_po.company_id, v_number, p_purchase_order_id, v_reservation.id, v_appointment.id,
    v_po.source_site_id, v_po.source_location_id, v_transit_location.id, v_po.destination_name,
    nullif(p_vehicle->>'truckNumber', ''), nullif(p_vehicle->>'truckType', ''),
    nullif(p_vehicle->>'truckCapacity', '')::numeric, nullif(p_vehicle->>'driverName', ''),
    nullif(p_vehicle->>'driverPhone', ''), nullif(p_vehicle->>'plannedDispatchAt', '')::timestamptz,
    coalesce(nullif(p_vehicle->>'expectedArrivalAt', '')::timestamptz,
      case when v_route.id is null then null else statement_timestamp() + make_interval(hours => v_route.transit_hours) end),
    coalesce(v_route.estimated_cost, 0), coalesce(to_jsonb(v_route), '{}'::jsonb), p_idempotency_key, p_actor_id
  ) returning id into v_shipment_id;

  if jsonb_array_length(coalesce(p_lines, '[]'::jsonb)) = 0 then raise exception 'Shipment requires at least one line'; end if;
  for v_line in select value from jsonb_array_elements(p_lines)
  loop
    v_planned := coalesce((v_line->>'planned')::numeric, 0);
    if v_planned <= 0 then raise exception 'Shipment line quantity must be positive'; end if;
    select rl.* into v_reservation_line
    from inventory.reservation_lines rl
    where rl.reservation_id = v_reservation.id
      and rl.purchase_order_line_id = (v_line->>'poLineId')::uuid;
    if not found then raise exception 'Shipment line is not part of the active reservation'; end if;
    select coalesce(sum(sl.planned_quantity), 0) into v_already_planned
    from scm.shipment_lines sl join scm.shipments s on s.id = sl.shipment_id
    where sl.reservation_line_id = v_reservation_line.id and s.status <> 'CANCELLED';
    if v_already_planned + v_planned > v_reservation_line.reserved_quantity then
      raise exception 'Shipment quantity exceeds the reserved balance';
    end if;
    insert into scm.shipment_lines(
      company_id, shipment_id, purchase_order_line_id, reservation_line_id,
      planned_quantity, uom_id
    ) values (
      v_po.company_id, v_shipment_id, v_reservation_line.purchase_order_line_id,
      v_reservation_line.id, v_planned, v_reservation_line.uom_id
    );
  end loop;

  perform scm.refresh_po_status(p_purchase_order_id);
  select to_jsonb(s) into v_result from scm.shipments s where s.id = v_shipment_id;
  perform platform.write_audit(v_po.company_id, p_actor_id, 'SHIPMENT_CREATED', 'SCM_SHIPMENT', v_shipment_id, null, v_result);
  perform platform.finish_idempotency(v_po.company_id, 'CREATE_SHIPMENT', p_idempotency_key, v_result);
  return v_result;
end;
$$;

create or replace function scm.dispatch_shipment(
  p_shipment_id uuid,
  p_actor_id uuid,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, scm, inventory, master_data, platform, iam
as $$
declare
  v_shipment scm.shipments%rowtype;
  v_transit_site_id uuid;
  v_line record;
  v_allocation record;
  v_remaining numeric(18,6);
  v_take numeric(18,6);
  v_transaction_id uuid;
  v_entry_number integer := 0;
  v_existing jsonb;
  v_result jsonb;
begin
  select * into v_shipment from scm.shipments where id = p_shipment_id for update;
  if not found then raise exception 'Shipment not found'; end if;
  if not iam.actor_can_write(p_actor_id, v_shipment.company_id) then raise exception 'Actor cannot dispatch this shipment'; end if;
  if v_shipment.dispatch_stock_transaction_id is not null then
    select to_jsonb(s) into v_result from scm.shipments s where s.id = p_shipment_id;
    return v_result;
  end if;
  if v_shipment.status not in ('PLANNED','VEHICLE_ASSIGNED','LOADING') then raise exception 'Shipment cannot be dispatched from status %', v_shipment.status; end if;
  if exists (
    select 1
    from scm.purchase_orders po
    join scm.purchase_order_lines pol on pol.purchase_order_id = po.id
    join master_data.channel_policies cp on cp.channel_id = po.channel_id and (cp.item_id is null or cp.item_id = pol.item_id)
    where po.id = v_shipment.purchase_order_id and cp.pdi_required
      and cp.effective_from <= current_date and (cp.effective_to is null or cp.effective_to >= current_date)
  ) and not exists (
    select 1 from scm.shipment_checks c where c.shipment_id = p_shipment_id and c.check_type = 'PDI' and c.result in ('PASSED','WAIVED')
  ) then raise exception 'Passed PDI is required before dispatch'; end if;

  select site_id into v_transit_site_id from master_data.locations where id = v_shipment.transit_location_id;
  select result into v_existing from platform.idempotency_keys
  where company_id = v_shipment.company_id and operation = 'DISPATCH_SHIPMENT' and idempotency_key = p_idempotency_key;
  if found and v_existing is not null then return v_existing; end if;
  v_existing := platform.claim_idempotency(v_shipment.company_id, 'DISPATCH_SHIPMENT', p_idempotency_key);
  if v_existing is not null then return v_existing; end if;

  insert into inventory.stock_transactions(
    company_id, transaction_type, document_type, document_id, document_number,
    idempotency_key, posted_by
  ) values (
    v_shipment.company_id, 'DISPATCH', 'SCM_SHIPMENT', p_shipment_id,
    v_shipment.shipment_number, p_idempotency_key || ':ledger', p_actor_id
  ) returning id into v_transaction_id;

  for v_line in
    select sl.*, pol.item_id
    from scm.shipment_lines sl
    join scm.purchase_order_lines pol on pol.id = sl.purchase_order_line_id
    where sl.shipment_id = p_shipment_id
    order by sl.id
  loop
    v_remaining := v_line.planned_quantity;
    for v_allocation in
      select ra.*
      from inventory.reservation_allocations ra
      where ra.reservation_line_id = v_line.reservation_line_id
        and ra.quantity > ra.dispatched_quantity + ra.released_quantity
      order by ra.id
      for update
    loop
      exit when v_remaining <= 0;
      v_take := least(v_remaining, v_allocation.quantity - v_allocation.dispatched_quantity - v_allocation.released_quantity);
      update inventory.reservation_allocations
      set dispatched_quantity = dispatched_quantity + v_take where id = v_allocation.id;
      insert into scm.shipment_line_allocations(
        company_id, shipment_line_id, reservation_allocation_id, batch_id,
        source_location_id, dispatched_quantity
      ) values (
        v_shipment.company_id, v_line.id, v_allocation.id, v_allocation.batch_id,
        v_allocation.location_id, v_take
      );
      v_entry_number := v_entry_number + 1;
      insert into inventory.stock_ledger_entries(
        company_id, stock_transaction_id, line_number, site_id, location_id,
        item_id, batch_id, stock_state, uom_id, quantity_delta
      ) values (
        v_shipment.company_id, v_transaction_id, v_entry_number, v_shipment.source_site_id,
        v_allocation.location_id, v_line.item_id, v_allocation.batch_id, 'RESERVED', v_line.uom_id, -v_take
      );
      v_entry_number := v_entry_number + 1;
      insert into inventory.stock_ledger_entries(
        company_id, stock_transaction_id, line_number, site_id, location_id,
        item_id, batch_id, stock_state, uom_id, quantity_delta
      ) values (
        v_shipment.company_id, v_transaction_id, v_entry_number, v_transit_site_id,
        v_shipment.transit_location_id, v_line.item_id, v_allocation.batch_id, 'IN_TRANSIT', v_line.uom_id, v_take
      );
      v_remaining := v_remaining - v_take;
    end loop;
    if v_remaining > 0 then raise exception 'Reserved stock is no longer available for shipment line %', v_line.id; end if;
    update scm.shipment_lines set dispatched_quantity = planned_quantity where id = v_line.id;
  end loop;

  update scm.shipments
  set status = 'IN_TRANSIT', actual_dispatch_at = statement_timestamp(), dispatch_stock_transaction_id = v_transaction_id
  where id = p_shipment_id;
  update inventory.reservations set status = 'PARTIALLY_DISPATCHED' where id = v_shipment.reservation_id and status = 'ACTIVE';
  insert into scm.shipment_events(company_id, shipment_id, status, event_at, entered_by)
  values (v_shipment.company_id, p_shipment_id, 'IN_TRANSIT', statement_timestamp(), p_actor_id);
  perform scm.refresh_po_status(v_shipment.purchase_order_id);
  select to_jsonb(s) into v_result from scm.shipments s where s.id = p_shipment_id;
  perform platform.write_audit(v_shipment.company_id, p_actor_id, 'SHIPMENT_DISPATCHED', 'SCM_SHIPMENT', p_shipment_id, null, v_result);
  perform platform.finish_idempotency(v_shipment.company_id, 'DISPATCH_SHIPMENT', p_idempotency_key, v_result);
  return v_result;
end;
$$;

create or replace function scm.record_pod(
  p_purchase_order_id uuid,
  p_document_version_id uuid,
  p_delivery_at timestamptz,
  p_receiver_name text,
  p_lines jsonb,
  p_actor_id uuid,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, scm, inventory, master_data, documents, platform, iam
as $$
declare
  v_po scm.purchase_orders%rowtype;
  v_customer_location master_data.locations%rowtype;
  v_line jsonb;
  v_shipment_line scm.shipment_lines%rowtype;
  v_shipment scm.shipments%rowtype;
  v_allocation record;
  v_confirmed numeric(18,6);
  v_short numeric(18,6);
  v_damaged numeric(18,6);
  v_rejected numeric(18,6);
  v_outstanding numeric(18,6);
  v_remaining numeric(18,6);
  v_take numeric(18,6);
  v_pod_id uuid;
  v_pod_line_id uuid;
  v_transaction_id uuid;
  v_entry_number integer := 0;
  v_existing jsonb;
  v_result jsonb;
begin
  select * into v_po from scm.purchase_orders where id = p_purchase_order_id for update;
  if not found then raise exception 'Purchase order not found'; end if;
  if not iam.actor_can_write(p_actor_id, v_po.company_id) then raise exception 'Actor cannot record POD for this company'; end if;
  if not exists (
    select 1 from documents.document_versions where id = p_document_version_id and company_id = v_po.company_id
  ) then raise exception 'POD document version is required and must belong to the company'; end if;

  select result into v_existing from platform.idempotency_keys
  where company_id = v_po.company_id and operation = 'RECORD_POD' and idempotency_key = p_idempotency_key;
  if found and v_existing is not null then return v_existing; end if;
  select to_jsonb(p) into v_existing from scm.pods p where p.document_version_id = p_document_version_id;
  if v_existing is not null then return v_existing; end if;

  select * into v_customer_location from master_data.locations
  where company_id = v_po.company_id and location_type = 'CUSTOMER' and active
  order by created_at limit 1;
  if not found then raise exception 'A company customer location is required'; end if;

  v_existing := platform.claim_idempotency(v_po.company_id, 'RECORD_POD', p_idempotency_key);
  if v_existing is not null then return v_existing; end if;

  insert into scm.pods(
    company_id, purchase_order_id, document_version_id, delivery_at,
    receiver_name, idempotency_key, confirmed_by
  ) values (
    v_po.company_id, p_purchase_order_id, p_document_version_id, p_delivery_at,
    p_receiver_name, p_idempotency_key, p_actor_id
  ) returning id into v_pod_id;

  insert into inventory.stock_transactions(
    company_id, transaction_type, document_type, document_id, document_number,
    idempotency_key, posted_by
  ) values (
    v_po.company_id, 'DELIVERY', 'SCM_POD', v_pod_id, v_po.external_id,
    p_idempotency_key || ':ledger', p_actor_id
  ) returning id into v_transaction_id;

  if jsonb_array_length(coalesce(p_lines, '[]'::jsonb)) = 0 then raise exception 'POD requires at least one line'; end if;
  for v_line in select value from jsonb_array_elements(p_lines)
  loop
    select * into v_shipment_line from scm.shipment_lines
    where id = (v_line->>'shipmentLineId')::uuid for update;
    if not found then raise exception 'POD shipment line not found'; end if;
    select * into v_shipment from scm.shipments
    where id = v_shipment_line.shipment_id and purchase_order_id = p_purchase_order_id for update;
    if not found or v_shipment.status in ('PLANNED','VEHICLE_ASSIGNED','LOADING','CANCELLED') then
      raise exception 'POD line does not belong to a dispatched shipment for this PO';
    end if;

    v_confirmed := coalesce((v_line->>'confirmed')::numeric, 0);
    v_short := coalesce((v_line->>'short')::numeric, 0);
    v_damaged := coalesce((v_line->>'damaged')::numeric, 0);
    v_rejected := coalesce((v_line->>'rejected')::numeric, 0);
    if least(v_confirmed, v_short, v_damaged, v_rejected) < 0 then raise exception 'POD quantities cannot be negative'; end if;
    v_outstanding := v_shipment_line.dispatched_quantity
      - v_shipment_line.delivered_quantity
      - v_shipment_line.damaged_quantity
      - v_shipment_line.rejected_quantity;
    if v_confirmed + v_short + v_damaged + v_rejected > v_outstanding then
      raise exception 'POD quantities exceed outstanding dispatched quantity';
    end if;

    insert into scm.pod_lines(
      company_id, pod_id, shipment_line_id, confirmed_quantity, short_quantity,
      damaged_quantity, rejected_quantity, difference_reason, notes
    ) values (
      v_po.company_id, v_pod_id, v_shipment_line.id, v_confirmed, v_short,
      v_damaged, v_rejected, nullif(v_line->>'differenceReason', ''), nullif(v_line->>'notes', '')
    ) returning id into v_pod_line_id;
    insert into scm.pod_shipment_links(company_id, pod_id, shipment_id)
    values (v_po.company_id, v_pod_id, v_shipment.id)
    on conflict do nothing;

    v_remaining := v_confirmed;
    for v_allocation in
      select sla.*, pol.item_id, sl.uom_id
      from scm.shipment_line_allocations sla
      join scm.shipment_lines sl on sl.id = sla.shipment_line_id
      join scm.purchase_order_lines pol on pol.id = sl.purchase_order_line_id
      where sla.shipment_line_id = v_shipment_line.id
        and sla.dispatched_quantity > sla.delivered_quantity
      order by sla.id
      for update of sla
    loop
      exit when v_remaining <= 0;
      v_take := least(v_remaining, v_allocation.dispatched_quantity - v_allocation.delivered_quantity);
      update scm.shipment_line_allocations
      set delivered_quantity = delivered_quantity + v_take where id = v_allocation.id;
      v_entry_number := v_entry_number + 1;
      insert into inventory.stock_ledger_entries(
        company_id, stock_transaction_id, line_number, site_id, location_id,
        item_id, batch_id, stock_state, uom_id, quantity_delta
      ) values (
        v_po.company_id, v_transaction_id, v_entry_number,
        (select site_id from master_data.locations where id = v_shipment.transit_location_id),
        v_shipment.transit_location_id, v_allocation.item_id, v_allocation.batch_id,
        'IN_TRANSIT', v_allocation.uom_id, -v_take
      );
      v_entry_number := v_entry_number + 1;
      insert into inventory.stock_ledger_entries(
        company_id, stock_transaction_id, line_number, site_id, location_id,
        item_id, batch_id, stock_state, uom_id, quantity_delta
      ) values (
        v_po.company_id, v_transaction_id, v_entry_number, v_customer_location.site_id,
        v_customer_location.id, v_allocation.item_id, v_allocation.batch_id,
        'DELIVERED', v_allocation.uom_id, v_take
      );
      v_remaining := v_remaining - v_take;
    end loop;
    if v_remaining > 0 then raise exception 'Confirmed POD quantity exceeds tracked in-transit allocation'; end if;

    update scm.shipment_lines
    set delivered_quantity = delivered_quantity + v_confirmed,
        damaged_quantity = damaged_quantity + v_damaged,
        rejected_quantity = rejected_quantity + v_rejected
    where id = v_shipment_line.id;

    if v_short > 0 then
      insert into scm.delivery_exceptions(
        company_id, purchase_order_id, shipment_id, pod_line_id,
        exception_type, quantity, reason
      ) values (
        v_po.company_id, p_purchase_order_id, v_shipment.id, v_pod_line_id,
        'SHORT', v_short, coalesce(nullif(v_line->>'differenceReason', ''), 'Short delivery')
      );
    end if;
    if v_damaged > 0 then
      insert into scm.delivery_exceptions(
        company_id, purchase_order_id, shipment_id, pod_line_id,
        exception_type, quantity, reason
      ) values (
        v_po.company_id, p_purchase_order_id, v_shipment.id, v_pod_line_id,
        'DAMAGED', v_damaged, coalesce(nullif(v_line->>'differenceReason', ''), 'Damaged delivery')
      );
    end if;
    if v_rejected > 0 then
      insert into scm.delivery_exceptions(
        company_id, purchase_order_id, shipment_id, pod_line_id,
        exception_type, quantity, reason
      ) values (
        v_po.company_id, p_purchase_order_id, v_shipment.id, v_pod_line_id,
        'REJECTED', v_rejected, coalesce(nullif(v_line->>'differenceReason', ''), 'Rejected delivery')
      );
    end if;

    update scm.shipments s
    set status = case
      when exists (select 1 from scm.delivery_exceptions de where de.shipment_id = s.id and de.status in ('OPEN','INVESTIGATING')) then 'DELIVERY_ISSUE'
      when not exists (select 1 from scm.shipment_lines sl where sl.shipment_id = s.id and sl.delivered_quantity < sl.dispatched_quantity) then 'DELIVERED'
      else 'PARTIALLY_DELIVERED'
    end,
    actual_arrival_at = coalesce(s.actual_arrival_at, p_delivery_at, statement_timestamp())
    where s.id = v_shipment.id;
  end loop;

  update scm.pods set stock_transaction_id = v_transaction_id where id = v_pod_id;
  perform scm.refresh_po_status(p_purchase_order_id);
  select to_jsonb(p) into v_result from scm.pods p where p.id = v_pod_id;
  perform platform.write_audit(v_po.company_id, p_actor_id, 'POD_CONFIRMED', 'SCM_POD', v_pod_id, null, v_result);
  perform platform.finish_idempotency(v_po.company_id, 'RECORD_POD', p_idempotency_key, v_result);
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
     where pol.purchase_order_id = p_purchase_order_id)
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

create or replace function inventory.reverse_stock_transaction(
  p_stock_transaction_id uuid,
  p_reason text,
  p_actor_id uuid,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, inventory, platform, iam
as $$
declare
  v_original inventory.stock_transactions%rowtype;
  v_new_id uuid;
  v_entry record;
  v_existing jsonb;
  v_result jsonb;
begin
  if nullif(trim(p_reason), '') is null then raise exception 'Reversal reason is required'; end if;
  select * into v_original from inventory.stock_transactions where id = p_stock_transaction_id;
  if not found then raise exception 'Stock transaction not found'; end if;
  if not iam.actor_can_approve(p_actor_id, v_original.company_id) then raise exception 'Approval is required for stock reversal'; end if;
  if v_original.transaction_type = 'REVERSAL' then raise exception 'A reversal transaction cannot be reversed directly'; end if;
  select result into v_existing from platform.idempotency_keys
  where company_id = v_original.company_id and operation = 'REVERSE_STOCK_TRANSACTION' and idempotency_key = p_idempotency_key;
  if found and v_existing is not null then return v_existing; end if;
  if exists (select 1 from inventory.stock_transactions where reverses_transaction_id = p_stock_transaction_id) then
    raise exception 'Stock transaction already has a reversal';
  end if;

  v_existing := platform.claim_idempotency(v_original.company_id, 'REVERSE_STOCK_TRANSACTION', p_idempotency_key);
  if v_existing is not null then return v_existing; end if;
  insert into inventory.stock_transactions(
    company_id, transaction_type, document_type, document_id, document_number,
    reverses_transaction_id, reason, idempotency_key, posted_by
  ) values (
    v_original.company_id, 'REVERSAL', v_original.document_type, v_original.document_id,
    v_original.document_number, v_original.id, p_reason, p_idempotency_key || ':ledger', p_actor_id
  ) returning id into v_new_id;
  for v_entry in select * from inventory.stock_ledger_entries where stock_transaction_id = p_stock_transaction_id order by line_number
  loop
    insert into inventory.stock_ledger_entries(
      company_id, stock_transaction_id, line_number, site_id, location_id,
      item_id, batch_id, stock_state, uom_id, quantity_delta, unit_value, value_delta
    ) values (
      v_entry.company_id, v_new_id, v_entry.line_number, v_entry.site_id, v_entry.location_id,
      v_entry.item_id, v_entry.batch_id, v_entry.stock_state, v_entry.uom_id,
      -v_entry.quantity_delta, v_entry.unit_value, -v_entry.value_delta
    );
  end loop;
  select to_jsonb(t) into v_result from inventory.stock_transactions t where t.id = v_new_id;
  perform platform.write_audit(v_original.company_id, p_actor_id, 'STOCK_TRANSACTION_REVERSED', 'STOCK_TRANSACTION', p_stock_transaction_id, to_jsonb(v_original), v_result, p_reason);
  perform platform.finish_idempotency(v_original.company_id, 'REVERSE_STOCK_TRANSACTION', p_idempotency_key, v_result);
  return v_result;
end;
$$;

create or replace function scm.upload_invoice(
  p_purchase_order_id uuid,
  p_invoice_number text,
  p_invoice_date date,
  p_amount numeric,
  p_currency char(3),
  p_document_version_id uuid,
  p_recipients jsonb,
  p_actor_id uuid,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, scm, documents, platform, iam
as $$
declare
  v_po scm.purchase_orders%rowtype;
  v_invoice_id uuid;
  v_existing jsonb;
  v_result jsonb;
begin
  select * into v_po from scm.purchase_orders where id = p_purchase_order_id for update;
  if not found then raise exception 'Purchase order not found'; end if;
  if not iam.actor_can_write(p_actor_id, v_po.company_id) then raise exception 'Actor cannot upload an invoice for this company'; end if;
  if v_po.status not in ('FULLY_DELIVERED','SHORT_CLOSED') then raise exception 'Invoice is gated until full delivery or approved short close'; end if;
  if p_amount < 0 or nullif(trim(p_invoice_number), '') is null then raise exception 'Valid invoice number and amount are required'; end if;
  if not exists (select 1 from documents.document_versions where id = p_document_version_id and company_id = v_po.company_id) then
    raise exception 'Invoice document does not belong to the company';
  end if;
  select result into v_existing from platform.idempotency_keys
  where company_id = v_po.company_id and operation = 'UPLOAD_INVOICE' and idempotency_key = p_idempotency_key;
  if found and v_existing is not null then return v_existing; end if;
  if exists (select 1 from scm.invoices where purchase_order_id = p_purchase_order_id) then raise exception 'Only one invoice is allowed per channel PO'; end if;

  v_existing := platform.claim_idempotency(v_po.company_id, 'UPLOAD_INVOICE', p_idempotency_key);
  if v_existing is not null then return v_existing; end if;
  insert into scm.invoices(
    company_id, purchase_order_id, invoice_number, invoice_date, amount,
    currency, document_version_id, recipients, uploaded_by
  ) values (
    v_po.company_id, p_purchase_order_id, p_invoice_number, p_invoice_date, p_amount,
    coalesce(p_currency, 'INR'), p_document_version_id, coalesce(p_recipients, '[]'::jsonb), p_actor_id
  ) returning id into v_invoice_id;
  update scm.purchase_orders set status = 'INVOICE_UPLOADED' where id = p_purchase_order_id;
  select to_jsonb(i) into v_result from scm.invoices i where i.id = v_invoice_id;
  perform platform.write_audit(v_po.company_id, p_actor_id, 'INVOICE_UPLOADED', 'SCM_INVOICE', v_invoice_id, null, v_result);
  perform platform.finish_idempotency(v_po.company_id, 'UPLOAD_INVOICE', p_idempotency_key, v_result);
  return v_result;
end;
$$;

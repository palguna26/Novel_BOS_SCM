-- Run after all SCM v2 migrations and after each migration/import rehearsal.
-- Any failed rule raises an exception and stops validation.

do $$
declare
  v_name text;
  v_required_schemas text[] := array[
    'iam','master_data','documents','workflow','scm','inventory','quality',
    'planning','procurement','manufacturing','finance','platform','compat'
  ];
  v_required_relations text[] := array[
    'scm.purchase_orders','scm.purchase_order_lines','scm.acceptance_decisions',
    'scm.appointments','inventory.stock_transactions','inventory.stock_ledger_entries',
    'inventory.reservations','inventory.reservation_lines','scm.shipments',
    'scm.shipment_lines','scm.pods','scm.pod_lines','scm.delivery_exceptions',
    'scm.invoices','inventory.stock_balance_v','inventory.inventory_summary_v',
    'scm.po_gate_state_v','compat.purchase_orders','compat.inventory_balances'
  ];
  v_required_functions text[] := array[
    'scm.create_purchase_order(jsonb,uuid,text)',
    'scm.record_acceptance(uuid,text,text,uuid,text)',
    'scm.record_appointment(uuid,text,timestamp with time zone,text,text,uuid,uuid,text,jsonb)',
    'scm.try_create_reservation(uuid,uuid,text)',
    'scm.create_shipment(uuid,jsonb,jsonb,uuid,text)',
    'scm.dispatch_shipment(uuid,uuid,text)',
    'scm.record_pod(uuid,uuid,timestamp with time zone,text,jsonb,uuid,text)',
    'scm.short_close_purchase_order(uuid,text,numeric,uuid,text)',
    'scm.upload_invoice(uuid,text,date,numeric,character,uuid,jsonb,uuid,text)',
    'inventory.reverse_stock_transaction(uuid,text,uuid,text)',
    'documents.register_extraction(jsonb,uuid,text)',
    'inventory.add_stock(uuid,uuid,uuid,uuid,uuid,numeric,text,uuid,text)',
    'scm.record_shipment_event(uuid,text,timestamp with time zone,text,text,uuid,text)'
  ];
begin
  foreach v_name in array v_required_schemas loop
    if not exists (select 1 from pg_namespace where nspname = v_name) then
      raise exception 'Missing required schema: %', v_name;
    end if;
  end loop;

  foreach v_name in array v_required_relations loop
    if to_regclass(v_name) is null then
      raise exception 'Missing required table or view: %', v_name;
    end if;
  end loop;

  foreach v_name in array v_required_functions loop
    if to_regprocedure(v_name) is null then
      raise exception 'Missing required function: %', v_name;
    end if;
  end loop;
end;
$$;

do $$
begin
  if exists (
    select purchase_order_id
    from scm.acceptance_decisions
    where active
    group by purchase_order_id having count(*) > 1
  ) then raise exception 'More than one active acceptance decision exists for a PO'; end if;

  if exists (
    select purchase_order_id
    from scm.appointments
    where active
    group by purchase_order_id having count(*) > 1
  ) then raise exception 'More than one active appointment exists for a PO'; end if;

  if exists (
    select purchase_order_id
    from inventory.reservations
    where status in ('ACTIVE','PARTIALLY_DISPATCHED')
    group by purchase_order_id having count(*) > 1
  ) then raise exception 'More than one active reservation exists for a PO'; end if;

  if exists (
    select 1
    from inventory.reservations r
    left join scm.po_gate_state_v g on g.purchase_order_id = r.purchase_order_id
    where r.status in ('ACTIVE','PARTIALLY_DISPATCHED','FULFILLED')
      and not coalesce(g.ready_for_reservation, false)
  ) then raise exception 'A reservation exists without both PO gates'; end if;

  if exists (
    select 1
    from inventory.stock_ledger_entries e
    group by e.stock_transaction_id, e.item_id, e.batch_id, e.uom_id
    having abs(sum(e.quantity_delta)) > 0.000001
  ) then raise exception 'An unbalanced stock transaction exists'; end if;

  if exists (
    select 1
    from inventory.stock_balance_v b
    join master_data.locations l on l.id = b.location_id
    where l.location_type not in ('CUSTOMER','EXTERNAL_SOURCE','EXTERNAL_SINK')
      and b.quantity < -0.000001
  ) then raise exception 'A negative internal stock balance exists'; end if;

  if exists (
    select 1
    from inventory.reservation_lines
    where reserved_quantity < 0 or shortage_quantity < 0
       or reserved_quantity > required_quantity
  ) then raise exception 'Invalid reservation line quantities exist'; end if;

  if exists (
    select rl.id
    from inventory.reservation_lines rl
    left join (
      select sl.reservation_line_id, sum(sl.planned_quantity) as planned
      from scm.shipment_lines sl
      join scm.shipments s on s.id = sl.shipment_id
      where s.status <> 'CANCELLED'
      group by sl.reservation_line_id
    ) x on x.reservation_line_id = rl.id
    where coalesce(x.planned, 0) > rl.reserved_quantity + 0.000001
  ) then raise exception 'Planned shipment quantity exceeds reservation'; end if;

  if exists (
    select 1 from scm.shipment_lines
    where dispatched_quantity > planned_quantity
       or delivered_quantity + damaged_quantity + rejected_quantity > dispatched_quantity
  ) then raise exception 'Invalid shipment line quantities exist'; end if;

  if exists (
    select sl.id
    from scm.shipment_lines sl
    left join (
      select shipment_line_id, sum(confirmed_quantity) confirmed,
             sum(damaged_quantity) damaged, sum(rejected_quantity) rejected
      from scm.pod_lines group by shipment_line_id
    ) p on p.shipment_line_id = sl.id
    where coalesce(p.confirmed, 0) + coalesce(p.damaged, 0) + coalesce(p.rejected, 0)
      > sl.dispatched_quantity + 0.000001
  ) then raise exception 'POD-confirmed quantities exceed dispatch'; end if;

  if exists (
    select 1
    from scm.invoices i
    join scm.purchase_orders po on po.id = i.purchase_order_id
    where po.status not in ('INVOICE_UPLOADED','CLOSED')
  ) then raise exception 'An invoice exists outside the invoice gate'; end if;

  if exists (
    select 1
    from scm.purchase_order_lines l
    join scm.purchase_orders p on p.id = l.purchase_order_id
    where l.company_id <> p.company_id
  ) then raise exception 'PO line company mismatch exists'; end if;

  if exists (
    select 1
    from inventory.stock_ledger_entries e
    join inventory.stock_transactions t on t.id = e.stock_transaction_id
    where e.company_id <> t.company_id
  ) then raise exception 'Ledger entry company mismatch exists'; end if;
end;
$$;

select 'SCM v2 validation passed' as result;

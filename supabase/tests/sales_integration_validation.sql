-- Run after the Sales integration migrations in staging/UAT.
-- This validates that the read contract objects exist and expose the agreed fields.

do $$
declare
  v_relation text;
  v_required text[] := array[
    'integration.clients',
    'integration.change_log',
    'integration.request_audit',
    'integration.inventory_availability_v',
    'integration.po_line_state_v',
    'scm.acceptance_decision_lines',
    'scm.appointment_purchase_orders',
    'scm.short_close_decision_lines',
    'scm.ownership_transfer_events'
  ];
begin
  foreach v_relation in array v_required loop
    if to_regclass(v_relation) is null then
      raise exception 'Missing Sales integration relation: %', v_relation;
    end if;
  end loop;
end;
$$;

do $$
declare
  v_required text[] := array[
    'company_id','site_id','item_id','physical_quantity','available_quantity',
    'reserved_quantity','threshold_quantity','allocatable_quantity',
    'in_transit_quantity','snapshot_at'
  ];
  v_column text;
begin
  foreach v_column in array v_required loop
    if not exists (
      select 1 from information_schema.columns
      where table_schema = 'integration'
        and table_name = 'inventory_availability_v'
        and column_name = v_column
    ) then
      raise exception 'Missing inventory contract column: %', v_column;
    end if;
  end loop;
end;
$$;

do $$
begin
  if exists (
    select 1 from integration.inventory_availability_v
    where available_quantity < 0 or allocatable_quantity < 0
  ) then
    raise exception 'Inventory availability view returned a negative calculated quantity';
  end if;

  if exists (
    select 1 from integration.po_line_state_v
    where delivered_quantity > dispatched_quantity
       or outstanding_quantity < 0
  ) then
    raise exception 'PO line state view returned an invalid fulfilment quantity';
  end if;
end;
$$;

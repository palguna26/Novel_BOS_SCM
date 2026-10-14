-- Track damaged/rejected quantities per dispatch allocation so a later POD
-- cannot consume the same in-transit units a second time.
alter table scm.shipment_line_allocations
  add column if not exists exception_quantity numeric(18,6) not null default 0
    check (exception_quantity >= 0);

alter table scm.shipment_line_allocations
  add constraint shipment_allocation_resolved_within_dispatched
  check (delivered_quantity + exception_quantity <= dispatched_quantity);

do $$
declare
  v_function text;
  v_anchor text := $anchor$if v_remaining > 0 then raise exception 'Confirmed POD quantity exceeds tracked in-transit allocation'; end if;$anchor$;
  v_exception_stock text := $body$
    v_damaged_remaining := v_damaged;
    v_rejected_remaining := v_rejected;
    for v_allocation in
      select sla.*, pol.item_id, sl.uom_id
      from scm.shipment_line_allocations sla
      join scm.shipment_lines sl on sl.id = sla.shipment_line_id
      join scm.purchase_order_lines pol on pol.id = sl.purchase_order_line_id
      where sla.shipment_line_id = v_shipment_line.id
        and sla.dispatched_quantity > sla.delivered_quantity + sla.exception_quantity
      order by sla.id
      for update of sla
    loop
      exit when v_damaged_remaining <= 0 and v_rejected_remaining <= 0;
      v_take := least(v_damaged_remaining, v_allocation.dispatched_quantity - v_allocation.delivered_quantity - v_allocation.exception_quantity);
      v_damage_take := v_take;
      if v_take > 0 then
        update scm.shipment_line_allocations set exception_quantity = exception_quantity + v_take where id = v_allocation.id;
        v_entry_number := v_entry_number + 1;
        insert into inventory.stock_ledger_entries(company_id, stock_transaction_id, line_number, site_id, location_id, item_id, batch_id, stock_state, uom_id, quantity_delta)
        values (v_po.company_id, v_transaction_id, v_entry_number,
          (select site_id from master_data.locations where id = v_shipment.transit_location_id),
          v_shipment.transit_location_id, v_allocation.item_id, v_allocation.batch_id,
          'IN_TRANSIT', v_allocation.uom_id, -v_take);
        v_entry_number := v_entry_number + 1;
        insert into inventory.stock_ledger_entries(company_id, stock_transaction_id, line_number, site_id, location_id, item_id, batch_id, stock_state, uom_id, quantity_delta)
        values (v_po.company_id, v_transaction_id, v_entry_number, v_customer_location.site_id,
          v_customer_location.id, v_allocation.item_id, v_allocation.batch_id,
          'QUARANTINE', v_allocation.uom_id, v_take);
        v_damaged_remaining := v_damaged_remaining - v_take;
      end if;
      v_take := least(v_rejected_remaining, v_allocation.dispatched_quantity - v_allocation.delivered_quantity - v_allocation.exception_quantity - v_damage_take);
      if v_take > 0 then
        update scm.shipment_line_allocations set exception_quantity = exception_quantity + v_take where id = v_allocation.id;
        v_entry_number := v_entry_number + 1;
        insert into inventory.stock_ledger_entries(company_id, stock_transaction_id, line_number, site_id, location_id, item_id, batch_id, stock_state, uom_id, quantity_delta)
        values (v_po.company_id, v_transaction_id, v_entry_number,
          (select site_id from master_data.locations where id = v_shipment.transit_location_id),
          v_shipment.transit_location_id, v_allocation.item_id, v_allocation.batch_id,
          'IN_TRANSIT', v_allocation.uom_id, -v_take);
        v_entry_number := v_entry_number + 1;
        insert into inventory.stock_ledger_entries(company_id, stock_transaction_id, line_number, site_id, location_id, item_id, batch_id, stock_state, uom_id, quantity_delta)
        values (v_po.company_id, v_transaction_id, v_entry_number, v_customer_location.site_id,
          v_customer_location.id, v_allocation.item_id, v_allocation.batch_id,
          'REJECTED', v_allocation.uom_id, v_take);
        v_rejected_remaining := v_rejected_remaining - v_take;
      end if;
    end loop;
    if v_damaged_remaining > 0 or v_rejected_remaining > 0 then
      raise exception 'POD discrepancy quantity exceeds tracked in-transit allocation';
    end if;
  $body$;
begin
  select pg_get_functiondef('scm.record_pod(uuid,uuid,timestamptz,text,jsonb,uuid,text)'::regprocedure)
    into v_function;
  if position(v_anchor in v_function) = 0 then
    raise exception 'POD function changed; review exception stock handling before applying';
  end if;
  v_function := replace(v_function, 'v_entry_number integer := 0;',
    'v_entry_number integer := 0; v_damaged_remaining numeric(18,6); v_rejected_remaining numeric(18,6); v_damage_take numeric(18,6);');
  v_function := replace(v_function,
    'sla.dispatched_quantity > sla.delivered_quantity',
    'sla.dispatched_quantity > sla.delivered_quantity + sla.exception_quantity');
  v_function := replace(v_function,
    'v_allocation.dispatched_quantity - v_allocation.delivered_quantity',
    'v_allocation.dispatched_quantity - v_allocation.delivered_quantity - v_allocation.exception_quantity');
  v_function := replace(v_function, v_anchor, v_anchor || v_exception_stock);
  execute v_function;
end;
$$;

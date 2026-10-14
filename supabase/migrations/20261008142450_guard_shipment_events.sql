-- A tracking event cannot stand in for POD or a stock reversal.
do $$
declare
  v_function text;
  v_anchor text := 'v_existing := platform.claim_idempotency(v_shipment.company_id, ''RECORD_SHIPMENT_EVENT'', p_idempotency_key);';
  v_guard text := $guard$
  if p_status in ('DELIVERED', 'PARTIALLY_DELIVERED', 'CANCELLED', 'RETURNED') then
    raise exception 'Use the POD or inventory reversal workflow for this status';
  end if;
  if p_status in ('DISPATCHED', 'IN_TRANSIT', 'ARRIVED', 'UNLOADING', 'DELIVERY_ISSUE')
     and v_shipment.actual_dispatch_at is null then
    raise exception 'Shipment must be dispatched before this tracking event';
  end if;
  $guard$;
begin
  select pg_get_functiondef('scm.record_shipment_event(uuid,text,timestamptz,text,text,uuid,text)'::regprocedure)
    into v_function;
  if position(v_anchor in v_function) = 0 then
    raise exception 'Shipment event function changed; review before applying guard';
  end if;
  execute replace(v_function, v_anchor, v_guard || v_anchor);
end;
$$;

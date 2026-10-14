-- Routes need a stable ordering column during shipment planning.
alter table master_data.routes
  add column if not exists created_at timestamptz not null default statement_timestamp();

-- Preserve the deployed shipment function and change only its ETA expression.
do $$
declare
  v_function text;
  v_old text := 'statement_timestamp() + make_interval(hours => v_route.transit_hours)';
  v_new text := 'coalesce(nullif(p_vehicle->>''plannedDispatchAt'', '''')::timestamptz, statement_timestamp()) + make_interval(hours => v_route.transit_hours)';
begin
  select pg_get_functiondef('scm.create_shipment(uuid,jsonb,jsonb,uuid,text)'::regprocedure)
    into v_function;
  if position(v_old in v_function) = 0 then
    raise exception 'Shipment ETA expression changed; review scm.create_shipment before applying this migration';
  end if;
  execute replace(v_function, v_old, v_new);
end;
$$;

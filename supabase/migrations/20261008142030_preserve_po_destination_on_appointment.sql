-- The appointment has its own address fields. Attaching it must not replace
-- the original PO destination, code, or detailed delivery address.
do $$
declare
  v_function text;
  v_old text;
  v_new text;
begin
  select pg_get_functiondef('scm.record_appointment(uuid,text,timestamptz,text,text,uuid,uuid,text,jsonb)'::regprocedure)
    into v_function;
  foreach v_old in array array[
    'destination_name = coalesce(v_destination_address, destination_name)',
    'destination_key = coalesce(v_destination_city, destination_key)',
    'destination_address = coalesce(v_destination_address, destination_address)'
  ] loop
    if position(v_old in v_function) = 0 then
      raise exception 'Appointment destination update changed: %', v_old;
    end if;
    v_new := split_part(v_old, ' = ', 1) || ' = ' || split_part(v_old, ' = ', 1);
    v_function := replace(v_function, v_old, v_new);
  end loop;
  execute v_function;
end;
$$;

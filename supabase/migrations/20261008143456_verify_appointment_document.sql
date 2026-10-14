-- Enforce document-to-PO matching even for direct RPC calls.
do $$
declare
  v_function text;
  v_anchor text := 'select result into v_existing from platform.idempotency_keys';
  v_check text := $body$
  if p_match_status = 'MATCHED' then
    select er.raw_output into v_document
    from documents.extraction_runs er
    where er.document_version_id = p_document_version_id
      and er.company_id = v_po.company_id
    order by er.created_at desc limit 1;
    if v_document is null or jsonb_typeof(v_document->'linkedPoIds') <> 'array'
       or not exists (
         select 1 from jsonb_array_elements_text(v_document->'linkedPoIds') as linked(id)
         where upper(trim(linked.id)) = upper(trim(v_po.external_id))
       ) then
      raise exception 'Appointment document does not list this purchase order';
    end if;
    if nullif(trim(v_document->>'fcCode'), '') is not null
       and upper(v_po.destination_key) ~ '^[A-Z]{3,4}[0-9]'
       and upper(trim(v_document->>'fcCode')) <> upper(trim(v_po.destination_key)) then
      raise exception 'Appointment FC does not match the purchase order';
    end if;
  end if;
  $body$;
begin
  select pg_get_functiondef('scm.record_appointment(uuid,text,timestamptz,text,text,uuid,uuid,text,jsonb)'::regprocedure)
    into v_function;
  if position(v_anchor in v_function) = 0 or position('v_result jsonb;' in v_function) = 0 then
    raise exception 'Appointment function changed; review document matching before applying';
  end if;
  v_function := replace(v_function, 'v_result jsonb;', 'v_result jsonb; v_document jsonb;');
  v_function := replace(v_function, v_anchor, v_check || v_anchor);
  execute v_function;
end;
$$;

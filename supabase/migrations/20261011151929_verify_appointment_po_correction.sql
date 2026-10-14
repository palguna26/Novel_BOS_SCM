-- Keep the original extraction as evidence. A user correction can match only
-- when the PO number is an exact token in the stored PDF text.
do $$
declare
  v_function text;
  v_old text := $old$
    if v_document is null or jsonb_typeof(v_document->'linkedPoIds') <> 'array'
       or not exists (
         select 1 from jsonb_array_elements_text(v_document->'linkedPoIds') as linked(id)
         where upper(trim(linked.id)) = upper(trim(v_po.external_id))
       ) then
      raise exception 'Appointment document does not list this purchase order';
    end if;
$old$;
  v_new text := $new$
    if v_document is null or not (
      exists (
        select 1
        from jsonb_array_elements_text(
          case when jsonb_typeof(v_document->'linkedPoIds') = 'array'
            then v_document->'linkedPoIds' else '[]'::jsonb end
        ) as linked(id)
        where upper(trim(linked.id)) = upper(trim(v_po.external_id))
      )
      or (
        upper(trim(coalesce(p_match_details->>'linkedPoId', ''))) = upper(trim(v_po.external_id))
        and upper(trim(v_po.external_id)) = any (
          regexp_split_to_array(upper(coalesce(v_document->>'text', '')), '[^A-Z0-9-]+')
        )
      )
    ) then
      raise exception 'Appointment document does not list this purchase order';
    end if;
$new$;
begin
  select pg_get_functiondef('scm.record_appointment(uuid,text,timestamptz,text,text,uuid,uuid,text,jsonb)'::regprocedure)
    into v_function;
  if position(v_old in v_function) = 0 then
    raise exception 'Appointment validation changed; review the PO correction before applying';
  end if;
  execute replace(v_function, v_old, v_new);
end;
$$;

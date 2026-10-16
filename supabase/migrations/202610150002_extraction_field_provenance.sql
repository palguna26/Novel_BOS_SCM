-- Preserve field-level extraction evidence alongside the raw document output.
-- The existing registration function stores the complete payload at '$'.
-- This trigger adds stable top-level paths so source/destination fields can
-- be reviewed and corrected independently later.

create or replace function documents.populate_extracted_field_provenance()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, documents
as $$
declare
  v_field record;
begin
  for v_field in
    select key, value
    from jsonb_each(coalesce(new.raw_output, '{}'::jsonb))
    where key <> '_extraction'
  loop
    insert into documents.extracted_fields(
      company_id,
      extraction_run_id,
      field_path,
      extracted_value,
      confidence
    ) values (
      new.company_id,
      new.id,
      '$.' || v_field.key,
      v_field.value,
      new.overall_confidence
    )
    on conflict (extraction_run_id, field_path) do nothing;
  end loop;
  return new;
end;
$$;

drop trigger if exists extraction_field_provenance on documents.extraction_runs;
create trigger extraction_field_provenance
after insert on documents.extraction_runs
for each row execute function documents.populate_extracted_field_provenance();


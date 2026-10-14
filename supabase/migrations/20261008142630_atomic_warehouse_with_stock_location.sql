-- A warehouse is not usable for stock until it has a physical location.
create or replace function master_data.create_warehouse_with_stock_location(
  p_payload jsonb,
  p_actor_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, master_data, iam, platform
as $$
declare
  v_company_id uuid := (p_payload->>'companyId')::uuid;
  v_site master_data.sites%rowtype;
  v_result jsonb;
begin
  if not iam.actor_can_approve(p_actor_id, v_company_id) then
    raise exception 'Approval access is required to create a warehouse';
  end if;
  if nullif(trim(p_payload->>'code'), '') is null
     or nullif(trim(p_payload->>'name'), '') is null
     or nullif(trim(p_payload->>'city'), '') is null then
    raise exception 'Warehouse code, name and city are required';
  end if;

  insert into master_data.sites(
    company_id, code, name, city, state, address_line1, address_line2,
    postal_code, site_type, active
  ) values (
    v_company_id, trim(p_payload->>'code'), trim(p_payload->>'name'),
    trim(p_payload->>'city'), nullif(trim(p_payload->>'state'), ''),
    nullif(trim(p_payload->>'addressLine1'), ''),
    nullif(trim(p_payload->>'addressLine2'), ''),
    nullif(trim(p_payload->>'postalCode'), ''),
    'WAREHOUSE', coalesce((p_payload->>'active')::boolean, true)
  ) returning * into v_site;

  insert into master_data.locations(company_id, site_id, code, name, location_type, virtual)
  values (v_company_id, v_site.id, v_site.code || '-STOCK', 'Main stock', 'WAREHOUSE', false);

  v_result := to_jsonb(v_site);
  perform platform.write_audit(v_company_id, p_actor_id, 'WAREHOUSE_CREATED', 'MASTER_DATA_SITE', v_site.id, null, v_result);
  return v_result;
end;
$$;

revoke all on function master_data.create_warehouse_with_stock_location(jsonb,uuid) from public;
grant execute on function master_data.create_warehouse_with_stock_location(jsonb,uuid) to authenticated, service_role;

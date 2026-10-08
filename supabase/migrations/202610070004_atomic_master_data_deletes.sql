create or replace function master_data.delete_channel(
  p_company_id uuid,
  p_channel_id uuid,
  p_actor_id uuid
)
returns jsonb
language plpgsql
set search_path = pg_catalog, master_data, platform, iam
as $$
declare
  v_old_value jsonb;
begin
  select to_jsonb(c)
    into v_old_value
    from master_data.channels c
   where c.id = p_channel_id
     and c.company_id = p_company_id;

  if v_old_value is null then
    raise exception 'Platform not found';
  end if;

  delete from master_data.channels
   where id = p_channel_id
     and company_id = p_company_id;

  perform platform.write_audit(
    p_company_id,
    p_actor_id,
    'PLATFORM_DELETED',
    'MASTER_DATA_CHANNEL',
    p_channel_id,
    v_old_value,
    null,
    null,
    'API'
  );

  return jsonb_build_object('deleted', true, 'id', p_channel_id);
end;
$$;

create or replace function master_data.delete_warehouse(
  p_company_id uuid,
  p_site_id uuid,
  p_actor_id uuid
)
returns jsonb
language plpgsql
set search_path = pg_catalog, master_data, platform, iam
as $$
declare
  v_old_value jsonb;
begin
  select to_jsonb(s)
    into v_old_value
    from master_data.sites s
   where s.id = p_site_id
     and s.company_id = p_company_id;

  if v_old_value is null then
    raise exception 'Warehouse not found';
  end if;

  delete from master_data.sites
   where id = p_site_id
     and company_id = p_company_id;

  perform platform.write_audit(
    p_company_id,
    p_actor_id,
    'WAREHOUSE_DELETED',
    'MASTER_DATA_SITE',
    p_site_id,
    v_old_value,
    null,
    null,
    'API'
  );

  return jsonb_build_object('deleted', true, 'id', p_site_id);
end;
$$;

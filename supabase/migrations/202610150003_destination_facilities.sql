-- Make receiving facilities first-class master data.
-- Source warehouses continue to live in master_data.sites and own inventory.

create table if not exists master_data.destination_facilities (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references master_data.companies(id) on delete restrict,
  code text not null,
  name text not null,
  fc_code text,
  address_line1 text,
  address_line2 text,
  city text,
  state text,
  postal_code text,
  country_code char(2) not null default 'IN',
  active boolean not null default true,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  unique (company_id, code)
);

alter table master_data.destination_mappings
  add column if not exists destination_facility_id uuid
  references master_data.destination_facilities(id) on delete restrict;

alter table master_data.routes
  add column if not exists destination_facility_id uuid
  references master_data.destination_facilities(id) on delete restrict;

-- Seed one facility per existing channel destination. The mapping remains the
-- compatibility key until a user enriches the facility record.
insert into master_data.destination_facilities(company_id, code, name, fc_code)
select distinct on (company_id, destination_key)
  company_id,
  destination_key,
  destination_name,
  fc_code
from master_data.destination_mappings
where active
on conflict (company_id, code) do nothing;

update master_data.destination_mappings m
set destination_facility_id = f.id
from master_data.destination_facilities f
where f.company_id = m.company_id
  and f.code = m.destination_key
  and m.destination_facility_id is null;

update master_data.routes r
set destination_facility_id = f.id
from master_data.destination_facilities f
where f.company_id = r.company_id
  and f.code = r.destination_key
  and r.destination_facility_id is null;

alter table master_data.destination_facilities enable row level security;
drop policy if exists destination_facilities_read on master_data.destination_facilities;
create policy destination_facilities_read
on master_data.destination_facilities
for select to authenticated
using (iam.can_access_company(company_id));

grant select on master_data.destination_facilities to authenticated;

create or replace function master_data.link_destination_mapping_facility()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, master_data
as $$
declare
  v_facility_id uuid;
begin
  if new.destination_facility_id is not null
     and (tg_op <> 'UPDATE' or new.destination_key = old.destination_key) then return new; end if;
  insert into master_data.destination_facilities(company_id, code, name, fc_code)
  values (new.company_id, new.destination_key, new.destination_name, new.fc_code)
  on conflict (company_id, code) do nothing;
  select id into v_facility_id
  from master_data.destination_facilities
  where company_id = new.company_id and code = new.destination_key;
  new.destination_facility_id := v_facility_id;
  return new;
end;
$$;

drop trigger if exists destination_mapping_facility_link on master_data.destination_mappings;
create trigger destination_mapping_facility_link
before insert or update of destination_key, destination_name, fc_code on master_data.destination_mappings
for each row execute function master_data.link_destination_mapping_facility();

create or replace function master_data.link_route_facility()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, master_data
as $$
declare
  v_facility_id uuid;
  v_name text := coalesce(nullif(new.destination_city, ''), new.destination_key);
begin
  if new.destination_facility_id is not null
     and (tg_op <> 'UPDATE' or new.destination_key = old.destination_key) then return new; end if;
  insert into master_data.destination_facilities(company_id, code, name)
  values (new.company_id, new.destination_key, v_name)
  on conflict (company_id, code) do nothing;
  select id into v_facility_id
  from master_data.destination_facilities
  where company_id = new.company_id and code = new.destination_key;
  new.destination_facility_id := v_facility_id;
  return new;
end;
$$;

drop trigger if exists route_facility_link on master_data.routes;
create trigger route_facility_link
before insert or update of destination_key, destination_city on master_data.routes
for each row execute function master_data.link_route_facility();


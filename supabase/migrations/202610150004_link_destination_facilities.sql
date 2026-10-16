-- Link the receiving facility across the operational workflow.
-- source_site_id remains the inventory-owning source warehouse.

alter table scm.purchase_orders
  add column if not exists destination_facility_id uuid
  references master_data.destination_facilities(id) on delete restrict;

alter table scm.appointments
  add column if not exists destination_facility_id uuid
  references master_data.destination_facilities(id) on delete restrict;

alter table scm.shipments
  add column if not exists destination_facility_id uuid
  references master_data.destination_facilities(id) on delete restrict;

update scm.purchase_orders po
set destination_facility_id = f.id
from master_data.destination_facilities f
where f.company_id = po.company_id
  and f.code = po.destination_key
  and po.destination_facility_id is null;

update scm.appointments a
set destination_facility_id = f.id
from scm.purchase_orders po, master_data.destination_facilities f
where po.id = a.purchase_order_id
  and f.company_id = po.company_id
  and f.code = coalesce(a.destination_code, po.destination_key)
  and a.destination_facility_id is null;

update scm.shipments s
set destination_facility_id = po.destination_facility_id
from scm.purchase_orders po
where po.id = s.purchase_order_id
  and s.destination_facility_id is null;

create or replace function scm.assign_destination_facility()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, scm, master_data
as $$
declare
  v_code text;
  v_company uuid := (to_jsonb(new)->>'company_id')::uuid;
  v_po_facility uuid;
  v_facility_id uuid;
begin
  if tg_table_name = 'purchase_orders' then
    v_code := nullif(to_jsonb(new)->>'destination_key', '');
  elsif tg_table_name = 'appointments' then
    v_code := nullif(to_jsonb(new)->>'destination_code', '');
    if v_code is null then
      select destination_facility_id into v_po_facility
      from scm.purchase_orders where id = new.purchase_order_id;
      new.destination_facility_id := v_po_facility;
      return new;
    end if;
  elsif tg_table_name = 'shipments' then
    select destination_facility_id into v_po_facility
    from scm.purchase_orders where id = new.purchase_order_id;
    new.destination_facility_id := v_po_facility;
    return new;
  end if;

  select id into v_facility_id
  from master_data.destination_facilities
  where company_id = v_company and code = v_code and active
  limit 1;
  new.destination_facility_id := v_facility_id;
  return new;
end;
$$;

drop trigger if exists purchase_orders_destination_facility on scm.purchase_orders;
create trigger purchase_orders_destination_facility
before insert or update of destination_key on scm.purchase_orders
for each row execute function scm.assign_destination_facility();

drop trigger if exists appointments_destination_facility on scm.appointments;
create trigger appointments_destination_facility
before insert or update of destination_code, purchase_order_id on scm.appointments
for each row execute function scm.assign_destination_facility();

drop trigger if exists shipments_destination_facility on scm.shipments;
create trigger shipments_destination_facility
before insert or update of purchase_order_id on scm.shipments
for each row execute function scm.assign_destination_facility();


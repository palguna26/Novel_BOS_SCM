-- Keep support locations and historical ledger rows internal to the system.
-- Warehouse-facing inventory views only expose active physical warehouses.

create or replace view inventory.inventory_summary_v as
select
  b.company_id,
  b.site_id,
  b.item_id,
  b.uom_id,
  coalesce(sum(b.quantity) filter (
    where l.location_type <> all (array['TRANSIT','CUSTOMER','EXTERNAL_SOURCE','EXTERNAL_SINK'])
      and b.stock_state <> 'SCRAP'
  ), 0)::numeric(18,6) as physical,
  coalesce(sum(b.quantity) filter (where b.stock_state = 'RESERVED'), 0)::numeric(18,6) as blocked,
  coalesce(sum(b.quantity) filter (
    where l.location_type = 'TRANSIT' or b.stock_state = 'IN_TRANSIT'
  ), 0)::numeric(18,6) as in_transit,
  coalesce(sum(b.quantity) filter (
    where b.stock_state = 'RELEASED'
      and l.location_type <> all (array['TRANSIT','CUSTOMER','EXTERNAL_SOURCE','EXTERNAL_SINK'])
  ), 0)::numeric(18,6) as released,
  coalesce(p.threshold_quantity, 0)::numeric(18,6) as threshold,
  greatest(
    coalesce(sum(b.quantity) filter (
      where b.stock_state = 'RELEASED'
        and l.location_type <> all (array['TRANSIT','CUSTOMER','EXTERNAL_SOURCE','EXTERNAL_SINK'])
    ), 0) - coalesce(p.threshold_quantity, 0),
    0
  )::numeric(18,6) as allocatable
from inventory.stock_balance_v b
join master_data.locations l on l.id = b.location_id
join master_data.sites s
  on s.id = b.site_id
 and s.site_type = 'WAREHOUSE'
 and s.active = true
left join lateral (
  select ip.threshold_quantity
  from inventory.inventory_policies ip
  where ip.site_id = b.site_id
    and ip.item_id = b.item_id
    and ip.effective_from <= current_date
    and (ip.effective_to is null or ip.effective_to >= current_date)
  order by ip.effective_from desc
  limit 1
) p on true
group by b.company_id, b.site_id, b.item_id, b.uom_id, p.threshold_quantity;

create or replace view compat.warehouses as
select id, name, code, coalesce(city, '') as city, coalesce(state, '') as state, active
from master_data.sites
where site_type = 'WAREHOUSE'
  and active = true;

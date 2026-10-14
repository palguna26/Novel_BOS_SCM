-- POD needs a virtual destination for delivered, damaged, and rejected stock.
-- It is a customer site, never a physical warehouse.
with customer_sites as (
  insert into master_data.sites(company_id, code, name, site_type, active)
  select c.id, 'CUSTOMER-DELIVERY', 'Customer deliveries', 'CUSTOMER', true
  from master_data.companies c
  on conflict (company_id, code) do update set active = true
  returning id, company_id
)
insert into master_data.locations(company_id, site_id, code, name, location_type, virtual, active)
select company_id, id, 'DELIVERED', 'Customer delivery', 'CUSTOMER', true, true
from customer_sites
on conflict (site_id, code) do update set active = true;

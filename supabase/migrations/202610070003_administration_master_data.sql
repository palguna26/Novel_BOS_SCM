alter table master_data.sites
  add column if not exists address_line1 text,
  add column if not exists address_line2 text,
  add column if not exists postal_code text;

create index if not exists sites_company_city_active_idx
  on master_data.sites(company_id, city, active)
  where site_type = 'WAREHOUSE';

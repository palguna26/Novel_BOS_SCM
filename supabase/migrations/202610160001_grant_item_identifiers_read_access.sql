-- The authenticated API client reads item identifiers when loading masters.
-- Keep the existing company_read RLS policy as the row-level boundary.
grant select on table master_data.item_identifiers to authenticated;
grant select on table master_data.item_identifiers to service_role;

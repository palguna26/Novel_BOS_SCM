-- Keep the current test setup focused on one source warehouse and one route.
-- Stock ledger rows are append-only, so historical rows for retired warehouses
-- are preserved while the warehouse and its locations are made inactive.

begin;

delete from inventory.inventory_policies
 where site_id in (
   '357fbfcf-771c-42dd-a18d-7352ff98e0e7'::uuid,
   '86df208c-c761-4a07-91f5-86f56ba2bcaa'::uuid,
   'fd10a876-ade2-44d5-8954-ae1e2e0c1a10'::uuid
 );

delete from master_data.destination_mappings
 where company_id = (select company_id from master_data.sites where id = '90cdb2b6-2bd2-4d8c-b7a8-f624de50a387'::uuid)
   and (destination_key <> 'BLR4'
    or source_site_id <> '90cdb2b6-2bd2-4d8c-b7a8-f624de50a387'::uuid);

delete from master_data.routes
 where company_id = (select company_id from master_data.sites where id = '90cdb2b6-2bd2-4d8c-b7a8-f624de50a387'::uuid)
   and not (
   source_site_id = '90cdb2b6-2bd2-4d8c-b7a8-f624de50a387'::uuid
   and destination_key = 'BLR4'
 );

update master_data.routes
   set destination_city = 'Bengaluru',
       active = true
 where source_site_id = '90cdb2b6-2bd2-4d8c-b7a8-f624de50a387'::uuid
   and destination_key = 'BLR4';

update master_data.sites
   set name = 'Mysore Warehouse',
       city = 'Mysuru',
       active = true
 where id = '90cdb2b6-2bd2-4d8c-b7a8-f624de50a387'::uuid;

update master_data.locations
   set active = false
 where site_id in (
   '357fbfcf-771c-42dd-a18d-7352ff98e0e7'::uuid,
   '86df208c-c761-4a07-91f5-86f56ba2bcaa'::uuid,
   'fd10a876-ade2-44d5-8954-ae1e2e0c1a10'::uuid
 );

update master_data.sites
   set active = false
 where site_type = 'WAREHOUSE'
   and company_id = (select company_id from master_data.sites where id = '90cdb2b6-2bd2-4d8c-b7a8-f624de50a387'::uuid)
   and id <> '90cdb2b6-2bd2-4d8c-b7a8-f624de50a387'::uuid;

commit;

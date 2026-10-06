-- Isolated-database workflow smoke test. Test data is rolled back.
-- The test database must provide auth.users and auth.uid(), as Supabase does.

begin;

insert into auth.users(id) values ('00000000-0000-0000-0000-000000000001');
insert into iam.users(id,email,display_name,role)
values ('00000000-0000-0000-0000-000000000001','manager@example.test','Test Manager','MANAGER');
insert into master_data.companies(id,code,legal_name)
values ('10000000-0000-0000-0000-000000000001','TEST','Test Company');
insert into iam.user_company_access(user_id,company_id,can_read,can_write,can_approve)
values ('00000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001',true,true,true);
insert into master_data.uoms(id,code,name,dimension,decimal_places)
values ('20000000-0000-0000-0000-000000000001','EA','Each','COUNT',0);

insert into master_data.sites(id,company_id,code,name,site_type)
values
('30000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','WH1','Warehouse 1','WAREHOUSE'),
('30000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001','TRN','Transit','TRANSIT'),
('30000000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000001','CUS','Customer','CUSTOMER');
insert into master_data.locations(id,company_id,site_id,code,name,location_type,virtual)
values
('40000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','WH','Warehouse','WAREHOUSE',false),
('40000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','BIN1','Bin 1','BIN',false),
('40000000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','SOURCE','Opening source','EXTERNAL_SOURCE',true),
('40000000-0000-0000-0000-000000000004','10000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000002','TRANSIT','Transit','TRANSIT',true),
('40000000-0000-0000-0000-000000000005','10000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000003','CUSTOMER','Customer','CUSTOMER',true);

insert into master_data.items(id,company_id,code,name,item_class,base_uom_id,lifecycle_status)
values ('50000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','SKU1','Test SKU','FG','20000000-0000-0000-0000-000000000001','DRAFT');
insert into master_data.item_approvals(company_id,item_id,approval_area,decision,decided_by)
select '10000000-0000-0000-0000-000000000001','50000000-0000-0000-0000-000000000001',x,'APPROVED','00000000-0000-0000-0000-000000000001'
from unnest(array['CATEGORY_NPD','COSTING','QA','FINANCE']) x;
insert into quality.inspection_plans(company_id,item_id,plan_type,version,status,effective_from)
values ('10000000-0000-0000-0000-000000000001','50000000-0000-0000-0000-000000000001','PDI',1,'ACTIVE',current_date);
update master_data.items set lifecycle_status = 'ACTIVE'
where id = '50000000-0000-0000-0000-000000000001';

insert into master_data.channels(id,company_id,code,name,channel_type)
values ('60000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','AMZ','Amazon','MARKETPLACE');
insert into master_data.destination_mappings(company_id,channel_id,destination_key,destination_name,source_site_id,source_location_id)
values ('10000000-0000-0000-0000-000000000001','60000000-0000-0000-0000-000000000001','BLR-FC','Bengaluru FC','30000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000001');
insert into inventory.inventory_policies(company_id,site_id,item_id,threshold_quantity,effective_from,approved_by)
values ('10000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','50000000-0000-0000-0000-000000000001',5,current_date,'00000000-0000-0000-0000-000000000001');

insert into inventory.stock_transactions(id,company_id,transaction_type,document_type,document_id,idempotency_key,posted_by)
values ('70000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','OPENING','TEST','70000000-0000-0000-0000-000000000001','OPENING-1','00000000-0000-0000-0000-000000000001');
insert into inventory.stock_ledger_entries(company_id,stock_transaction_id,line_number,site_id,location_id,item_id,stock_state,uom_id,quantity_delta)
values
('10000000-0000-0000-0000-000000000001','70000000-0000-0000-0000-000000000001',1,'30000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000003','50000000-0000-0000-0000-000000000001','RELEASED','20000000-0000-0000-0000-000000000001',-100),
('10000000-0000-0000-0000-000000000001','70000000-0000-0000-0000-000000000001',2,'30000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000002','50000000-0000-0000-0000-000000000001','RELEASED','20000000-0000-0000-0000-000000000001',100);

insert into documents.files(id,company_id,document_type,business_key,current_version,created_by)
values
('80000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','APPOINTMENT','AP-1',1,'00000000-0000-0000-0000-000000000001'),
('80000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001','POD','POD-1',1,'00000000-0000-0000-0000-000000000001'),
('80000000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000001','INVOICE','INV-1',1,'00000000-0000-0000-0000-000000000001');
insert into documents.document_versions(id,company_id,file_id,version_number,filename,storage_bucket,storage_path,media_type,sha256,uploaded_by)
values
('81000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','80000000-0000-0000-0000-000000000001',1,'appointment.pdf','private','appointment.pdf','application/pdf','hash-ap','00000000-0000-0000-0000-000000000001'),
('81000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001','80000000-0000-0000-0000-000000000002',1,'pod.pdf','private','pod.pdf','application/pdf','hash-pod','00000000-0000-0000-0000-000000000001'),
('81000000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000001','80000000-0000-0000-0000-000000000003',1,'invoice.pdf','private','invoice.pdf','application/pdf','hash-invoice','00000000-0000-0000-0000-000000000001');

create temporary table smoke_ids(name text primary key, id uuid);
insert into smoke_ids
select 'po1', (scm.create_purchase_order(
  jsonb_build_object(
    'companyId','10000000-0000-0000-0000-000000000001','channelId','60000000-0000-0000-0000-000000000001',
    'externalId','PO-ACCEPT-FIRST','poDate','2026-10-03T00:00:00Z','destination','BLR-FC',
    'lines',jsonb_build_array(jsonb_build_object('itemId','50000000-0000-0000-0000-000000000001','ordered',20,'uomId','20000000-0000-0000-0000-000000000001'))
  ),'00000000-0000-0000-0000-000000000001','CREATE-PO-1'
)->>'id')::uuid;

select scm.record_acceptance((select id from smoke_ids where name='po1'),'ACCEPTED',null,'00000000-0000-0000-0000-000000000001','ACCEPT-1');
do $$ begin
  if exists (select 1 from inventory.reservations where purchase_order_id=(select id from smoke_ids where name='po1')) then
    raise exception 'Reservation was created before appointment';
  end if;
end $$;
select scm.record_appointment((select id from smoke_ids where name='po1'),'AP-1',statement_timestamp()+interval '1 day','BLR FC','MATCHED','81000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001','APPOINT-1');
do $$ begin
  if (select count(*) from inventory.reservations where purchase_order_id=(select id from smoke_ids where name='po1')) <> 1 then
    raise exception 'Exactly one reservation was not created after both gates';
  end if;
end $$;

insert into smoke_ids
select 'shipment1', (scm.create_shipment(
  (select id from smoke_ids where name='po1'),
  jsonb_build_array(jsonb_build_object('poLineId',(select id from scm.purchase_order_lines where purchase_order_id=(select id from smoke_ids where name='po1')),'planned',20)),
  jsonb_build_object('truckNumber','TEST-TRUCK'),
  '00000000-0000-0000-0000-000000000001','SHIPMENT-1'
)->>'id')::uuid;
select scm.dispatch_shipment((select id from smoke_ids where name='shipment1'),'00000000-0000-0000-0000-000000000001','DISPATCH-1');
select scm.record_pod(
  (select id from smoke_ids where name='po1'),'81000000-0000-0000-0000-000000000002',statement_timestamp(),'Receiver',
  jsonb_build_array(jsonb_build_object('shipmentLineId',(select id from scm.shipment_lines where shipment_id=(select id from smoke_ids where name='shipment1')),'confirmed',18,'short',2)),
  '00000000-0000-0000-0000-000000000001','POD-1'
);
select scm.short_close_purchase_order((select id from smoke_ids where name='po1'),'Customer received two units short',2,'00000000-0000-0000-0000-000000000001','SHORT-CLOSE-1');
select scm.upload_invoice((select id from smoke_ids where name='po1'),'INV-1',current_date,1000,'INR','81000000-0000-0000-0000-000000000003','[]','00000000-0000-0000-0000-000000000001','INVOICE-1');

insert into smoke_ids
select 'po2', (scm.create_purchase_order(
  jsonb_build_object(
    'companyId','10000000-0000-0000-0000-000000000001','channelId','60000000-0000-0000-0000-000000000001',
    'externalId','PO-APPOINT-FIRST','poDate','2026-10-03T00:00:00Z','destination','BLR-FC',
    'lines',jsonb_build_array(jsonb_build_object('itemId','50000000-0000-0000-0000-000000000001','ordered',10,'uomId','20000000-0000-0000-0000-000000000001'))
  ),'00000000-0000-0000-0000-000000000001','CREATE-PO-2'
)->>'id')::uuid;
select scm.record_appointment((select id from smoke_ids where name='po2'),'AP-2',statement_timestamp()+interval '2 days','BLR FC','WAIVED',null,'00000000-0000-0000-0000-000000000001','APPOINT-2');
do $$ begin
  if exists (select 1 from inventory.reservations where purchase_order_id=(select id from smoke_ids where name='po2')) then
    raise exception 'Reservation was created before acceptance';
  end if;
end $$;
select scm.record_acceptance((select id from smoke_ids where name='po2'),'ACCEPTED',null,'00000000-0000-0000-0000-000000000001','ACCEPT-2');
select scm.record_acceptance((select id from smoke_ids where name='po2'),'ACCEPTED',null,'00000000-0000-0000-0000-000000000001','ACCEPT-2');
do $$ begin
  if (select count(*) from inventory.reservations where purchase_order_id=(select id from smoke_ids where name='po2')) <> 1 then
    raise exception 'Appointment-first path or retry created an invalid reservation count';
  end if;
end $$;

\ir scm_v2_validation.sql

rollback;

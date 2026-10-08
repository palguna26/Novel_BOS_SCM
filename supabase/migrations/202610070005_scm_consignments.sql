create table if not exists scm.consignments (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references master_data.companies(id) on delete restrict,
  purchase_order_id uuid not null references scm.purchase_orders(id) on delete restrict,
  shipment_id uuid references scm.shipments(id) on delete restrict,
  document_version_id uuid not null references documents.document_versions(id) on delete restrict,
  consignment_number text not null,
  source_name text,
  destination_name text,
  delivery_at timestamptz,
  total_quantity numeric(18,6),
  total_value numeric(18,4),
  currency char(3) not null default 'INR',
  status text not null default 'RECEIVED' check (status in ('RECEIVED','LINKED','DELIVERED','CANCELLED')),
  extracted jsonb not null default '{}'::jsonb,
  created_by uuid references iam.users(id) on delete restrict,
  created_at timestamptz not null default statement_timestamp(),
  unique (company_id, consignment_number)
);

create index if not exists consignments_po_idx on scm.consignments(purchase_order_id);
create index if not exists consignments_shipment_idx on scm.consignments(shipment_id);

alter table scm.consignments enable row level security;
drop policy if exists company_read on scm.consignments;
create policy company_read on scm.consignments
  for select to authenticated
  using (iam.can_access_company(company_id));

grant select on scm.consignments to authenticated;
grant all on scm.consignments to service_role;

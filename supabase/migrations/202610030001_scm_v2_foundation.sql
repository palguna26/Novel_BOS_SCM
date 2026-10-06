-- SCM v2 clean-rebuild foundation.
-- This migration is additive: the current public schema remains untouched.

create extension if not exists pgcrypto;

create schema if not exists iam;
create schema if not exists master_data;
create schema if not exists documents;
create schema if not exists workflow;
create schema if not exists scm;
create schema if not exists inventory;
create schema if not exists quality;
create schema if not exists planning;
create schema if not exists procurement;
create schema if not exists manufacturing;
create schema if not exists finance;
create schema if not exists platform;
create schema if not exists compat;

create or replace function platform.set_updated_at()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  new.updated_at := statement_timestamp();
  return new;
end;
$$;

create or replace function platform.reject_mutation()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  raise exception '% is append-only', tg_table_schema || '.' || tg_table_name;
end;
$$;

create table iam.users (
  id uuid primary key references auth.users(id) on delete restrict,
  email text not null unique,
  display_name text not null,
  role text not null check (role in ('TEAM_MEMBER','MANAGER','ADMIN','SUPER_ADMIN','QC','QA','PLANNER','FINANCE')),
  active boolean not null default true,
  mfa_required boolean not null default false,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp()
);

create table master_data.companies (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  legal_name text not null,
  gstin text,
  pan text,
  base_currency char(3) not null default 'INR',
  active boolean not null default true,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp()
);

create table iam.user_company_access (
  user_id uuid not null references iam.users(id) on delete cascade,
  company_id uuid not null references master_data.companies(id) on delete restrict,
  can_read boolean not null default true,
  can_write boolean not null default false,
  can_approve boolean not null default false,
  primary key (user_id, company_id)
);

create or replace function iam.can_access_company(p_company_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, iam
as $$
  select exists (
    select 1
    from iam.user_company_access a
    join iam.users u on u.id = a.user_id
    where a.user_id = auth.uid()
      and a.company_id = p_company_id
      and a.can_read
      and u.active
  );
$$;

create or replace function iam.can_write_company(p_company_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, iam
as $$
  select exists (
    select 1
    from iam.user_company_access a
    join iam.users u on u.id = a.user_id
    where a.user_id = auth.uid()
      and a.company_id = p_company_id
      and a.can_write
      and u.active
      and u.role <> 'QC'
  );
$$;

create or replace function iam.can_approve_company(p_company_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, iam
as $$
  select exists (
    select 1
    from iam.user_company_access a
    join iam.users u on u.id = a.user_id
    where a.user_id = auth.uid()
      and a.company_id = p_company_id
      and a.can_approve
      and u.active
      and u.role in ('MANAGER','ADMIN','SUPER_ADMIN','QA','FINANCE')
  );
$$;

create table master_data.sites (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references master_data.companies(id) on delete restrict,
  code text not null,
  name text not null,
  site_type text not null check (site_type in ('WAREHOUSE','PLANT','OFFICE','VENDOR','CUSTOMER','MARKETPLACE','TRANSIT')),
  city text,
  state text,
  country_code char(2) not null default 'IN',
  timezone text not null default 'Asia/Kolkata',
  active boolean not null default true,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  unique (company_id, code)
);

create table master_data.locations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references master_data.companies(id) on delete restrict,
  site_id uuid not null references master_data.sites(id) on delete restrict,
  parent_location_id uuid references master_data.locations(id) on delete restrict,
  code text not null,
  name text not null,
  location_type text not null check (location_type in ('WAREHOUSE','ZONE','RACK','BIN','QUARANTINE','REJECTED','RETURN','NEAR_EXPIRY','MRB','RETENTION','TRANSIT','CUSTOMER','EXTERNAL_SOURCE','EXTERNAL_SINK')),
  barcode text,
  virtual boolean not null default false,
  active boolean not null default true,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  unique (site_id, code),
  unique (company_id, id)
);

create table master_data.uoms (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  dimension text not null check (dimension in ('COUNT','WEIGHT','VOLUME','LENGTH','TIME')),
  decimal_places smallint not null default 3 check (decimal_places between 0 and 6),
  active boolean not null default true
);

create table master_data.items (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references master_data.companies(id) on delete restrict,
  code text not null,
  legacy_code text,
  name text not null,
  item_class text not null check (item_class in ('FG','SFG','RM','PM','CONSUMABLE','SPARE','KIT')),
  brand text,
  category text,
  variant text,
  base_uom_id uuid not null references master_data.uoms(id) on delete restrict,
  hsn_code text,
  gst_rate numeric(7,4) not null default 0 check (gst_rate between 0 and 100),
  shelf_life_days integer check (shelf_life_days is null or shelf_life_days > 0),
  batch_controlled boolean not null default false,
  serial_controlled boolean not null default false,
  make_or_buy text check (make_or_buy in ('MAKE','BUY','BOTH')),
  lead_time_days numeric(10,2) not null default 0 check (lead_time_days >= 0),
  minimum_order_qty numeric(18,6) not null default 0 check (minimum_order_qty >= 0),
  order_multiple numeric(18,6) not null default 1 check (order_multiple > 0),
  abc_class char(1) check (abc_class in ('A','B','C')),
  xyz_class char(1) check (xyz_class in ('X','Y','Z')),
  fsn_class char(1) check (fsn_class in ('F','S','N')),
  inspection_plan_required boolean not null default true,
  lifecycle_status text not null default 'DRAFT' check (lifecycle_status in ('DRAFT','PENDING_APPROVAL','ACTIVE','ON_HOLD','INACTIVE','OBSOLETE')),
  active_from date,
  active_to date,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  unique (company_id, code),
  unique (company_id, id),
  check (active_to is null or active_from is null or active_to >= active_from)
);

create table master_data.item_identifiers (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references master_data.companies(id) on delete restrict,
  item_id uuid not null references master_data.items(id) on delete restrict,
  identifier_type text not null check (identifier_type in ('EAN','GTIN','UPC','CHANNEL_SKU','LEGACY','BARCODE')),
  value text not null,
  channel_id uuid,
  active boolean not null default true,
  unique (company_id, identifier_type, value)
);

create table master_data.item_uom_conversions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references master_data.companies(id) on delete restrict,
  item_id uuid not null references master_data.items(id) on delete restrict,
  from_uom_id uuid not null references master_data.uoms(id) on delete restrict,
  to_uom_id uuid not null references master_data.uoms(id) on delete restrict,
  multiplier numeric(18,9) not null check (multiplier > 0),
  effective_from date not null,
  effective_to date,
  unique (item_id, from_uom_id, to_uom_id, effective_from),
  check (from_uom_id <> to_uom_id),
  check (effective_to is null or effective_to >= effective_from)
);

create table master_data.item_mrp_history (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references master_data.companies(id) on delete restrict,
  item_id uuid not null references master_data.items(id) on delete restrict,
  mrp numeric(18,4) not null check (mrp >= 0),
  currency char(3) not null default 'INR',
  effective_from date not null,
  effective_to date,
  unique (item_id, effective_from),
  check (effective_to is null or effective_to >= effective_from)
);

create table master_data.item_approvals (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references master_data.companies(id) on delete restrict,
  item_id uuid not null references master_data.items(id) on delete restrict,
  approval_area text not null check (approval_area in ('CATEGORY_NPD','COSTING','QA','FINANCE')),
  decision text not null check (decision in ('APPROVED','REJECTED')),
  reason text,
  decided_by uuid not null references iam.users(id) on delete restrict,
  decided_at timestamptz not null default statement_timestamp(),
  unique (item_id, approval_area)
);

create table master_data.channels (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references master_data.companies(id) on delete restrict,
  code text not null,
  name text not null,
  channel_type text not null check (channel_type in ('MARKETPLACE','QUICK_COMMERCE','D2C','DISTRIBUTOR','B2B','RETAIL')),
  ingestion_method text not null default 'FILE' check (ingestion_method in ('API','FILE','PORTAL_EXPORT','MANUAL')),
  active boolean not null default true,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  unique (company_id, code),
  unique (company_id, id)
);

alter table master_data.item_identifiers
  add constraint item_identifiers_channel_fk
  foreign key (channel_id) references master_data.channels(id) on delete restrict;

create table master_data.channel_policies (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references master_data.companies(id) on delete restrict,
  channel_id uuid not null references master_data.channels(id) on delete restrict,
  item_id uuid references master_data.items(id) on delete restrict,
  minimum_residual_shelf_life_days integer not null default 0 check (minimum_residual_shelf_life_days >= 0),
  appointment_required boolean not null default true,
  pdi_required boolean not null default false,
  packaging_rules jsonb not null default '{}'::jsonb,
  labelling_rules jsonb not null default '{}'::jsonb,
  sla_rules jsonb not null default '{}'::jsonb,
  effective_from date not null,
  effective_to date,
  check (effective_to is null or effective_to >= effective_from)
);

create table master_data.destination_mappings (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references master_data.companies(id) on delete restrict,
  channel_id uuid not null references master_data.channels(id) on delete restrict,
  destination_key text not null,
  destination_name text not null,
  fc_code text,
  source_site_id uuid not null references master_data.sites(id) on delete restrict,
  source_location_id uuid not null references master_data.locations(id) on delete restrict,
  active boolean not null default true,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  unique (company_id, channel_id, destination_key)
);

create table master_data.routes (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references master_data.companies(id) on delete restrict,
  source_site_id uuid not null references master_data.sites(id) on delete restrict,
  destination_key text not null,
  transit_hours integer not null check (transit_hours > 0),
  estimated_cost numeric(18,4) not null default 0 check (estimated_cost >= 0),
  currency char(3) not null default 'INR',
  active boolean not null default true,
  unique (company_id, source_site_id, destination_key)
);

create table master_data.vendors (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references master_data.companies(id) on delete restrict,
  code text not null,
  legal_name text not null,
  gstin text,
  pan text,
  msme_status text,
  payment_terms_days integer not null default 0 check (payment_terms_days >= 0),
  approval_status text not null default 'DRAFT' check (approval_status in ('DRAFT','PENDING_APPROVAL','APPROVED','BLOCKED','INACTIVE')),
  certificate_expiry date,
  bank_data_encrypted jsonb,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  unique (company_id, code),
  unique (company_id, id)
);

create table master_data.vendor_items (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references master_data.companies(id) on delete restrict,
  vendor_id uuid not null references master_data.vendors(id) on delete restrict,
  item_id uuid not null references master_data.items(id) on delete restrict,
  vendor_item_code text,
  price numeric(18,4) check (price is null or price >= 0),
  currency char(3) not null default 'INR',
  lead_time_days numeric(10,2) not null default 0 check (lead_time_days >= 0),
  minimum_order_qty numeric(18,6) not null default 0 check (minimum_order_qty >= 0),
  capacity_per_day numeric(18,6) check (capacity_per_day is null or capacity_per_day >= 0),
  approved boolean not null default false,
  unique (vendor_id, item_id)
);

create table master_data.customers (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references master_data.companies(id) on delete restrict,
  code text not null,
  name text not null,
  gstin text,
  active boolean not null default true,
  unique (company_id, code),
  unique (company_id, id)
);

create table master_data.transporters (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references master_data.companies(id) on delete restrict,
  code text not null,
  name text not null,
  gstin text,
  active boolean not null default true,
  unique (company_id, code)
);

create table documents.files (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references master_data.companies(id) on delete restrict,
  document_type text not null,
  business_key text,
  current_version integer not null default 0 check (current_version >= 0),
  access_class text not null default 'PRIVATE' check (access_class in ('PRIVATE','COMPANY','RESTRICTED')),
  created_by uuid references iam.users(id) on delete restrict,
  created_at timestamptz not null default statement_timestamp(),
  unique (company_id, document_type, business_key)
);

create table documents.document_versions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references master_data.companies(id) on delete restrict,
  file_id uuid not null references documents.files(id) on delete restrict,
  version_number integer not null check (version_number > 0),
  filename text not null,
  storage_bucket text not null,
  storage_path text not null,
  media_type text not null,
  byte_size bigint check (byte_size is null or byte_size >= 0),
  sha256 text not null,
  replaces_version_id uuid references documents.document_versions(id) on delete restrict,
  uploaded_by uuid references iam.users(id) on delete restrict,
  uploaded_at timestamptz not null default statement_timestamp(),
  unique (file_id, version_number),
  unique (file_id, sha256)
);

create table documents.extraction_runs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references master_data.companies(id) on delete restrict,
  document_version_id uuid not null references documents.document_versions(id) on delete restrict,
  engine text not null,
  engine_version text,
  status text not null check (status in ('PENDING','RUNNING','REVIEW_REQUIRED','COMPLETED','FAILED')),
  overall_confidence numeric(7,6) check (overall_confidence between 0 and 1),
  raw_output jsonb,
  error text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default statement_timestamp()
);

create table documents.extracted_fields (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references master_data.companies(id) on delete restrict,
  extraction_run_id uuid not null references documents.extraction_runs(id) on delete cascade,
  field_path text not null,
  extracted_value jsonb,
  corrected_value jsonb,
  confidence numeric(7,6) check (confidence between 0 and 1),
  reviewed_by uuid references iam.users(id) on delete restrict,
  reviewed_at timestamptz,
  unique (extraction_run_id, field_path)
);

create table documents.document_links (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references master_data.companies(id) on delete restrict,
  document_version_id uuid not null references documents.document_versions(id) on delete restrict,
  entity_type text not null,
  entity_id uuid not null,
  purpose text not null,
  created_at timestamptz not null default statement_timestamp(),
  unique (document_version_id, entity_type, entity_id, purpose)
);

create table workflow.approval_requests (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references master_data.companies(id) on delete restrict,
  approval_type text not null,
  entity_type text not null,
  entity_id uuid not null,
  requested_by uuid not null references iam.users(id) on delete restrict,
  requested_at timestamptz not null default statement_timestamp(),
  status text not null default 'PENDING' check (status in ('PENDING','APPROVED','REJECTED','CANCELLED')),
  reason text,
  resolved_at timestamptz
);

create table workflow.approval_steps (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references master_data.companies(id) on delete restrict,
  approval_request_id uuid not null references workflow.approval_requests(id) on delete restrict,
  step_number integer not null check (step_number > 0),
  required_role text not null,
  approver_id uuid references iam.users(id) on delete restrict,
  decision text check (decision in ('APPROVED','REJECTED','RETURNED')),
  reason text,
  decided_at timestamptz,
  unique (approval_request_id, step_number)
);

create table workflow.status_history (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references master_data.companies(id) on delete restrict,
  entity_type text not null,
  entity_id uuid not null,
  from_status text,
  to_status text not null,
  reason text,
  actor_id uuid references iam.users(id) on delete restrict,
  occurred_at timestamptz not null default statement_timestamp()
);

create table platform.idempotency_keys (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references master_data.companies(id) on delete restrict,
  operation text not null,
  idempotency_key text not null,
  request_hash text,
  status text not null default 'STARTED' check (status in ('STARTED','COMPLETED','FAILED')),
  result jsonb,
  created_at timestamptz not null default statement_timestamp(),
  completed_at timestamptz,
  unique (company_id, operation, idempotency_key)
);

create table platform.audit_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references master_data.companies(id) on delete restrict,
  actor_id uuid references iam.users(id) on delete restrict,
  actor_role text,
  action text not null,
  entity_type text not null,
  entity_id uuid not null,
  old_value jsonb,
  new_value jsonb,
  reason text,
  source text not null default 'API',
  correlation_id uuid,
  occurred_at timestamptz not null default statement_timestamp()
);

create table platform.notifications (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references master_data.companies(id) on delete restrict,
  entity_type text,
  entity_id uuid,
  notification_type text not null,
  recipient text not null,
  subject text,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'PENDING' check (status in ('PENDING','SENDING','SENT','FAILED','CANCELLED','DEAD_LETTER')),
  created_at timestamptz not null default statement_timestamp(),
  sent_at timestamptz
);

create table platform.notification_attempts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references master_data.companies(id) on delete restrict,
  notification_id uuid not null references platform.notifications(id) on delete restrict,
  attempt_number integer not null check (attempt_number > 0),
  started_at timestamptz not null default statement_timestamp(),
  completed_at timestamptz,
  success boolean,
  provider_reference text,
  error text,
  unique (notification_id, attempt_number)
);

create table platform.integration_jobs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references master_data.companies(id) on delete restrict,
  integration_name text not null,
  job_type text not null,
  external_key text,
  payload jsonb not null,
  status text not null default 'PENDING' check (status in ('PENDING','RUNNING','SUCCEEDED','FAILED','DEAD_LETTER','CANCELLED')),
  next_attempt_at timestamptz,
  created_at timestamptz not null default statement_timestamp(),
  completed_at timestamptz,
  unique (company_id, integration_name, job_type, external_key)
);

create table platform.integration_attempts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references master_data.companies(id) on delete restrict,
  integration_job_id uuid not null references platform.integration_jobs(id) on delete restrict,
  attempt_number integer not null check (attempt_number > 0),
  request_payload jsonb,
  response_payload jsonb,
  response_code text,
  error text,
  started_at timestamptz not null default statement_timestamp(),
  completed_at timestamptz,
  unique (integration_job_id, attempt_number)
);

create table platform.outbox_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references master_data.companies(id) on delete restrict,
  aggregate_type text not null,
  aggregate_id uuid not null,
  event_type text not null,
  payload jsonb not null,
  created_at timestamptz not null default statement_timestamp(),
  published_at timestamptz,
  attempts integer not null default 0 check (attempts >= 0),
  last_error text
);

create trigger iam_users_updated_at before update on iam.users
for each row execute function platform.set_updated_at();
create trigger companies_updated_at before update on master_data.companies
for each row execute function platform.set_updated_at();
create trigger sites_updated_at before update on master_data.sites
for each row execute function platform.set_updated_at();
create trigger locations_updated_at before update on master_data.locations
for each row execute function platform.set_updated_at();
create trigger items_updated_at before update on master_data.items
for each row execute function platform.set_updated_at();
create trigger channels_updated_at before update on master_data.channels
for each row execute function platform.set_updated_at();
create trigger mappings_updated_at before update on master_data.destination_mappings
for each row execute function platform.set_updated_at();
create trigger vendors_updated_at before update on master_data.vendors
for each row execute function platform.set_updated_at();

create trigger document_versions_immutable before update or delete on documents.document_versions
for each row execute function platform.reject_mutation();
create trigger audit_events_immutable before update or delete on platform.audit_events
for each row execute function platform.reject_mutation();
create trigger status_history_immutable before update or delete on workflow.status_history
for each row execute function platform.reject_mutation();

create index sites_company_idx on master_data.sites(company_id);
create index locations_company_site_idx on master_data.locations(company_id, site_id);
create index items_company_status_idx on master_data.items(company_id, lifecycle_status);
create index document_links_entity_idx on documents.document_links(company_id, entity_type, entity_id);
create index audit_entity_time_idx on platform.audit_events(company_id, entity_type, entity_id, occurred_at desc);
create index outbox_unpublished_idx on platform.outbox_events(created_at) where published_at is null;

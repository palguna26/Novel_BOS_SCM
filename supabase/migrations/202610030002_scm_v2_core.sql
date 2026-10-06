-- SCM v2 channel-order, inventory-ledger, shipment, POD and invoice core.

create table scm.purchase_orders (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references master_data.companies(id) on delete restrict,
  channel_id uuid not null references master_data.channels(id) on delete restrict,
  external_id text not null,
  po_date timestamptz not null,
  deadline timestamptz,
  destination_key text not null,
  destination_name text not null,
  customer_id uuid references master_data.customers(id) on delete restrict,
  customer_name text,
  source_site_id uuid references master_data.sites(id) on delete restrict,
  source_location_id uuid references master_data.locations(id) on delete restrict,
  currency char(3) not null default 'INR',
  total_value numeric(18,4) not null default 0 check (total_value >= 0),
  status text not null default 'UPLOADED' check (status in (
    'UPLOADED','EXTRACTION_REVIEW_REQUIRED','WAREHOUSE_MAPPING_REQUIRED','UNDER_REVIEW',
    'ACCEPTANCE_PENDING','APPOINTMENT_PENDING','ACCEPTED_AWAITING_APPOINTMENT',
    'APPOINTMENT_MATCHED_AWAITING_ACCEPTANCE','READY_FOR_RESERVATION','INVENTORY_SHORTAGE',
    'INVENTORY_BLOCKED','SHIPMENT_PLANNING','PARTIALLY_DISPATCHED','FULLY_DISPATCHED',
    'PARTIALLY_DELIVERED','DELIVERY_ISSUE','FULLY_DELIVERED','SHORT_CLOSED',
    'INVOICE_UPLOADED','CLOSED','REJECTED','CANCELLED','ON_HOLD'
  )),
  source_document_version_id uuid references documents.document_versions(id) on delete restrict,
  created_by uuid references iam.users(id) on delete restrict,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  unique (company_id, channel_id, external_id),
  unique (company_id, id),
  check ((source_site_id is null) = (source_location_id is null))
);

create table scm.purchase_order_lines (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references master_data.companies(id) on delete restrict,
  purchase_order_id uuid not null references scm.purchase_orders(id) on delete restrict,
  line_number integer not null check (line_number > 0),
  item_id uuid not null references master_data.items(id) on delete restrict,
  channel_item_code text,
  description text,
  ordered_quantity numeric(18,6) not null check (ordered_quantity > 0),
  uom_id uuid not null references master_data.uoms(id) on delete restrict,
  unit_price numeric(18,4) not null default 0 check (unit_price >= 0),
  tax_rate numeric(7,4) not null default 0 check (tax_rate between 0 and 100),
  delivery_window_start timestamptz,
  delivery_window_end timestamptz,
  minimum_residual_shelf_life_days integer not null default 0 check (minimum_residual_shelf_life_days >= 0),
  created_at timestamptz not null default statement_timestamp(),
  unique (purchase_order_id, line_number),
  unique (company_id, id),
  check (delivery_window_end is null or delivery_window_start is null or delivery_window_end >= delivery_window_start)
);

create table scm.acceptance_decisions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references master_data.companies(id) on delete restrict,
  purchase_order_id uuid not null references scm.purchase_orders(id) on delete restrict,
  decision text not null check (decision in ('ACCEPTED','REJECTED','CANCELLED')),
  reason text,
  decided_by uuid not null references iam.users(id) on delete restrict,
  decided_at timestamptz not null default statement_timestamp(),
  supersedes_decision_id uuid references scm.acceptance_decisions(id) on delete restrict,
  active boolean not null default true,
  idempotency_key text not null,
  unique (company_id, idempotency_key)
);

create unique index acceptance_one_active_per_po_uq
  on scm.acceptance_decisions(purchase_order_id) where active;

create table scm.appointments (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references master_data.companies(id) on delete restrict,
  purchase_order_id uuid not null references scm.purchase_orders(id) on delete restrict,
  appointment_number text,
  booking_at timestamptz,
  appointment_at timestamptz not null,
  location_name text,
  destination_code text,
  status text not null default 'BOOKED' check (status in ('PENDING_BOOKING','BOOKED','MATCHED','MISMATCHED','REPLACED','CANCELLED','COMPLETED')),
  match_status text not null default 'PENDING' check (match_status in ('PENDING','MATCHED','MISMATCHED','WAIVED')),
  match_details jsonb not null default '{}'::jsonb,
  supersedes_appointment_id uuid references scm.appointments(id) on delete restrict,
  active boolean not null default true,
  created_by uuid references iam.users(id) on delete restrict,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  idempotency_key text not null,
  unique (company_id, idempotency_key)
);

create unique index appointments_one_active_per_po_uq
  on scm.appointments(purchase_order_id) where active;

create table scm.appointment_documents (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references master_data.companies(id) on delete restrict,
  appointment_id uuid not null references scm.appointments(id) on delete restrict,
  document_version_id uuid not null references documents.document_versions(id) on delete restrict,
  is_primary boolean not null default true,
  created_at timestamptz not null default statement_timestamp(),
  unique (appointment_id, document_version_id)
);

create table scm.warehouse_override_requests (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references master_data.companies(id) on delete restrict,
  purchase_order_id uuid not null references scm.purchase_orders(id) on delete restrict,
  requested_site_id uuid not null references master_data.sites(id) on delete restrict,
  requested_location_id uuid not null references master_data.locations(id) on delete restrict,
  reason text not null,
  status text not null default 'PENDING' check (status in ('PENDING','APPROVED','REJECTED','CANCELLED')),
  requested_by uuid not null references iam.users(id) on delete restrict,
  requested_at timestamptz not null default statement_timestamp(),
  resolved_by uuid references iam.users(id) on delete restrict,
  resolved_at timestamptz
);

create table inventory.batches (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references master_data.companies(id) on delete restrict,
  item_id uuid not null references master_data.items(id) on delete restrict,
  batch_number text not null,
  vendor_batch_number text,
  manufacturing_date date,
  expiry_date date,
  created_at timestamptz not null default statement_timestamp(),
  unique (company_id, item_id, batch_number),
  unique (company_id, id),
  check (expiry_date is null or manufacturing_date is null or expiry_date >= manufacturing_date)
);

create table inventory.stock_transactions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references master_data.companies(id) on delete restrict,
  transaction_type text not null check (transaction_type in ('OPENING','RECEIPT','RESERVE','RELEASE','DISPATCH','DELIVERY','TRANSFER','QUALITY_CHANGE','ADJUSTMENT','RETURN','SCRAP','REVERSAL')),
  document_type text not null,
  document_id uuid not null,
  document_number text,
  posting_at timestamptz not null default statement_timestamp(),
  fiscal_date date not null default current_date,
  status text not null default 'POSTED' check (status in ('POSTED','REVERSED')),
  reverses_transaction_id uuid references inventory.stock_transactions(id) on delete restrict,
  reason text,
  idempotency_key text not null,
  posted_by uuid references iam.users(id) on delete restrict,
  created_at timestamptz not null default statement_timestamp(),
  unique (company_id, idempotency_key),
  unique (company_id, id)
);

create unique index stock_transactions_one_reversal_uq
  on inventory.stock_transactions(reverses_transaction_id)
  where reverses_transaction_id is not null;

create table inventory.stock_ledger_entries (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references master_data.companies(id) on delete restrict,
  stock_transaction_id uuid not null references inventory.stock_transactions(id) on delete restrict,
  line_number integer not null check (line_number > 0),
  site_id uuid not null references master_data.sites(id) on delete restrict,
  location_id uuid not null references master_data.locations(id) on delete restrict,
  item_id uuid not null references master_data.items(id) on delete restrict,
  batch_id uuid references inventory.batches(id) on delete restrict,
  stock_state text not null check (stock_state in ('RELEASED','RESERVED','QUARANTINE','UNDER_TEST','CONDITIONAL_RELEASE','ON_HOLD','MRB','REJECTED','RETURN_TO_VENDOR','IN_TRANSIT','DELIVERED','SCRAP','RETENTION')),
  uom_id uuid not null references master_data.uoms(id) on delete restrict,
  quantity_delta numeric(18,6) not null check (quantity_delta <> 0),
  unit_value numeric(18,6) not null default 0 check (unit_value >= 0),
  value_delta numeric(20,6) not null default 0,
  created_at timestamptz not null default statement_timestamp(),
  unique (stock_transaction_id, line_number)
);

create table inventory.inventory_policies (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references master_data.companies(id) on delete restrict,
  site_id uuid not null references master_data.sites(id) on delete restrict,
  item_id uuid not null references master_data.items(id) on delete restrict,
  threshold_quantity numeric(18,6) not null default 0 check (threshold_quantity >= 0),
  safety_stock numeric(18,6) not null default 0 check (safety_stock >= 0),
  reorder_point numeric(18,6) not null default 0 check (reorder_point >= 0),
  eoq numeric(18,6) not null default 0 check (eoq >= 0),
  maximum_stock numeric(18,6) check (maximum_stock is null or maximum_stock >= 0),
  service_level numeric(7,6) check (service_level is null or service_level between 0 and 1),
  effective_from date not null,
  effective_to date,
  approved_by uuid references iam.users(id) on delete restrict,
  created_at timestamptz not null default statement_timestamp(),
  unique (site_id, item_id, effective_from),
  check (effective_to is null or effective_to >= effective_from)
);

create table inventory.reservations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references master_data.companies(id) on delete restrict,
  purchase_order_id uuid not null references scm.purchase_orders(id) on delete restrict,
  version integer not null default 1 check (version > 0),
  status text not null default 'ACTIVE' check (status in ('ACTIVE','PARTIALLY_DISPATCHED','FULFILLED','RELEASED','CANCELLED','SUPERSEDED')),
  source_site_id uuid not null references master_data.sites(id) on delete restrict,
  source_location_id uuid not null references master_data.locations(id) on delete restrict,
  stock_transaction_id uuid references inventory.stock_transactions(id) on delete restrict,
  idempotency_key text not null,
  created_by uuid references iam.users(id) on delete restrict,
  created_at timestamptz not null default statement_timestamp(),
  released_at timestamptz,
  unique (purchase_order_id, version),
  unique (company_id, idempotency_key),
  unique (company_id, id)
);

create unique index reservations_one_active_per_po_uq
  on inventory.reservations(purchase_order_id)
  where status in ('ACTIVE','PARTIALLY_DISPATCHED');

create table inventory.reservation_lines (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references master_data.companies(id) on delete restrict,
  reservation_id uuid not null references inventory.reservations(id) on delete restrict,
  purchase_order_line_id uuid not null references scm.purchase_order_lines(id) on delete restrict,
  required_quantity numeric(18,6) not null check (required_quantity > 0),
  reserved_quantity numeric(18,6) not null default 0 check (reserved_quantity >= 0),
  shortage_quantity numeric(18,6) generated always as (greatest(required_quantity - reserved_quantity, 0)) stored,
  uom_id uuid not null references master_data.uoms(id) on delete restrict,
  unique (reservation_id, purchase_order_line_id),
  unique (company_id, id),
  check (reserved_quantity <= required_quantity)
);

create table inventory.reservation_allocations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references master_data.companies(id) on delete restrict,
  reservation_line_id uuid not null references inventory.reservation_lines(id) on delete restrict,
  batch_id uuid references inventory.batches(id) on delete restrict,
  location_id uuid not null references master_data.locations(id) on delete restrict,
  quantity numeric(18,6) not null check (quantity > 0),
  dispatched_quantity numeric(18,6) not null default 0 check (dispatched_quantity >= 0),
  released_quantity numeric(18,6) not null default 0 check (released_quantity >= 0),
  unique (reservation_line_id, batch_id, location_id),
  check (dispatched_quantity + released_quantity <= quantity)
);

create table inventory.count_sessions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references master_data.companies(id) on delete restrict,
  site_id uuid not null references master_data.sites(id) on delete restrict,
  count_type text not null check (count_type in ('CYCLE','FULL_STOCK_TAKE','RECOUNT')),
  status text not null default 'PLANNED' check (status in ('PLANNED','FROZEN','COUNTING','REVIEW','APPROVED','POSTED','CANCELLED')),
  blind_count boolean not null default true,
  started_at timestamptz,
  completed_at timestamptz,
  created_by uuid references iam.users(id) on delete restrict,
  created_at timestamptz not null default statement_timestamp()
);

create table inventory.count_lines (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references master_data.companies(id) on delete restrict,
  count_session_id uuid not null references inventory.count_sessions(id) on delete restrict,
  location_id uuid not null references master_data.locations(id) on delete restrict,
  item_id uuid not null references master_data.items(id) on delete restrict,
  batch_id uuid references inventory.batches(id) on delete restrict,
  system_quantity numeric(18,6) not null,
  counted_quantity numeric(18,6),
  counter_id uuid references iam.users(id) on delete restrict,
  counted_at timestamptz,
  reason text
);

create table inventory.adjustments (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references master_data.companies(id) on delete restrict,
  count_line_id uuid references inventory.count_lines(id) on delete restrict,
  item_id uuid not null references master_data.items(id) on delete restrict,
  location_id uuid not null references master_data.locations(id) on delete restrict,
  batch_id uuid references inventory.batches(id) on delete restrict,
  quantity_delta numeric(18,6) not null check (quantity_delta <> 0),
  reason text not null,
  approval_request_id uuid references workflow.approval_requests(id) on delete restrict,
  stock_transaction_id uuid references inventory.stock_transactions(id) on delete restrict,
  created_at timestamptz not null default statement_timestamp()
);

create table scm.shipments (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references master_data.companies(id) on delete restrict,
  shipment_number text not null,
  purchase_order_id uuid not null references scm.purchase_orders(id) on delete restrict,
  reservation_id uuid not null references inventory.reservations(id) on delete restrict,
  appointment_id uuid not null references scm.appointments(id) on delete restrict,
  source_site_id uuid not null references master_data.sites(id) on delete restrict,
  source_location_id uuid not null references master_data.locations(id) on delete restrict,
  transit_location_id uuid not null references master_data.locations(id) on delete restrict,
  destination_name text not null,
  transporter_id uuid references master_data.transporters(id) on delete restrict,
  truck_number text,
  truck_type text,
  truck_capacity numeric(18,6) check (truck_capacity is null or truck_capacity > 0),
  driver_name text,
  driver_phone text,
  status text not null default 'PLANNED' check (status in ('PLANNED','VEHICLE_ASSIGNED','LOADING','DISPATCHED','IN_TRANSIT','ARRIVED','UNLOADING','PARTIALLY_DELIVERED','DELIVERED','DELIVERY_ISSUE','RETURNED','CANCELLED')),
  planned_dispatch_at timestamptz,
  expected_arrival_at timestamptz,
  actual_dispatch_at timestamptz,
  actual_arrival_at timestamptz,
  estimated_cost numeric(18,4) not null default 0 check (estimated_cost >= 0),
  actual_cost numeric(18,4) check (actual_cost is null or actual_cost >= 0),
  currency char(3) not null default 'INR',
  route_snapshot jsonb not null default '{}'::jsonb,
  lr_document_version_id uuid references documents.document_versions(id) on delete restrict,
  dispatch_stock_transaction_id uuid references inventory.stock_transactions(id) on delete restrict,
  idempotency_key text not null,
  created_by uuid references iam.users(id) on delete restrict,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  unique (company_id, shipment_number),
  unique (company_id, idempotency_key),
  unique (company_id, id)
);

create table scm.shipment_lines (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references master_data.companies(id) on delete restrict,
  shipment_id uuid not null references scm.shipments(id) on delete restrict,
  purchase_order_line_id uuid not null references scm.purchase_order_lines(id) on delete restrict,
  reservation_line_id uuid not null references inventory.reservation_lines(id) on delete restrict,
  planned_quantity numeric(18,6) not null check (planned_quantity > 0),
  dispatched_quantity numeric(18,6) not null default 0 check (dispatched_quantity >= 0),
  delivered_quantity numeric(18,6) not null default 0 check (delivered_quantity >= 0),
  damaged_quantity numeric(18,6) not null default 0 check (damaged_quantity >= 0),
  rejected_quantity numeric(18,6) not null default 0 check (rejected_quantity >= 0),
  uom_id uuid not null references master_data.uoms(id) on delete restrict,
  unique (shipment_id, purchase_order_line_id),
  unique (company_id, id),
  check (dispatched_quantity <= planned_quantity),
  check (delivered_quantity + damaged_quantity + rejected_quantity <= dispatched_quantity)
);

create table scm.shipment_line_allocations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references master_data.companies(id) on delete restrict,
  shipment_line_id uuid not null references scm.shipment_lines(id) on delete restrict,
  reservation_allocation_id uuid not null references inventory.reservation_allocations(id) on delete restrict,
  batch_id uuid references inventory.batches(id) on delete restrict,
  source_location_id uuid not null references master_data.locations(id) on delete restrict,
  dispatched_quantity numeric(18,6) not null check (dispatched_quantity > 0),
  delivered_quantity numeric(18,6) not null default 0 check (delivered_quantity >= 0),
  unique (shipment_line_id, reservation_allocation_id),
  check (delivered_quantity <= dispatched_quantity)
);

create table scm.shipment_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references master_data.companies(id) on delete restrict,
  shipment_id uuid not null references scm.shipments(id) on delete restrict,
  status text not null,
  event_at timestamptz not null,
  location_name text,
  notes text,
  attachment_version_id uuid references documents.document_versions(id) on delete restrict,
  entered_by uuid references iam.users(id) on delete restrict,
  created_at timestamptz not null default statement_timestamp()
);

create table scm.shipment_checks (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references master_data.companies(id) on delete restrict,
  shipment_id uuid not null references scm.shipments(id) on delete restrict,
  check_type text not null check (check_type in ('PDI','BARCODE','CASE_LABEL','SHIPPER_MARKING','MRP','ASN_QUANTITY')),
  result text not null check (result in ('PASSED','FAILED','WAIVED')),
  reason text,
  evidence_version_id uuid references documents.document_versions(id) on delete restrict,
  checked_by uuid not null references iam.users(id) on delete restrict,
  checked_at timestamptz not null default statement_timestamp(),
  unique (shipment_id, check_type)
);

create table scm.pods (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references master_data.companies(id) on delete restrict,
  purchase_order_id uuid not null references scm.purchase_orders(id) on delete restrict,
  document_version_id uuid not null references documents.document_versions(id) on delete restrict,
  delivery_at timestamptz,
  receiver_name text,
  status text not null default 'CONFIRMED' check (status in ('DRAFT','CONFIRMED','REPLACED','REVERSED')),
  replaces_pod_id uuid references scm.pods(id) on delete restrict,
  idempotency_key text not null,
  confirmed_by uuid references iam.users(id) on delete restrict,
  confirmed_at timestamptz not null default statement_timestamp(),
  stock_transaction_id uuid references inventory.stock_transactions(id) on delete restrict,
  unique (company_id, idempotency_key),
  unique (company_id, document_version_id),
  unique (company_id, id)
);

create table scm.pod_shipment_links (
  company_id uuid not null references master_data.companies(id) on delete restrict,
  pod_id uuid not null references scm.pods(id) on delete restrict,
  shipment_id uuid not null references scm.shipments(id) on delete restrict,
  primary key (pod_id, shipment_id)
);

create table scm.pod_lines (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references master_data.companies(id) on delete restrict,
  pod_id uuid not null references scm.pods(id) on delete restrict,
  shipment_line_id uuid not null references scm.shipment_lines(id) on delete restrict,
  confirmed_quantity numeric(18,6) not null default 0 check (confirmed_quantity >= 0),
  short_quantity numeric(18,6) not null default 0 check (short_quantity >= 0),
  damaged_quantity numeric(18,6) not null default 0 check (damaged_quantity >= 0),
  rejected_quantity numeric(18,6) not null default 0 check (rejected_quantity >= 0),
  difference_reason text,
  notes text,
  unique (pod_id, shipment_line_id),
  check (confirmed_quantity + short_quantity + damaged_quantity + rejected_quantity > 0)
);

create table scm.delivery_exceptions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references master_data.companies(id) on delete restrict,
  purchase_order_id uuid not null references scm.purchase_orders(id) on delete restrict,
  shipment_id uuid references scm.shipments(id) on delete restrict,
  pod_line_id uuid references scm.pod_lines(id) on delete restrict,
  exception_type text not null check (exception_type in ('SHORT','DAMAGED','REJECTED','MISSING_POD','MISMATCH','OTHER')),
  quantity numeric(18,6) check (quantity is null or quantity > 0),
  reason text not null,
  status text not null default 'OPEN' check (status in ('OPEN','INVESTIGATING','RESOLVED','SHORT_CLOSED','CLAIMED','CANCELLED')),
  owner_id uuid references iam.users(id) on delete restrict,
  resolution text,
  resolved_by uuid references iam.users(id) on delete restrict,
  resolved_at timestamptz,
  created_at timestamptz not null default statement_timestamp()
);

create table scm.short_close_decisions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references master_data.companies(id) on delete restrict,
  purchase_order_id uuid not null references scm.purchase_orders(id) on delete restrict,
  reason text not null,
  remaining_quantity numeric(18,6) not null check (remaining_quantity > 0),
  status text not null default 'APPROVED' check (status in ('PENDING','APPROVED','REJECTED','REVERSED')),
  approval_request_id uuid references workflow.approval_requests(id) on delete restrict,
  approved_by uuid not null references iam.users(id) on delete restrict,
  approved_at timestamptz not null default statement_timestamp(),
  release_stock_transaction_id uuid references inventory.stock_transactions(id) on delete restrict,
  idempotency_key text not null,
  unique (company_id, idempotency_key)
);

create unique index short_close_one_approved_per_po_uq
  on scm.short_close_decisions(purchase_order_id) where status = 'APPROVED';

create table scm.invoices (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references master_data.companies(id) on delete restrict,
  purchase_order_id uuid not null references scm.purchase_orders(id) on delete restrict,
  invoice_number text not null,
  invoice_date date not null,
  amount numeric(18,4) not null check (amount >= 0),
  currency char(3) not null default 'INR',
  document_version_id uuid not null references documents.document_versions(id) on delete restrict,
  recipients jsonb not null default '[]'::jsonb,
  send_status text not null default 'PENDING' check (send_status in ('PENDING','SENDING','SENT','FAILED','DEAD_LETTER')),
  sent_at timestamptz,
  error text,
  uploaded_by uuid references iam.users(id) on delete restrict,
  uploaded_at timestamptz not null default statement_timestamp(),
  unique (purchase_order_id),
  unique (company_id, invoice_number)
);

create table scm.invoice_send_attempts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references master_data.companies(id) on delete restrict,
  invoice_id uuid not null references scm.invoices(id) on delete restrict,
  attempt_number integer not null check (attempt_number > 0),
  recipients jsonb not null,
  status text not null check (status in ('SENDING','SENT','FAILED')),
  provider_reference text,
  error text,
  started_at timestamptz not null default statement_timestamp(),
  completed_at timestamptz,
  unique (invoice_id, attempt_number)
);

create or replace view inventory.stock_balance_v with (security_invoker = true) as
select
  e.company_id,
  e.site_id,
  e.location_id,
  e.item_id,
  e.batch_id,
  e.stock_state,
  e.uom_id,
  sum(e.quantity_delta)::numeric(18,6) as quantity,
  sum(e.value_delta)::numeric(20,6) as value
from inventory.stock_ledger_entries e
join inventory.stock_transactions t on t.id = e.stock_transaction_id
where t.status = 'POSTED'
group by e.company_id, e.site_id, e.location_id, e.item_id, e.batch_id, e.stock_state, e.uom_id
having sum(e.quantity_delta) <> 0;

create or replace view inventory.inventory_summary_v with (security_invoker = true) as
select
  b.company_id,
  b.site_id,
  b.item_id,
  b.uom_id,
  coalesce(sum(b.quantity) filter (where l.location_type not in ('TRANSIT','CUSTOMER','EXTERNAL_SOURCE','EXTERNAL_SINK') and b.stock_state <> 'SCRAP'), 0)::numeric(18,6) as physical,
  coalesce(sum(b.quantity) filter (where b.stock_state = 'RESERVED'), 0)::numeric(18,6) as blocked,
  coalesce(sum(b.quantity) filter (where l.location_type = 'TRANSIT' or b.stock_state = 'IN_TRANSIT'), 0)::numeric(18,6) as in_transit,
  coalesce(sum(b.quantity) filter (where b.stock_state = 'RELEASED' and l.location_type not in ('TRANSIT','CUSTOMER','EXTERNAL_SOURCE','EXTERNAL_SINK')), 0)::numeric(18,6) as released,
  coalesce(p.threshold_quantity, 0)::numeric(18,6) as threshold,
  greatest(
    coalesce(sum(b.quantity) filter (where b.stock_state = 'RELEASED' and l.location_type not in ('TRANSIT','CUSTOMER','EXTERNAL_SOURCE','EXTERNAL_SINK')), 0)
    - coalesce(p.threshold_quantity, 0),
    0
  )::numeric(18,6) as allocatable
from inventory.stock_balance_v b
join master_data.locations l on l.id = b.location_id
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

create or replace view scm.po_gate_state_v with (security_invoker = true) as
select
  po.id as purchase_order_id,
  po.company_id,
  (ad.decision = 'ACCEPTED') as acceptance_complete,
  (ap.match_status in ('MATCHED','WAIVED') and ap.status not in ('CANCELLED','REPLACED')) as appointment_complete,
  (ad.decision = 'ACCEPTED'
    and ap.match_status in ('MATCHED','WAIVED')
    and ap.status not in ('CANCELLED','REPLACED')) as ready_for_reservation,
  ad.decided_at as accepted_at,
  ap.id as appointment_id,
  ap.appointment_at
from scm.purchase_orders po
left join scm.acceptance_decisions ad
  on ad.purchase_order_id = po.id and ad.active
left join scm.appointments ap
  on ap.purchase_order_id = po.id and ap.active;

create trigger purchase_orders_updated_at before update on scm.purchase_orders
for each row execute function platform.set_updated_at();
create trigger appointments_updated_at before update on scm.appointments
for each row execute function platform.set_updated_at();
create trigger shipments_updated_at before update on scm.shipments
for each row execute function platform.set_updated_at();

create trigger stock_transactions_immutable before update or delete on inventory.stock_transactions
for each row execute function platform.reject_mutation();
create trigger stock_ledger_entries_immutable before update or delete on inventory.stock_ledger_entries
for each row execute function platform.reject_mutation();
create trigger shipment_events_immutable before update or delete on scm.shipment_events
for each row execute function platform.reject_mutation();
create trigger pod_lines_immutable before update or delete on scm.pod_lines
for each row execute function platform.reject_mutation();

create index po_company_status_idx on scm.purchase_orders(company_id, status, created_at desc);
create index po_lines_po_idx on scm.purchase_order_lines(purchase_order_id);
create index acceptance_po_idx on scm.acceptance_decisions(purchase_order_id, decided_at desc);
create index appointments_po_idx on scm.appointments(purchase_order_id, created_at desc);
create index stock_ledger_balance_idx on inventory.stock_ledger_entries(company_id, site_id, location_id, item_id, batch_id, stock_state, uom_id);
create index stock_transactions_document_idx on inventory.stock_transactions(company_id, document_type, document_id);
create index reservations_po_idx on inventory.reservations(purchase_order_id, status);
create index shipments_po_idx on scm.shipments(purchase_order_id, status);
create index shipment_lines_shipment_idx on scm.shipment_lines(shipment_id);
create index shipment_line_allocations_line_idx on scm.shipment_line_allocations(shipment_line_id);
create index pods_po_idx on scm.pods(purchase_order_id, confirmed_at desc);
create index delivery_exceptions_open_idx on scm.delivery_exceptions(company_id, status, created_at) where status in ('OPEN','INVESTIGATING');

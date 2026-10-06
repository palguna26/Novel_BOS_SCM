-- Connected BOS and QC modules. These share the core ledger and do not alter the PO workflow.

create table quality.inspection_parameters (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references master_data.companies(id) on delete restrict,
  code text not null,
  name text not null,
  method text,
  uom_id uuid references master_data.uoms(id) on delete restrict,
  data_type text not null check (data_type in ('NUMERIC','ATTRIBUTE','TEXT')),
  criticality text not null check (criticality in ('CRITICAL','MAJOR','MINOR')),
  active boolean not null default true,
  unique (company_id, code)
);

create table quality.inspection_plans (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references master_data.companies(id) on delete restrict,
  item_id uuid not null references master_data.items(id) on delete restrict,
  plan_type text not null check (plan_type in ('IQC','IPQC','FQC','PDI')),
  version integer not null check (version > 0),
  sampling_standard text,
  inspection_level text,
  aql numeric(7,4) check (aql is null or aql >= 0),
  status text not null default 'DRAFT' check (status in ('DRAFT','PENDING_APPROVAL','ACTIVE','SUPERSEDED','INACTIVE')),
  effective_from date not null,
  effective_to date,
  approved_by uuid references iam.users(id) on delete restrict,
  created_at timestamptz not null default statement_timestamp(),
  unique (item_id, plan_type, version),
  check (effective_to is null or effective_to >= effective_from)
);

create table quality.inspection_plan_parameters (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references master_data.companies(id) on delete restrict,
  inspection_plan_id uuid not null references quality.inspection_plans(id) on delete restrict,
  parameter_id uuid not null references quality.inspection_parameters(id) on delete restrict,
  sequence_number integer not null check (sequence_number > 0),
  lower_spec_limit numeric(18,6),
  upper_spec_limit numeric(18,6),
  expected_attribute text,
  sample_frequency text,
  required boolean not null default true,
  unique (inspection_plan_id, parameter_id),
  check (upper_spec_limit is null or lower_spec_limit is null or upper_spec_limit >= lower_spec_limit)
);

create table quality.instruments (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references master_data.companies(id) on delete restrict,
  code text not null,
  name text not null,
  calibration_due_date date,
  status text not null default 'ACTIVE' check (status in ('ACTIVE','CALIBRATION_DUE','BLOCKED','RETIRED')),
  unique (company_id, code)
);

create table quality.inspector_qualifications (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references master_data.companies(id) on delete restrict,
  inspector_id uuid not null references iam.users(id) on delete restrict,
  qualification text not null,
  valid_from date not null,
  valid_to date,
  status text not null default 'ACTIVE' check (status in ('ACTIVE','EXPIRED','SUSPENDED')),
  check (valid_to is null or valid_to >= valid_from)
);

create table quality.inspection_lots (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references master_data.companies(id) on delete restrict,
  lot_number text not null,
  inspection_plan_id uuid not null references quality.inspection_plans(id) on delete restrict,
  item_id uuid not null references master_data.items(id) on delete restrict,
  batch_id uuid references inventory.batches(id) on delete restrict,
  source_type text not null check (source_type in ('GRN','MANUFACTURING','PDI','RETURN','MANUAL')),
  source_id uuid not null,
  lot_quantity numeric(18,6) not null check (lot_quantity > 0),
  sample_size numeric(18,6) not null check (sample_size > 0),
  status text not null default 'OPEN' check (status in ('OPEN','SAMPLING','UNDER_TEST','AWAITING_DISPOSITION','RELEASED','CONDITIONAL_RELEASE','REJECTED','CANCELLED')),
  assigned_inspector_id uuid references iam.users(id) on delete restrict,
  created_at timestamptz not null default statement_timestamp(),
  completed_at timestamptz,
  unique (company_id, lot_number),
  unique (company_id, id)
);

create table quality.inspection_results (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references master_data.companies(id) on delete restrict,
  inspection_lot_id uuid not null references quality.inspection_lots(id) on delete restrict,
  parameter_id uuid not null references quality.inspection_parameters(id) on delete restrict,
  sample_number integer not null check (sample_number > 0),
  numeric_value numeric(18,6),
  attribute_value text,
  result text not null check (result in ('PASS','FAIL','NOT_TESTED')),
  instrument_id uuid references quality.instruments(id) on delete restrict,
  evidence_version_id uuid references documents.document_versions(id) on delete restrict,
  recorded_by uuid not null references iam.users(id) on delete restrict,
  recorded_at timestamptz not null default statement_timestamp(),
  unique (inspection_lot_id, parameter_id, sample_number)
);

create table quality.dispositions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references master_data.companies(id) on delete restrict,
  inspection_lot_id uuid not null references quality.inspection_lots(id) on delete restrict,
  disposition text not null check (disposition in ('RELEASED','CONDITIONAL_RELEASE','ON_HOLD','MRB','REJECTED','RETURN_TO_VENDOR','SCRAP','RETENTION')),
  quantity numeric(18,6) not null check (quantity > 0),
  reason text not null,
  approved_by uuid not null references iam.users(id) on delete restrict,
  approved_at timestamptz not null default statement_timestamp(),
  stock_transaction_id uuid references inventory.stock_transactions(id) on delete restrict,
  unique (inspection_lot_id)
);

create table quality.ncrs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references master_data.companies(id) on delete restrict,
  ncr_number text not null,
  item_id uuid not null references master_data.items(id) on delete restrict,
  batch_id uuid references inventory.batches(id) on delete restrict,
  affected_quantity numeric(18,6) not null check (affected_quantity > 0),
  severity text not null check (severity in ('CRITICAL','MAJOR','MINOR')),
  responsibility text,
  description text not null,
  status text not null default 'OPEN' check (status in ('OPEN','CONTAINED','UNDER_REVIEW','DISPOSITIONED','CLOSED','CANCELLED')),
  evidence_version_id uuid references documents.document_versions(id) on delete restrict,
  owner_id uuid references iam.users(id) on delete restrict,
  created_at timestamptz not null default statement_timestamp(),
  closed_at timestamptz,
  unique (company_id, ncr_number)
);

create table quality.capas (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references master_data.companies(id) on delete restrict,
  capa_number text not null,
  ncr_id uuid references quality.ncrs(id) on delete restrict,
  containment text,
  root_cause text not null,
  corrective_action text not null,
  preventive_action text,
  owner_id uuid not null references iam.users(id) on delete restrict,
  due_date date not null,
  status text not null default 'OPEN' check (status in ('OPEN','IN_PROGRESS','EFFECTIVENESS_REVIEW','EFFECTIVE','INEFFECTIVE','CLOSED')),
  effectiveness_evidence_version_id uuid references documents.document_versions(id) on delete restrict,
  closed_at timestamptz,
  unique (company_id, capa_number)
);

create table quality.complaints (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references master_data.companies(id) on delete restrict,
  complaint_number text not null,
  item_id uuid not null references master_data.items(id) on delete restrict,
  batch_id uuid references inventory.batches(id) on delete restrict,
  channel_id uuid references master_data.channels(id) on delete restrict,
  description text not null,
  severity text not null check (severity in ('CRITICAL','MAJOR','MINOR')),
  status text not null default 'OPEN' check (status in ('OPEN','INVESTIGATING','RESOLVED','CLOSED')),
  received_at timestamptz not null,
  closed_at timestamptz,
  unique (company_id, complaint_number)
);

create table quality.recalls (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references master_data.companies(id) on delete restrict,
  recall_number text not null,
  recall_type text not null check (recall_type in ('ACTUAL','MOCK')),
  item_id uuid not null references master_data.items(id) on delete restrict,
  batch_id uuid references inventory.batches(id) on delete restrict,
  initiated_at timestamptz not null,
  target_quantity numeric(18,6) not null check (target_quantity > 0),
  recovered_quantity numeric(18,6) not null default 0 check (recovered_quantity >= 0),
  status text not null default 'OPEN' check (status in ('OPEN','IN_PROGRESS','RECONCILED','CLOSED')),
  owner_id uuid not null references iam.users(id) on delete restrict,
  unique (company_id, recall_number),
  check (recovered_quantity <= target_quantity)
);

create table planning.demand_observations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references master_data.companies(id) on delete restrict,
  observation_date date not null,
  channel_id uuid not null references master_data.channels(id) on delete restrict,
  site_id uuid references master_data.sites(id) on delete restrict,
  item_id uuid not null references master_data.items(id) on delete restrict,
  sales_quantity numeric(18,6) not null default 0 check (sales_quantity >= 0),
  stock_quantity numeric(18,6) not null default 0 check (stock_quantity >= 0),
  stockout_days numeric(7,3) not null default 0 check (stockout_days >= 0),
  listing_suppressed boolean not null default false,
  price numeric(18,4) check (price is null or price >= 0),
  promotion_flag boolean not null default false,
  event_tags jsonb not null default '[]'::jsonb,
  unique (company_id, observation_date, channel_id, site_id, item_id)
);

create table planning.forecast_runs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references master_data.companies(id) on delete restrict,
  run_number text not null,
  horizon_type text not null check (horizon_type in ('DAILY_13_WEEK','MONTHLY_12_MONTH')),
  status text not null default 'RUNNING' check (status in ('RUNNING','REVIEW','SIGNED_OFF','FAILED','SUPERSEDED')),
  model_summary jsonb not null default '{}'::jsonb,
  started_at timestamptz not null default statement_timestamp(),
  completed_at timestamptz,
  signed_off_by uuid references iam.users(id) on delete restrict,
  unique (company_id, run_number)
);

create table planning.forecasts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references master_data.companies(id) on delete restrict,
  forecast_run_id uuid not null references planning.forecast_runs(id) on delete restrict,
  period_start date not null,
  channel_id uuid not null references master_data.channels(id) on delete restrict,
  site_id uuid references master_data.sites(id) on delete restrict,
  item_id uuid not null references master_data.items(id) on delete restrict,
  statistical_quantity numeric(18,6) not null check (statistical_quantity >= 0),
  override_quantity numeric(18,6) check (override_quantity is null or override_quantity >= 0),
  final_quantity numeric(18,6) not null check (final_quantity >= 0),
  override_reason text,
  wmape numeric(9,6),
  bias numeric(18,6),
  unique (forecast_run_id, period_start, channel_id, site_id, item_id)
);

create table planning.mrp_runs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references master_data.companies(id) on delete restrict,
  run_number text not null,
  horizon_start date not null,
  horizon_end date not null,
  status text not null default 'RUNNING' check (status in ('RUNNING','COMPLETED','FAILED','CANCELLED')),
  parameters jsonb not null default '{}'::jsonb,
  started_at timestamptz not null default statement_timestamp(),
  completed_at timestamptz,
  unique (company_id, run_number),
  check (horizon_end >= horizon_start)
);

create table planning.mrp_suggestions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references master_data.companies(id) on delete restrict,
  mrp_run_id uuid not null references planning.mrp_runs(id) on delete restrict,
  site_id uuid not null references master_data.sites(id) on delete restrict,
  item_id uuid not null references master_data.items(id) on delete restrict,
  suggestion_type text not null check (suggestion_type in ('PURCHASE','MANUFACTURE','TRANSFER')),
  gross_requirement numeric(18,6) not null check (gross_requirement >= 0),
  available_quantity numeric(18,6) not null,
  safety_stock numeric(18,6) not null default 0 check (safety_stock >= 0),
  net_requirement numeric(18,6) not null check (net_requirement >= 0),
  suggested_quantity numeric(18,6) not null check (suggested_quantity > 0),
  required_date date not null,
  release_date date not null,
  pegging jsonb not null default '[]'::jsonb,
  status text not null default 'PROPOSED' check (status in ('PROPOSED','APPROVED','REJECTED','RELEASED','CANCELLED')),
  planner_reason text
);

create table planning.redistribution_suggestions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references master_data.companies(id) on delete restrict,
  item_id uuid not null references master_data.items(id) on delete restrict,
  from_site_id uuid not null references master_data.sites(id) on delete restrict,
  to_site_id uuid not null references master_data.sites(id) on delete restrict,
  quantity numeric(18,6) not null check (quantity > 0),
  estimated_cost numeric(18,4) not null default 0 check (estimated_cost >= 0),
  estimated_benefit numeric(18,4) not null default 0 check (estimated_benefit >= 0),
  reason text not null,
  status text not null default 'PROPOSED' check (status in ('PROPOSED','APPROVED','REJECTED','EXECUTED','CANCELLED')),
  created_at timestamptz not null default statement_timestamp(),
  check (from_site_id <> to_site_id)
);

create table procurement.rfqs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references master_data.companies(id) on delete restrict,
  rfq_number text not null,
  required_by date not null,
  status text not null default 'DRAFT' check (status in ('DRAFT','ISSUED','CLOSED','CANCELLED')),
  created_by uuid references iam.users(id) on delete restrict,
  created_at timestamptz not null default statement_timestamp(),
  unique (company_id, rfq_number)
);

create table procurement.rfq_lines (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references master_data.companies(id) on delete restrict,
  rfq_id uuid not null references procurement.rfqs(id) on delete restrict,
  line_number integer not null check (line_number > 0),
  item_id uuid not null references master_data.items(id) on delete restrict,
  quantity numeric(18,6) not null check (quantity > 0),
  uom_id uuid not null references master_data.uoms(id) on delete restrict,
  unique (rfq_id, line_number)
);

create table procurement.vendor_quotes (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references master_data.companies(id) on delete restrict,
  rfq_id uuid not null references procurement.rfqs(id) on delete restrict,
  vendor_id uuid not null references master_data.vendors(id) on delete restrict,
  quote_number text not null,
  quote_date date not null,
  currency char(3) not null default 'INR',
  landed_cost_total numeric(18,4) not null default 0 check (landed_cost_total >= 0),
  status text not null default 'RECEIVED' check (status in ('RECEIVED','EVALUATED','SELECTED','REJECTED')),
  document_version_id uuid references documents.document_versions(id) on delete restrict,
  unique (company_id, vendor_id, quote_number)
);

create table procurement.purchase_orders (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references master_data.companies(id) on delete restrict,
  po_number text not null,
  vendor_id uuid not null references master_data.vendors(id) on delete restrict,
  site_id uuid not null references master_data.sites(id) on delete restrict,
  po_date date not null,
  expected_date date,
  currency char(3) not null default 'INR',
  status text not null default 'DRAFT' check (status in ('DRAFT','SUBMITTED','APPROVED','ISSUED','ACKNOWLEDGED','PARTIALLY_RECEIVED','RECEIVED','CLOSED','CANCELLED','AMENDED')),
  version integer not null default 1 check (version > 0),
  approval_request_id uuid references workflow.approval_requests(id) on delete restrict,
  created_by uuid references iam.users(id) on delete restrict,
  created_at timestamptz not null default statement_timestamp(),
  unique (company_id, po_number, version),
  unique (company_id, id)
);

create table procurement.purchase_order_lines (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references master_data.companies(id) on delete restrict,
  purchase_order_id uuid not null references procurement.purchase_orders(id) on delete restrict,
  line_number integer not null check (line_number > 0),
  item_id uuid not null references master_data.items(id) on delete restrict,
  ordered_quantity numeric(18,6) not null check (ordered_quantity > 0),
  uom_id uuid not null references master_data.uoms(id) on delete restrict,
  unit_price numeric(18,4) not null check (unit_price >= 0),
  expected_date date,
  unique (purchase_order_id, line_number),
  unique (company_id, id)
);

create table procurement.asns (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references master_data.companies(id) on delete restrict,
  asn_number text not null,
  purchase_order_id uuid not null references procurement.purchase_orders(id) on delete restrict,
  expected_arrival_at timestamptz,
  transporter_name text,
  lr_number text,
  status text not null default 'SUBMITTED' check (status in ('SUBMITTED','IN_TRANSIT','ARRIVED','RECEIVED','CANCELLED')),
  created_at timestamptz not null default statement_timestamp(),
  unique (company_id, asn_number),
  unique (company_id, id)
);

create table procurement.gate_entries (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references master_data.companies(id) on delete restrict,
  gate_entry_number text not null,
  site_id uuid not null references master_data.sites(id) on delete restrict,
  asn_id uuid references procurement.asns(id) on delete restrict,
  vehicle_number text not null,
  arrived_at timestamptz not null,
  exited_at timestamptz,
  gross_weight numeric(18,6),
  tare_weight numeric(18,6),
  damage_evidence_version_id uuid references documents.document_versions(id) on delete restrict,
  unique (company_id, gate_entry_number)
);

create table procurement.goods_receipts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references master_data.companies(id) on delete restrict,
  grn_number text not null,
  purchase_order_id uuid not null references procurement.purchase_orders(id) on delete restrict,
  asn_id uuid references procurement.asns(id) on delete restrict,
  gate_entry_id uuid not null references procurement.gate_entries(id) on delete restrict,
  site_id uuid not null references master_data.sites(id) on delete restrict,
  quarantine_location_id uuid not null references master_data.locations(id) on delete restrict,
  receipt_at timestamptz not null,
  status text not null default 'RECEIVED_TO_QUARANTINE' check (status in ('RECEIVED_TO_QUARANTINE','UNDER_QC','PARTIALLY_RELEASED','RELEASED','REJECTED','CANCELLED')),
  stock_transaction_id uuid references inventory.stock_transactions(id) on delete restrict,
  received_by uuid references iam.users(id) on delete restrict,
  unique (company_id, grn_number),
  unique (company_id, id)
);

create table procurement.goods_receipt_lines (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references master_data.companies(id) on delete restrict,
  goods_receipt_id uuid not null references procurement.goods_receipts(id) on delete restrict,
  purchase_order_line_id uuid not null references procurement.purchase_order_lines(id) on delete restrict,
  item_id uuid not null references master_data.items(id) on delete restrict,
  batch_id uuid references inventory.batches(id) on delete restrict,
  received_quantity numeric(18,6) not null check (received_quantity > 0),
  uom_id uuid not null references master_data.uoms(id) on delete restrict,
  inspection_lot_id uuid references quality.inspection_lots(id) on delete restrict,
  unique (goods_receipt_id, purchase_order_line_id, batch_id)
);

create table procurement.invoice_matches (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references master_data.companies(id) on delete restrict,
  vendor_id uuid not null references master_data.vendors(id) on delete restrict,
  invoice_document_version_id uuid not null references documents.document_versions(id) on delete restrict,
  purchase_order_id uuid not null references procurement.purchase_orders(id) on delete restrict,
  goods_receipt_id uuid not null references procurement.goods_receipts(id) on delete restrict,
  quantity_variance numeric(18,6) not null default 0,
  rate_variance numeric(18,6) not null default 0,
  status text not null check (status in ('MATCHED','EXCEPTION','APPROVED_WITH_TOLERANCE','REJECTED')),
  exception_reason text,
  created_at timestamptz not null default statement_timestamp()
);

create table procurement.vendor_scorecards (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references master_data.companies(id) on delete restrict,
  vendor_id uuid not null references master_data.vendors(id) on delete restrict,
  period_start date not null,
  period_end date not null,
  quality_score numeric(7,4),
  delivery_score numeric(7,4),
  cost_score numeric(7,4),
  responsiveness_score numeric(7,4),
  compliance_score numeric(7,4),
  overall_score numeric(7,4),
  unique (vendor_id, period_start, period_end),
  check (period_end >= period_start)
);

create table manufacturing.boms (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references master_data.companies(id) on delete restrict,
  parent_item_id uuid not null references master_data.items(id) on delete restrict,
  version integer not null check (version > 0),
  effective_from date not null,
  effective_to date,
  status text not null default 'DRAFT' check (status in ('DRAFT','PENDING_APPROVAL','ACTIVE','SUPERSEDED','INACTIVE')),
  approval_request_id uuid references workflow.approval_requests(id) on delete restrict,
  unique (parent_item_id, version),
  unique (company_id, id),
  check (effective_to is null or effective_to >= effective_from)
);

create table manufacturing.bom_lines (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references master_data.companies(id) on delete restrict,
  bom_id uuid not null references manufacturing.boms(id) on delete restrict,
  line_number integer not null check (line_number > 0),
  component_item_id uuid not null references master_data.items(id) on delete restrict,
  quantity numeric(18,9) not null check (quantity > 0),
  uom_id uuid not null references master_data.uoms(id) on delete restrict,
  wastage_percent numeric(7,4) not null default 0 check (wastage_percent >= 0),
  phantom boolean not null default false,
  substitution_group text,
  unique (bom_id, line_number)
);

create table manufacturing.work_centres (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references master_data.companies(id) on delete restrict,
  site_id uuid not null references master_data.sites(id) on delete restrict,
  code text not null,
  name text not null,
  active boolean not null default true,
  unique (company_id, site_id, code),
  unique (company_id, id)
);

create table manufacturing.machines (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references master_data.companies(id) on delete restrict,
  work_centre_id uuid not null references manufacturing.work_centres(id) on delete restrict,
  code text not null,
  name text not null,
  status text not null default 'AVAILABLE' check (status in ('AVAILABLE','RUNNING','DOWN','MAINTENANCE','RETIRED')),
  unique (company_id, code),
  unique (company_id, id)
);

create table manufacturing.routings (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references master_data.companies(id) on delete restrict,
  item_id uuid not null references master_data.items(id) on delete restrict,
  version integer not null check (version > 0),
  status text not null default 'DRAFT' check (status in ('DRAFT','PENDING_APPROVAL','ACTIVE','SUPERSEDED','INACTIVE')),
  effective_from date not null,
  effective_to date,
  unique (item_id, version),
  unique (company_id, id),
  check (effective_to is null or effective_to >= effective_from)
);

create table manufacturing.routing_operations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references master_data.companies(id) on delete restrict,
  routing_id uuid not null references manufacturing.routings(id) on delete restrict,
  operation_number integer not null check (operation_number > 0),
  name text not null,
  work_centre_id uuid not null references manufacturing.work_centres(id) on delete restrict,
  setup_minutes numeric(12,3) not null default 0 check (setup_minutes >= 0),
  cycle_minutes numeric(12,3) not null default 0 check (cycle_minutes >= 0),
  labour_minutes numeric(12,3) not null default 0 check (labour_minutes >= 0),
  line_clearance_required boolean not null default false,
  unique (routing_id, operation_number)
);

create table manufacturing.manufacturing_orders (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references master_data.companies(id) on delete restrict,
  order_number text not null,
  site_id uuid not null references master_data.sites(id) on delete restrict,
  item_id uuid not null references master_data.items(id) on delete restrict,
  bom_id uuid not null references manufacturing.boms(id) on delete restrict,
  routing_id uuid not null references manufacturing.routings(id) on delete restrict,
  planned_quantity numeric(18,6) not null check (planned_quantity > 0),
  completed_quantity numeric(18,6) not null default 0 check (completed_quantity >= 0),
  scrap_quantity numeric(18,6) not null default 0 check (scrap_quantity >= 0),
  planned_start_at timestamptz,
  planned_end_at timestamptz,
  actual_start_at timestamptz,
  actual_end_at timestamptz,
  status text not null default 'PLANNED' check (status in ('PLANNED','RELEASED','IN_PROGRESS','ON_HOLD','COMPLETED','CLOSED','CANCELLED')),
  unique (company_id, order_number),
  unique (company_id, id),
  check (completed_quantity + scrap_quantity <= planned_quantity)
);

create table manufacturing.material_transactions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references master_data.companies(id) on delete restrict,
  manufacturing_order_id uuid not null references manufacturing.manufacturing_orders(id) on delete restrict,
  transaction_type text not null check (transaction_type in ('ISSUE','CONSUME','RETURN','SCRAP','RECEIPT')),
  item_id uuid not null references master_data.items(id) on delete restrict,
  batch_id uuid references inventory.batches(id) on delete restrict,
  quantity numeric(18,6) not null check (quantity > 0),
  stock_transaction_id uuid not null references inventory.stock_transactions(id) on delete restrict,
  occurred_at timestamptz not null default statement_timestamp()
);

create table manufacturing.downtime_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references master_data.companies(id) on delete restrict,
  machine_id uuid not null references manufacturing.machines(id) on delete restrict,
  manufacturing_order_id uuid references manufacturing.manufacturing_orders(id) on delete restrict,
  reason_code text not null,
  started_at timestamptz not null,
  ended_at timestamptz,
  notes text,
  check (ended_at is null or ended_at >= started_at)
);

create table manufacturing.maintenance_orders (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references master_data.companies(id) on delete restrict,
  order_number text not null,
  machine_id uuid not null references manufacturing.machines(id) on delete restrict,
  maintenance_type text not null check (maintenance_type in ('PREVENTIVE','BREAKDOWN','CALIBRATION')),
  scheduled_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  status text not null default 'PLANNED' check (status in ('PLANNED','IN_PROGRESS','COMPLETED','CANCELLED')),
  unique (company_id, order_number)
);

create table finance.fiscal_periods (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references master_data.companies(id) on delete restrict,
  period_name text not null,
  starts_on date not null,
  ends_on date not null,
  status text not null default 'OPEN' check (status in ('OPEN','CLOSED','REOPENED')),
  closed_by uuid references iam.users(id) on delete restrict,
  closed_at timestamptz,
  reopen_approval_request_id uuid references workflow.approval_requests(id) on delete restrict,
  unique (company_id, period_name),
  check (ends_on >= starts_on)
);

create table finance.valuation_ledger (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references master_data.companies(id) on delete restrict,
  stock_transaction_id uuid not null references inventory.stock_transactions(id) on delete restrict,
  site_id uuid not null references master_data.sites(id) on delete restrict,
  item_id uuid not null references master_data.items(id) on delete restrict,
  batch_id uuid references inventory.batches(id) on delete restrict,
  quantity_delta numeric(18,6) not null check (quantity_delta <> 0),
  unit_cost numeric(18,6) not null check (unit_cost >= 0),
  value_delta numeric(20,6) not null,
  moving_average_after numeric(18,6) not null check (moving_average_after >= 0),
  posting_at timestamptz not null,
  created_at timestamptz not null default statement_timestamp()
);

create table finance.landed_cost_allocations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references master_data.companies(id) on delete restrict,
  goods_receipt_id uuid not null references procurement.goods_receipts(id) on delete restrict,
  cost_type text not null,
  allocation_basis text not null check (allocation_basis in ('VALUE','WEIGHT','VOLUME','QUANTITY','MANUAL')),
  total_cost numeric(18,4) not null check (total_cost >= 0),
  currency char(3) not null default 'INR',
  created_at timestamptz not null default statement_timestamp()
);

create table finance.accounting_exports (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references master_data.companies(id) on delete restrict,
  export_type text not null check (export_type in ('TALLY','GSP','CUSTOM')),
  period_start date not null,
  period_end date not null,
  control_count integer not null default 0 check (control_count >= 0),
  control_total numeric(20,4) not null default 0,
  status text not null default 'PENDING' check (status in ('PENDING','SENT','ACKNOWLEDGED','FAILED','REPROCESSING')),
  acknowledgement text,
  document_version_id uuid references documents.document_versions(id) on delete restrict,
  created_at timestamptz not null default statement_timestamp(),
  check (period_end >= period_start)
);

create trigger inspection_results_immutable before update or delete on quality.inspection_results
for each row execute function platform.reject_mutation();
create trigger quality_dispositions_immutable before update or delete on quality.dispositions
for each row execute function platform.reject_mutation();
create trigger valuation_ledger_immutable before update or delete on finance.valuation_ledger
for each row execute function platform.reject_mutation();

create index inspection_lots_item_status_idx on quality.inspection_lots(company_id, item_id, status);
create index demand_observations_lookup_idx on planning.demand_observations(company_id, item_id, observation_date desc);
create index forecasts_lookup_idx on planning.forecasts(company_id, item_id, period_start);
create index mrp_suggestions_status_idx on planning.mrp_suggestions(company_id, status, required_date);
create index procurement_po_vendor_status_idx on procurement.purchase_orders(company_id, vendor_id, status);
create index grn_po_idx on procurement.goods_receipts(purchase_order_id, receipt_at desc);
create index manufacturing_orders_status_idx on manufacturing.manufacturing_orders(company_id, site_id, status);
create index valuation_lookup_idx on finance.valuation_ledger(company_id, site_id, item_id, posting_at);

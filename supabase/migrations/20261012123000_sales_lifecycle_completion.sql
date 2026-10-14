-- Lifecycle fields required by the Sales integration contract.

alter table scm.purchase_order_lines
  add column if not exists updated_at timestamptz not null default statement_timestamp();

alter table inventory.stock_ledger_entries
  drop constraint if exists stock_ledger_entries_stock_state_check;

alter table inventory.stock_ledger_entries
  add constraint stock_ledger_entries_stock_state_check check (stock_state in (
    'RELEASED','RESERVED','QUARANTINE','UNDER_TEST','CONDITIONAL_RELEASE','ON_HOLD','MRB',
    'REJECTED','DAMAGED','RETURN_TO_VENDOR','IN_TRANSIT','DELIVERED','SCRAP','RETENTION'
  ));

create table if not exists scm.acceptance_decision_lines (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references master_data.companies(id) on delete restrict,
  acceptance_decision_id uuid not null references scm.acceptance_decisions(id) on delete restrict,
  purchase_order_line_id uuid not null references scm.purchase_order_lines(id) on delete restrict,
  accepted_quantity numeric(18,6) not null default 0 check (accepted_quantity >= 0),
  rejected_quantity numeric(18,6) not null default 0 check (rejected_quantity >= 0),
  reason text,
  created_at timestamptz not null default statement_timestamp(),
  unique (acceptance_decision_id, purchase_order_line_id)
);

create table if not exists scm.appointment_purchase_orders (
  company_id uuid not null references master_data.companies(id) on delete restrict,
  appointment_id uuid not null references scm.appointments(id) on delete restrict,
  purchase_order_id uuid not null references scm.purchase_orders(id) on delete restrict,
  linked_at timestamptz not null default statement_timestamp(),
  primary key (appointment_id, purchase_order_id)
);

insert into scm.appointment_purchase_orders(company_id, appointment_id, purchase_order_id)
select company_id, id, purchase_order_id from scm.appointments
on conflict do nothing;

alter table scm.appointments
  add column if not exists scheduled_start_at timestamptz,
  add column if not exists scheduled_end_at timestamptz,
  add column if not exists confirmation_number text,
  add column if not exists confirmed_at timestamptz,
  add column if not exists cancelled_at timestamptz,
  add column if not exists cancellation_reason text,
  add column if not exists rescheduled_from_id uuid references scm.appointments(id) on delete restrict;

create table if not exists scm.short_close_decision_lines (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references master_data.companies(id) on delete restrict,
  short_close_decision_id uuid not null references scm.short_close_decisions(id) on delete restrict,
  purchase_order_line_id uuid not null references scm.purchase_order_lines(id) on delete restrict,
  approved_quantity numeric(18,6) not null check (approved_quantity > 0),
  reason text,
  created_at timestamptz not null default statement_timestamp(),
  unique (short_close_decision_id, purchase_order_line_id)
);

create table if not exists scm.ownership_transfer_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references master_data.companies(id) on delete restrict,
  purchase_order_id uuid not null references scm.purchase_orders(id) on delete restrict,
  shipment_id uuid references scm.shipments(id) on delete restrict,
  pod_id uuid references scm.pods(id) on delete restrict,
  event_type text not null check (event_type in ('TRANSFERRED','REVERSED')),
  transferred_at timestamptz not null,
  basis text not null check (basis in ('POD_APPROVAL','CUSTOMER_RECEIPT','CONTRACTUAL_EVENT','MANUAL_APPROVED')),
  recorded_by uuid references iam.users(id) on delete restrict,
  created_at timestamptz not null default statement_timestamp()
);

alter table scm.invoices
  drop constraint if exists invoices_purchase_order_id_key,
  add column if not exists invoice_type text not null default 'INVOICE',
  add column if not exists supersedes_invoice_id uuid references scm.invoices(id) on delete restrict,
  add column if not exists active boolean not null default true;

alter table scm.invoices
  drop constraint if exists invoices_invoice_type_check;

alter table scm.invoices
  add constraint invoices_invoice_type_check check (invoice_type in ('INVOICE','CREDIT_NOTE','DEBIT_NOTE'));

alter table scm.pods
  drop constraint if exists pods_status_check;

alter table scm.pods
  add constraint pods_status_check check (status in ('DRAFT','SUBMITTED','APPROVED','REJECTED','CONFIRMED','REPLACED','REVERSED'));

create or replace view integration.po_line_state_v with (security_invoker = true) as
select
  pol.company_id,
  pol.id as purchase_order_line_id,
  pol.purchase_order_id,
  pol.item_id,
  pol.uom_id,
  pol.ordered_quantity,
  coalesce(sum(adl.accepted_quantity) filter (where ad.decision = 'ACCEPTED' and ad.active), pol.ordered_quantity)::numeric(18,6) as accepted_quantity,
  coalesce(sum(adl.rejected_quantity) filter (where ad.decision = 'ACCEPTED' and ad.active), 0)::numeric(18,6) as rejected_quantity,
  coalesce((select sum(rl.reserved_quantity) from inventory.reservation_lines rl join inventory.reservations r on r.id = rl.reservation_id where rl.purchase_order_line_id = pol.id and r.status not in ('CANCELLED','SUPERSEDED')), 0)::numeric(18,6) as reserved_quantity,
  coalesce((select sum(sl.dispatched_quantity) from scm.shipment_lines sl where sl.purchase_order_line_id = pol.id), 0)::numeric(18,6) as dispatched_quantity,
  coalesce((select sum(sl.delivered_quantity) from scm.shipment_lines sl where sl.purchase_order_line_id = pol.id), 0)::numeric(18,6) as delivered_quantity,
  coalesce((select sum(sl.damaged_quantity) from scm.shipment_lines sl where sl.purchase_order_line_id = pol.id), 0)::numeric(18,6) as damaged_quantity,
  coalesce((select sum(sl.rejected_quantity) from scm.shipment_lines sl where sl.purchase_order_line_id = pol.id), 0)::numeric(18,6) as delivery_rejected_quantity,
  coalesce((select sum(scl.approved_quantity) from scm.short_close_decision_lines scl join scm.short_close_decisions scd on scd.id = scl.short_close_decision_id where scl.purchase_order_line_id = pol.id and scd.status = 'APPROVED'), 0)::numeric(18,6) as approved_short_close_quantity,
  greatest(
    coalesce(sum(adl.accepted_quantity) filter (where ad.decision = 'ACCEPTED' and ad.active), pol.ordered_quantity)
    - coalesce((select sum(sl.delivered_quantity) from scm.shipment_lines sl where sl.purchase_order_line_id = pol.id), 0)
    - coalesce((select sum(sl.damaged_quantity + sl.rejected_quantity) from scm.shipment_lines sl where sl.purchase_order_line_id = pol.id), 0)
    - coalesce((select sum(scl.approved_quantity) from scm.short_close_decision_lines scl join scm.short_close_decisions scd on scd.id = scl.short_close_decision_id where scl.purchase_order_line_id = pol.id and scd.status = 'APPROVED'), 0), 0
  )::numeric(18,6) as outstanding_quantity
from scm.purchase_order_lines pol
left join scm.acceptance_decision_lines adl on adl.purchase_order_line_id = pol.id
left join scm.acceptance_decisions ad on ad.id = adl.acceptance_decision_id
group by pol.company_id, pol.id, pol.purchase_order_id, pol.item_id, pol.uom_id, pol.ordered_quantity;

create index if not exists acceptance_lines_po_line_idx on scm.acceptance_decision_lines(purchase_order_line_id);
create index if not exists appointment_po_links_po_idx on scm.appointment_purchase_orders(purchase_order_id);
create index if not exists short_close_lines_po_line_idx on scm.short_close_decision_lines(purchase_order_line_id);
create index if not exists ownership_transfer_po_idx on scm.ownership_transfer_events(purchase_order_id, transferred_at);

grant select on integration.po_line_state_v to service_role;

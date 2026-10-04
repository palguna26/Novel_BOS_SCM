# SCM v2 Channel Workflow Cutover Design

## Purpose

Complete the channel purchase-order workflow defined in `SCM_ENRICHED.md` and the supporting business documents. The first delivery stage connects the existing React and NestJS application to the namespaced SCM v2 database model. Later BOS modules will build on the same masters, document, workflow, ledger, audit and notification foundations.

## Scope

This stage delivers the operational path from PO document intake through closure:

- Document upload, extraction, review and duplicate prevention.
- Destination mapping and controlled warehouse override.
- Independent PO acceptance and appointment gates.
- One atomic inventory reservation after both gates complete.
- Shortage visibility without silent warehouse switching.
- Multi-truck shipment planning and dispatch.
- Shipment events, POD reconciliation and delivery exceptions.
- Short close, invoice upload and PO closure.
- Role-aware queues, reports, notifications and append-only audit history.

The broader quality, planning, procurement, inbound, manufacturing, costing and control-tower modules remain in the full product scope. They follow after the channel workflow is running on the shared v2 foundations.

## Architecture

The namespaced v2 PostgreSQL model is the source of truth. The NestJS API calls controlled database functions for workflow writes and reads from compatibility or dedicated query views. The React application calls the API only and does not write directly to Supabase.

The current `public.*` MVP tables stay available during cutover but receive no new production workflow writes after activation. They provide a rollback and comparison source until reconciliation passes.

Core ownership is:

- `master_data`: companies, sites, locations, items, channels, mappings and routes.
- `documents`: immutable files, versions, extraction runs and reviewed fields.
- `workflow`: approvals and status history.
- `scm`: POs, gates, appointments, shipments, PODs, exceptions, short close and invoices.
- `inventory`: batches, policies, reservations and the append-only stock ledger.
- `platform`: audit, idempotency, notifications, attempts, outbox and integration jobs.
- `compat`: temporary read shapes used during controlled migration.

## Components

### API adapter

Split the current large service into focused modules for authentication, documents, masters, purchase orders, inventory, appointments, shipments, delivery, invoices, notifications, reports and audit. Each module validates input, checks permissions and calls one database operation for each state-changing business action.

Every stock-changing request carries an idempotency key. Actor identity comes from the authenticated session and never from a client-supplied user ID.

### Document intake

Store every source file immutably with its SHA-256 hash. Classify the document, extract platform-specific fields, retain raw values and confidence, and show corrected values beside the source document. Unknown items, destinations, unreadable documents and ambiguous appointment matches enter visible queues.

The first extraction adapters cover the supplied Amazon/RK World, Flipkart and Blinkit formats. The normalized model retains channel identifiers, quantities, tax fields, dates, destinations and appointment details found in the reference files.

### Workflow coordinator

Acceptance and appointment matching update separate versioned records. After either action, the database coordinator evaluates the PO:

```text
rejected
  -> close without reservation

accepted and appointment matched and no active reservation
  -> lock PO and stock rows
  -> calculate allocatable released stock
  -> create one reservation and ledger movement set
  -> record shortage if required

otherwise
  -> keep the remaining gate visible
```

Shipment planning unlocks only after both gates and the reservation attempt complete.

### Inventory and ledger

The stock ledger is the quantity source of truth. Stock moves through paired entries between locations and states. Derived balances may be cached but must rebuild exactly from the ledger.

Normal reservation uses only released stock and protects the effective SKU-node threshold. Shelf-life items use FEFO. Expired, short-dated, quarantined, held, rejected and other non-released stock is not allocatable. Corrections create reversals rather than edits.

### Web application

Retain the industrial command-centre design and rebuild the main workflow around actionable queues:

- Dashboard with filtered exception counts.
- PO inbox and document-review workspace.
- PO details with overview, lines and inventory, appointment, shipments, POD and discrepancies, invoice and audit tabs.
- SKU-first inventory with warehouse detail.
- Appointment queue and calendar.
- Shipment planner and event tracker.
- POD, delivery-exception and invoice queues.
- Administration, reports and audit screens.

Navigation and actions follow the authenticated role. QC remains view-only. Management actions require a reason where specified.

## Data Flow

```text
PO document -> extraction -> human review -> PO and lines -> warehouse mapping
                                                        -> acceptance gate

Appointment document -> extraction -> match -----------> appointment gate

Both gates -> atomic reservation -> shipment plan -> dispatch ledger entries
           -> shipment events -> POD reconciliation -> exception resolution
           -> full delivery or short close -> invoice -> closure
```

Every meaningful transition writes status history and audit data in the same transaction as the business change. Notifications are written to an outbox and delivered asynchronously so a failed email never repeats an inventory transaction.

## Permissions

- Team Member: daily PO, appointment, shipment, POD, invoice and controlled stock-addition work.
- Manager: Team Member actions plus warehouse override, threshold control, short close and restricted exception approval.
- Administrator and Super Admin: master data, users, mappings, routes, policies, settings and reports, subject to audit and segregation rules.
- QC or Auditor: read-only access to permitted operational records, documents and audit history.

The API and database both enforce permissions. Hidden UI controls are not a security boundary.

## Error Handling

- Duplicate document hashes and duplicate channel/PO numbers return the existing record or a clear conflict without creating another workflow.
- Missing mappings, unknown items, unreadable files and uncertain matches create named exceptions with an owner and age.
- Failed transactions roll back status, ledger, audit and idempotency changes together.
- Repeated completed idempotent requests return the stored result.
- Notification and integration failures keep attempt history, retry with backoff and move to a visible dead-letter state after the configured limit.
- Corrections use version replacement or reversal flows and never erase history.

## Testing

Required automated coverage includes:

- Amazon, Flipkart and Blinkit extraction normalization using the supplied files.
- Duplicate file and duplicate channel/PO handling.
- Exact, name, city/state and missing destination mapping cases.
- Acceptance-first and appointment-first gate order.
- Retry of every stock-changing operation.
- Competing reservations for the same last available stock.
- Threshold, quality-state, expiry and channel residual-life controls.
- Partial reservation and shortage.
- Multi-truck planning limits, partial dispatch and cancellation.
- Multi-shipment POD, duplicate POD, delivery discrepancy and reversal.
- Short close and invoice gate.
- Team Member, Manager, Admin, Super Admin and QC permission boundaries.
- Ledger balance, balance rebuild and audit completeness.
- Full PO-to-invoice end-to-end workflow.

Build, type-check and unit tests run for the API and web application. Database structural validation and workflow smoke tests run on a fresh PostgreSQL or Supabase environment before cutover.

## Cutover

1. Apply the v2 migrations in a fresh validation environment.
2. Load approved masters, opening ledger entries and document history.
3. Run validation and workflow smoke tests.
4. Compare PO, item, site, state, shipment, POD and invoice totals with the MVP model.
5. Deploy the v2 API adapter behind a configuration switch.
6. Run controlled user acceptance with real supplied documents.
7. Switch writes only after reconciliation and permission tests pass.
8. Keep the old schema read-only through the agreed rollback period.

## Later BOS Delivery

After channel cutover, continue in the specification order: transactional hardening, inbound and mobile scanning, quality, document ingestion and procure-to-pay, planning and MRP, wider outbound integrations, manufacturing, costing, control tower, second plant and hardening. Each phase uses the same ledger, workflow, document, notification and audit foundations.


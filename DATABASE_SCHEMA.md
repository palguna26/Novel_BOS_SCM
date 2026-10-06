# SCM Database Schema

## Purpose

This is the clean database design for the complete SCM and connected BOS platform. It is based on SCM_ENRICHED.md, SCM_DOC.docx, the reference files in SCM Detail, and the current API and web application.

The authoritative PO workflow is unchanged:

1. Receive and review the purchase order.
2. Acceptance happens independently.
3. Appointment booking and document matching happen independently.
4. Either event may happen first.
5. Inventory reservation happens once, only after both events are complete.
6. Shipment, dispatch, POD, discrepancy resolution, short close and invoice follow in order.

## Files

| File | Purpose |
|---|---|
| supabase/migrations/202610030001_scm_v2_foundation.sql | Schemas, identity, company, master data, documents, workflow, audit and integration foundation |
| supabase/migrations/202610030002_scm_v2_core.sql | Channel PO, dual gates, inventory ledger, reservations, shipments, POD, exceptions and invoices |
| supabase/migrations/202610030003_scm_v2_bos_extensions.sql | Planning, procurement, inbound, quality, manufacturing, costing and finance |
| supabase/migrations/202610030004_scm_v2_workflows.sql | Atomic workflow functions, idempotency, stock controls and activation controls |
| supabase/migrations/202610030005_scm_v2_security_compat.sql | Row security, permissions and legacy-shaped read views |
| supabase/tests/scm_v2_validation.sql | Structural and data-integrity validation checks |

## Schema ownership

| Schema | Responsibility |
|---|---|
| iam | Users, roles and company access |
| master_data | Companies, sites, locations, items, channels, vendors, customers and routes |
| documents | Files, immutable versions, extraction runs and reviewed fields |
| workflow | Approval requests and status history |
| scm | Channel POs, acceptance, appointments, shipments, POD, exceptions, short close and invoices |
| inventory | Batch stock ledger, policies, reservations, counts and adjustments |
| quality | Inspection plans, lots, results, dispositions, NCR, CAPA, complaints and recalls |
| planning | Demand, forecasts, MRP and redistribution |
| procurement | RFQ, vendor quotes, purchase orders, ASN, gate entry, GRN and invoice matching |
| manufacturing | BOM, routing, work centres, machines, production and maintenance |
| finance | Fiscal periods, valuation, landed cost and accounting exports |
| platform | Audit, idempotency, notifications, integrations, outbox and document numbering |
| compat | Read views using the current application's field names |

## Core relationships

The company is the main security boundary. A company owns sites, locations, items, channels and every operational record.

A channel purchase order has:

- One or more PO lines.
- Immutable source-document versions.
- Versioned acceptance decisions.
- Versioned appointments and appointment documents.
- One active reservation at a time.
- One or more shipments.
- One or more PODs linked to one or more shipments.
- Delivery exceptions and an optional approved short close.
- One external channel invoice.

Inventory is not stored as an editable balance. Stock transactions create paired ledger entries between physical or virtual locations and stock states. Balance views are rebuilt from the ledger.

## Dual-gate rule

The po_gate_state_v view calculates these facts independently:

- acceptance_complete
- appointment_complete
- ready_for_reservation

record_acceptance and record_appointment both call try_create_reservation. The reservation function locks the PO, checks both facts, checks for an existing active reservation, and uses one stable automatic idempotency key. This makes acceptance-first and appointment-first paths produce the same result without duplicate stock movements.

## Quantity rules

All operational quantities use numeric precision rather than integers.

| Quantity | Source |
|---|---|
| Physical | On-hand ledger balances at internal locations |
| Blocked | RESERVED ledger state |
| In transit | TRANSIT location or IN_TRANSIT state |
| Released | RELEASED stock at internal locations |
| Threshold | Effective inventory policy for item and site |
| Allocatable | Maximum of released minus threshold and zero |
| Shortage | Required reservation quantity minus reserved quantity |

Reservation uses released stock only. FEFO is applied where an expiry date exists. Expired stock and stock below the channel residual-life rule are excluded.

## Main transaction functions

| Function | Result |
|---|---|
| scm.create_purchase_order | Creates the PO and every line atomically |
| scm.record_acceptance | Stores a versioned decision and evaluates the reservation gate |
| scm.record_appointment | Stores a versioned appointment and evaluates the reservation gate |
| scm.try_create_reservation | Reserves released FEFO stock after both gates |
| scm.create_shipment | Creates shipment lines only within reserved quantities |
| scm.dispatch_shipment | Moves reserved stock to in-transit once |
| scm.record_pod | Moves confirmed quantities from in-transit to delivered |
| scm.short_close_purchase_order | Requires approval and releases remaining blocked stock |
| scm.upload_invoice | Allows one invoice after full delivery or short close |
| inventory.reverse_stock_transaction | Creates an opposite ledger transaction without editing history |

## Database protections

- Unique company, channel and external PO number.
- One active acceptance decision per PO.
- One active appointment per PO.
- One active reservation per PO.
- One approved short close per PO.
- One invoice per PO.
- Planned shipment quantity cannot exceed the reserved quantity.
- Dispatch cannot exceed tracked reservation allocations.
- POD quantities cannot exceed outstanding dispatched quantities.
- Ledger transactions must balance by item, batch and UOM.
- Internal stock cannot become negative.
- Ledger, audit, status history, document versions and inspection results are append-only.
- Repeated idempotency keys return the original completed result.
- Item activation requires Category or NPD, Costing, QA and Finance approvals plus an active inspection plan when required.

## Security

- Row-level security uses company access.
- QC is read-only.
- Approval actions require an approved Manager, Admin, Super Admin, QA or Finance role as appropriate.
- A signed-in caller cannot submit another user's actor ID.
- Direct writes by authenticated clients are not granted.
- Controlled database functions perform workflow writes.
- The service role retains backend access.
- Sensitive vendor bank data is not exposed through compatibility views.

## Compatibility and cutover

The current public tables are not changed or deleted. The new model is created in separate schemas, so applying these files does not switch the running API.

The compat schema provides the current read field names, including platform_id, warehouse_id, sku_id, ordered, allocated, delivered, physical, blocked and in_transit.

Compatibility views are not the final write API. During cutover, the NestJS service must change its write calls to the new transaction functions and its reads to either compat or dedicated query views. This change should be deployed only after migration and reconciliation checks pass.

## Required cutover checks

1. Apply the new migrations to a fresh validation database.
2. Load master data and opening ledger entries.
3. Import documents, POs, gates, reservations, shipments, PODs and invoices.
4. Compare totals by company, site, item, batch, state and PO.
5. Run supabase/tests/scm_v2_validation.sql.
6. Test acceptance-first and appointment-first paths.
7. Test repeated requests for every stock-changing action.
8. Test partial dispatch, multi-truck POD, discrepancy and short close.
9. Test blocked, expired and insufficient stock.
10. Run API and web builds.
11. Switch the API only when every comparison passes.
12. Keep the old public schema read-only during the agreed rollback period.

## Known cutover boundary

The schema is complete and additive, but the current NestJS service still points to the original public tables and original RPC names. This is intentional to prevent an unapproved live cutover. A separate API-adapter change is required before production traffic uses SCM v2.

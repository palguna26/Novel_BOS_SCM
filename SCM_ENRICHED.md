# SCM Channel Purchase Order Shipment and Warehouse Inventory Management System

## Enriched Product Functional and Technical Specification

**Version:** 1.1  
**Date:** 3 October 2026  
**Status:** Consolidated build specification  
**Primary workflow authority:** `SCM_DOC.docx`  
**Detailed supporting specification:** `Novel_SCM_QC_Platform_Spec_v2.0.pdf`  
**Implementation reference:** Current React, NestJS and Supabase codebase  
**Reference documents:** Marketplace POs, appointment documents, consignment documents, box label, dispatch tracker and appointment pass in `SCM Detail`

## Document purpose

This document consolidates the approved SCM operating workflow, detailed functional requirements, current application design, database rules and real marketplace document formats into one build reference.

The operating workflow from `SCM_DOC.docx` remains the controlling workflow. Supporting information enriches the fields, validations, controls, screens, data model, technical design and acceptance criteria. It does not replace or reorder the workflow.

## Authoritative workflow

```text
Marketplace PO received
        |
        v
Original PO document uploaded and retained
        |
        v
Document classified, extracted and reviewed by a person
        |
        v
Destination mapped to source warehouse
        |
        +-------------------------------+
        |                               |
        v                               v
PO acceptance decision          Appointment processing
        |                        Booking remains external
        |                        Appointment document uploaded
        |                        and matched to the PO
        |                               |
        +---------------+---------------+
                        |
              Both gates complete
                        |
                        v
Atomic stock check and reservation
        |
        +---- Rejected PO -> reason recorded -> workflow closed
        |
        +---- Shortage -> reserve allocatable quantity and show exception
        |
        v
Shipment planning across one or more trucks
        |
        v
Dispatch moves blocked stock to in-transit
        |
        v
Manual transport updates and event history
        |
        v
POD upload and SKU-level delivery reconciliation
        |
        v
Confirmed delivery removes stock from company ownership
        |
        +---- Open difference -> resolve or approve short close
        |
        v
Externally generated invoice uploaded
        |
        v
PO closed with permanent audit history
```

### Parallel acceptance and appointment rule

PO acceptance and appointment processing are independent activities that may happen in parallel.

- Acceptance records the commercial and operational decision to fulfil the PO.
- Appointment processing records the marketplace delivery slot and connects its document to the PO.
- A rejected PO closes without stock reservation.
- Acceptance authorises reservation, but the atomic inventory reservation runs only when the PO is accepted and the appointment document is matched.
- Shipment planning remains locked until both gates are complete and the stock reservation result is known.
- The system rechecks inventory inside the reservation transaction so two users cannot reserve the same last available units.

---

# 1 Executive Overview

The product is a workflow-first SCM platform for managing marketplace purchase orders from document receipt through delivery, invoice upload and closure. It replaces the operational Excel tracker, scattered email threads, document folders and manual WhatsApp follow-up with one connected PO record.

The primary workspace connects:

- PO source document and extracted data.
- Human review and corrections.
- Warehouse assignment.
- PO acceptance or rejection.
- Appointment booking status and uploaded appointment document.
- SKU-level stock availability and reservation.
- One or more truck shipments.
- Driver and logistics events.
- PODs and delivery differences.
- Short-close approval.
- Final invoice.
- Notifications and permanent audit history.

## Expected business outcomes

- The SCM team can complete the PO-to-invoice process without an Excel operations tracker.
- Every PO, appointment, shipment, POD and invoice is available from one PO workspace.
- Threshold stock is protected from normal allocation.
- The same stock cannot be reserved for two POs.
- Marketplace-specific documents can be extracted into one normalised model.
- Partial dispatches and multi-truck deliveries remain reconcilable at SKU level.
- Every restricted action identifies the user, time, reason and changed values.
- Pending work, delays and exceptions are visible in queues and dashboards.
- Inventory movements can be rebuilt and reconciled from an immutable movement history.

## Success measures

The channel workflow should contribute to the wider BOS targets:

| Measure | Target |
|---|---:|
| Channel OTIF and fill rate | At least 97% |
| A-class stock-out days | Less than 1% of SKU-days |
| Stock-ledger accuracy | At least 99% for A-class items |
| Dead and near-expiry stock | Less than 2% of inventory value |
| Batch trace time | Under 10 minutes |
| Duplicate inventory reservation | Zero |
| Operational actions with audit history | 100% |

---

# 2 Business Need and Scope

## Current challenges

- PO details are copied manually from different marketplace formats.
- Appointment deadlines and delivery slots can be missed.
- Warehouse selection depends on personal knowledge and spreadsheet references.
- Stock is calculated in separate files, creating double-allocation risk.
- Threshold stock can be consumed accidentally.
- One PO can be split across several trucks and PODs, making reconciliation difficult.
- Driver updates are not connected to the shipment record.
- Short, damaged and rejected delivery quantities remain unclear.
- Documents are stored separately and are difficult to trace to a PO.
- Management cannot see a reliable exception queue or ownership.

## Core workflow scope

- Amazon/RK World, Flipkart, Blinkit and configurable additional channels.
- PO and appointment document upload.
- Native PDF text extraction, OCR-ready ingestion and mandatory human review.
- Duplicate detection by platform and PO ID plus document hash.
- Destination-to-warehouse mapping.
- Parallel PO acceptance and appointment processing.
- SKU and warehouse inventory visibility.
- Threshold protection and atomic reservation.
- Shortage handling and controlled warehouse overrides.
- Multi-truck shipment planning.
- Manual logistics updates.
- POD upload and line-level delivery confirmation.
- Short-close approval.
- One externally generated invoice per PO.
- Role-based access, notifications, reports and append-only audit history.

## Connected BOS capabilities

The channel SCM workflow is part of the larger native BOS architecture. These connected capabilities do not alter the PO workflow, but they supply or consume trusted records around it:

- Item, vendor, warehouse, channel, UOM, tax and packaging masters.
- Append-only stock and valuation ledgers.
- Batch, shelf-life and quality-state controls.
- Inbound GRN, quarantine, QC release and putaway.
- Demand planning, inventory policy and MRP suggestions.
- Procurement and vendor management.
- Pick, pack, PDI, ASN and statutory dispatch documents.
- Returns, ageing, expiry and redistribution.
- Costing, control-tower dashboards and integrations.

## Explicit system boundaries

- Marketplace appointment booking remains outside the SCM application. The resulting appointment document is uploaded and matched.
- Operational invoices are generated outside this channel workflow and then uploaded. The wider BOS transactional core may later generate GST documents through its dedicated document engine.
- WhatsApp driver updates are entered manually until an approved integration is introduced.
- No warehouse is changed silently because of shortage.
- No quantity is changed through a direct balance edit.
- No business, inventory or audit record is hard-deleted.

---

# 3 Complete Operating Workflow

## Step 1 Receive and upload PO

1. The user selects the platform and uploads one PO PDF.
2. The original file is stored immutably with filename, storage path, SHA-256 hash, upload user and server timestamp.
3. A repeated hash is identified before another business record is created.
4. The upload does not create a final PO until extracted fields are reviewed and saved.

## Step 2 Extract normalise and review

The document pipeline is:

```text
Upload
-> immutable file storage
-> document classification
-> native PDF parse or OCR
-> field extraction
-> normalisation to masters
-> validation
-> duplicate check
-> review queue
-> human correction
-> final PO save
```

The reviewer sees the source document beside editable header and line fields. The original extraction, confidence, corrections and final values are retained.

## Step 3 Assign source warehouse

The system matches the platform and destination against active mappings. The warehouse result is visible before acceptance. A missing mapping creates a visible exception.

## Step 4 Run acceptance and appointment tracks

### Acceptance track

- Reviewer verifies the PO header, SKU lines, commercial values, destination and warehouse.
- User accepts or rejects the PO.
- Rejection requires a reason and closes the workflow without reservation.
- Acceptance records the user and server timestamp and marks the PO ready for fulfilment.

### Appointment track

- Appointment is booked on the external marketplace.
- The appointment PDF or image is uploaded.
- The system extracts appointment ID, PO ID, FC, time, destination and other available fields.
- The system matches the appointment to one PO.
- Ambiguous or failed matches go to a manual matching queue.
- Replacement documents preserve previous versions and require a reason.

## Step 5 Check and reserve inventory

When acceptance and appointment matching are both complete, the system performs an atomic stock check. It reserves only allocatable stock and records any shortage.

## Step 6 Plan shipments

The user creates one or more shipment records, adds vehicle and driver data, and assigns SKU quantities. Combined active shipment quantities cannot exceed the blocked PO quantity.

## Step 7 Dispatch and track

Dispatch moves the relevant quantity from blocked to in-transit. Driver and logistics updates are appended to the shipment timeline.

## Step 8 Confirm delivery

The user uploads the POD, confirms received quantities per SKU, and records short, damaged or rejected quantities. Only confirmed delivered quantity leaves company-owned in-transit stock.

## Step 9 Resolve differences

Open delivery quantities stay visible. They may be delivered later, returned, corrected through reversal entries, or covered by an approved short close.

## Step 10 Upload invoice and close

Invoice upload is enabled only after full delivery or an approved short close. Closure requires all shipments and delivery differences to be resolved and one invoice to be present.

## Key control points

- A person reviews extracted values before acceptance.
- Acceptance and appointment are independent gates.
- Inventory is rechecked when reservation is created.
- Shipment planning requires acceptance, appointment and reservation results.
- Planned shipment quantity cannot exceed blocked quantity.
- Dispatch cannot use unreleased, short-dated or otherwise blocked stock when batch controls are enabled.
- POD confirmation is idempotent.
- Invoice upload requires full delivery or approved short close.

---

# 4 Purchase Order Appointment and Warehouse Assignment

## PO processing fields

### Header

- Platform and platform code.
- External PO or RO number.
- PO type and transaction type.
- PO date, expiry date and delivery window.
- Appointment deadline.
- Customer or purchasing entity.
- Supplier and vendor identifiers.
- Ship-from, bill-from, ship-to and bill-to addresses.
- Destination FC name, FC code, city, state and postal code.
- GSTIN, PAN and state codes where present.
- Currency, payment method, payment terms and freight terms.
- Total quantity, total taxable value, tax and total PO value.
- Marketplace status and special instructions.

### Line

- Platform product ID, internal SKU and channel SKU.
- ASIN, FSN, EAN, GTIN or UPC.
- Product title and pack description.
- HSN or SAC.
- Quantity requested, approved, pending, accepted and outstanding.
- UOM and pack conversion.
- Unit price, taxable value, tax rates, tax values and line total.
- MRP.
- Required-by date and delivery window.
- Shelf life, manufacturing date and expiry requirements when supplied.

## Marketplace reference formats

### Amazon and RK World

The reference set demonstrates:

- PO `4S2BJXYY`, vendor code, BLR4 ship-to location, ordered date, ship window, freight terms, payment terms and purchasing entity.
- Submitted and accepted line counts, quantities and cost.
- ASIN, external ID, model, HSN, title, expected date, accepted quantity, received quantity, outstanding quantity, unit cost and total cost.
- Box label carrying purchasing entity, address, FC code and PO number.
- Appointment `998424004985` carrying confirmed status, appointment time, creation time, carrier code, PRO, carton count, unit count, PO, destination FC and ASN.

### Flipkart

The reference set demonstrates:

- PO IDs `FLS02CDDC93B`, `FLSN024S7XY5` and `FLSSO8YIFZOI`.
- Nature of supply, transaction type, order and expiry dates, category, contract and credit terms.
- Supplier and retailer addresses, GSTINs and state codes.
- Product ID, EAN, title, quantity, approved and pending quantities, unit price, CGST, SGST, IGST, tax and totals.
- Consignment IDs, delivery date, destination, quantity, product count and consignment value.
- Partial consignment support where a PO contains more quantity or more lines than one consignment.

### Blinkit

The reference set demonstrates:

- Recommended Order `49990010116382`.
- Seller and delivery details, RO date and expiry, seller number, GSTIN, destination address and contact fields.
- Item code, HSN, UPC, description, grammage, tax, landing rate, quantity, MRP and total.
- Appointment pass containing appointment ID, reporting date and time, facility, unloading slot, QR code and purchase manager details.

## Document rules

- Store the original file and a content hash.
- Retain all replacement versions.
- Never overwrite a source document.
- Keep the raw extraction separate from the user-corrected version.
- Required fields must be complete before the record leaves review.
- Duplicate platform and PO-ID combinations are rejected.
- Duplicate document hashes do not create new records.
- Unknown SKUs, product identifiers and destinations enter an exception queue.
- Sensitive contact, tax and address data is visible only to authorised roles.

## Appointment processing

The appointment record contains:

- PO reference.
- Appointment ID.
- Booking date.
- Appointment date and time.
- Reporting time and unloading slot.
- FC code and location.
- Carrier, PRO, carton and unit counts where present.
- ASN reference and status.
- Original document, hash and versions.
- Match confidence and manual match reason.
- Upload and replacement user and timestamp.

Appointment statuses are `PENDING_BOOKING`, `BOOKED`, `RESCHEDULED`, `MISSED`, `COMPLETED` and `CANCELLED`.

## Warehouse assignment

Mapping priority:

1. Exact platform and FC code.
2. Exact platform and destination name.
3. Platform, city and state.
4. No match, producing `WAREHOUSE_MAPPING_REQUIRED`.

Each mapping stores platform, destination, FC code, city, state, assigned warehouse, optional backup, effective dates and active state.

Only Manager, Director Admin or Super Admin may override the result. The reason, old warehouse, new warehouse, user and timestamp are audited. Stock at other warehouses may be shown for information, but the system never switches automatically.

---

# 5 Warehouse Inventory and Stock Protection

## Inventory quantities

| Quantity | Meaning |
|---|---|
| Physical | Stock recorded at the warehouse before dispatch |
| Threshold | Protected operating minimum unavailable to normal PO allocation |
| Blocked | Stock reserved for accepted and appointed POs but not dispatched |
| Available | Physical minus blocked |
| Allocatable | Physical minus blocked minus threshold, floored at zero |
| In transit | Dispatched stock still owned by Novel |
| Delivered | POD-confirmed stock removed from company ownership |
| Shortage | PO requirement not covered by allocation |

```text
Available = Physical - Blocked

Allocatable = max(0, Physical - Blocked - Threshold)

Shortage = Required - Reserved
```

## Reservation transaction

1. Lock the PO and affected SKU-warehouse balances.
2. Confirm acceptance and appointment gates.
3. Recalculate allocatable quantity using current balances and threshold.
4. Reserve the lower of required and allocatable quantity.
5. Increase blocked quantity.
6. Add an immutable `RESERVE` movement.
7. Update line allocation and PO shortage.
8. Commit all lines atomically or fail safely.

## Movement lifecycle

```text
Stock addition:    source -> physical warehouse stock
Reservation:       allocatable -> blocked
Reservation release: blocked -> allocatable
Dispatch:          blocked -> in transit
POD confirmation:  in transit -> customer/delivered
Correction:        reversing movement -> corrected movement
```

## Wider BOS ledger rule

The final BOS stock ledger is the quantity truth. Each movement is a paired debit and credit between physical or virtual locations. Materialised balance tables may improve performance but must be rebuildable and reconciled against the ledger. Corrections use reversal documents, not edits or deletes.

Relevant stock dimensions include item, batch, location, bin, quality state, UOM, posting time, document and value. Quarantine, under-test, rejected, held, return-to-vendor, scrap and retention stock are not allocatable.

## Threshold and policy controls

- Threshold is configured per SKU and node.
- Threshold changes require an authorised role and audit event.
- An increase never cancels an existing reservation silently.
- Negative allocatable results display as zero and create an exception.
- No user edits a calculated balance directly.
- Cycle counting frequency is driven by ABC class.
- FEFO applies to shelf-life stock; FIFO applies otherwise.
- Batch override requires approval and a reason.

## Advanced inventory policy

The connected policy engine may calculate:

```text
Safety stock = Z * sqrt(LT * sigma_d^2 + mean_d^2 * sigma_LT^2)

Reorder point = mean_d * LT + Safety stock

EOQ = sqrt(2 * Annual demand * Ordering cost / Annual holding cost per unit)

Maximum allowed by shelf life = mean_d * Shelf life days * 0.6

Days of cover = Closing stock / Trailing 28-day average daily run rate
```

Policies are held per SKU and node, not only per SKU. Service level, ABC, XYZ, FSN, measured lead time, MOQ, order multiple, shelf life and channel requirements drive the result.

## Shortage handling

The system shows required, physical, blocked, threshold, allocatable, reserved and shortage quantities. Permitted actions are:

- Wait for stock addition.
- Reserve remaining quantity after new stock arrives.
- Request an approved warehouse override.
- Split fulfilment across warehouses after approval.
- Reject the PO.
- Approve a short close when fulfilment is no longer expected.

## Stock protection from quality controls

Where batch and QC modules are enabled, dispatch is blocked unless:

- The batch is `RELEASED`.
- Residual shelf life meets the channel minimum.
- The pre-dispatch inspection checklist is complete.
- Channel barcode, case label, shipper marking and MRP checks pass.
- ASN and physical quantities agree.

---

# 6 Shipment Delivery POD and Invoice

## Shipment planning

Shipment planning requires:

- Accepted PO.
- Matched appointment document.
- Completed inventory reservation attempt.
- Assigned source warehouse.
- No blocking master-data or quality exception.

Each shipment stores:

- System shipment number.
- PO and appointment references.
- Source warehouse and destination.
- Truck number, type and capacity.
- Transporter, driver name and phone.
- Planned and actual dispatch.
- Expected and actual arrival.
- Estimated and actual cost.
- LR or transport document.
- SKU lines with planned, dispatched and delivered quantities.
- Status, events and remarks.

Rules:

- One PO may use many shipments.
- One SKU may be split across shipments.
- Active planned quantity cannot exceed blocked quantity.
- Dispatch cannot exceed planned quantity.
- Cancelling an undispatched shipment releases its shipment allocation.
- Correcting dispatched quantities requires reversal and reposting.
- Route estimates are copied to the shipment so later master changes do not alter history.

Shipment statuses:

`PLANNED`, `VEHICLE_ASSIGNED`, `LOADING`, `DISPATCHED`, `IN_TRANSIT`, `ARRIVED`, `UNLOADING`, `PARTIALLY_DELIVERED`, `DELIVERED`, `DELIVERY_ISSUE`, `RETURNED`, `CANCELLED`.

## Shipment events

Each update stores shipment, status, event time, location, notes, optional attachment, entry user and server timestamp. Events display chronologically. A correction retains the earlier value in audit history.

## Proof of delivery

A PO supports one or more PODs, normally one per truck. A POD can cover several shipments when the source document does so.

POD fields:

- PO and shipment references.
- File, path and SHA-256 hash.
- Delivery date and time.
- Receiver.
- Dispatched and confirmed quantities per PO line.
- Short, damaged and rejected quantities.
- Difference reason and notes.
- Upload and confirmation user.

POD rules:

- A repeated hash returns the existing result and does not deduct inventory again.
- Only confirmed quantity is removed from in-transit stock.
- Short, damaged and rejected quantities remain open until resolved.
- Combined POD confirmations cannot exceed dispatched quantity.
- A corrected POD uses a controlled replacement and reversal process.
- Fully Delivered requires all required quantities or an approved short close.

## Short close

- Manager, Director Admin or Super Admin approval is required.
- A reason and remaining quantity are mandatory.
- Remaining blocked stock is released through an immutable movement.
- Approval is audited.
- Invoice upload becomes available after approval.

## Invoice and closure

The channel workflow stores one externally generated invoice per PO.

Invoice fields:

- Invoice number and date.
- Amount and currency.
- File and storage path.
- Upload user and time.
- Recipients.
- Send status, sent time, error and retry history.

Invoice upload is blocked until `FULLY_DELIVERED` or `SHORT_CLOSED`. A PO closes only when shipments are resolved, no delivery discrepancy is open and the invoice exists.

The wider BOS ingestion layer may also validate vendor/customer GSTIN, HSN, tax arithmetic and duplicates; match invoices against PO, GRN or dispatch; and route failures into an exception queue. Invoice data enriches and reconciles physical events but never substitutes for scanned receipt, QC, batch or dispatch transactions.

---

# 7 How Information Moves Through the System

## PO-centred record

The PO Details workspace is the primary operational view. It connects:

- Source PO document and extraction result.
- Corrected PO header and lines.
- Platform and destination.
- Warehouse assignment and override history.
- Acceptance or rejection decision.
- Appointment and document versions.
- Inventory availability, reservation and shortage.
- Shipments, lines and events.
- PODs, confirmed delivery and open differences.
- Invoice and notification status.
- Audit activity.

## Data flow

```text
PO document
  -> extraction result
  -> reviewed PO and lines
  -> warehouse mapping
  -> acceptance gate

Appointment document
  -> appointment extraction
  -> PO match
  -> appointment gate

Both gates
  -> atomic reservation
  -> shipment lines
  -> dispatch movements
  -> POD lines
  -> delivery movements
  -> invoice gate
  -> closure
```

## Current codebase architecture

| Layer | Current design |
|---|---|
| Web | React, Vite and Tailwind operational workspace |
| API | NestJS controllers and services |
| Database and auth | Supabase PostgreSQL and Supabase Auth |
| Documents | Local storage abstraction with SHA-256 hashing and PDF text extraction |
| Email | Nodemailer with file capture in development and SMTP option |
| Inventory operations | PostgreSQL functions for atomic stock addition, reservation, dispatch, POD and short close |
| Audit | Append-only `audit_events` records |

## Main API operations

| Method and path | Purpose |
|---|---|
| `GET /api/dashboard` | Status counts, recent POs and inventory |
| `GET /api/pos` | Complete PO workspace data |
| `GET /api/inventory` | SKU and warehouse inventory positions |
| `GET /api/masters` | Platforms, warehouses, SKUs, mappings and routes |
| `GET /api/audit` | Recent audit events |
| `POST /api/documents/extract` | Store and extract an uploaded document |
| `POST /api/pos` | Save reviewed PO and lines |
| `POST /api/pos/:id/accept` | Record PO acceptance and trigger the two-gate coordinator |
| `POST /api/pos/:id/reject` | Reject with a reason |
| `POST /api/pos/:id/appointment` | Save or replace appointment and trigger the two-gate coordinator |
| `POST /api/pos/:id/shipments` | Create a shipment and lines |
| `POST /api/shipments/:id/dispatch` | Dispatch and move stock to in-transit |
| `POST /api/pos/:id/pods` | Confirm POD quantities idempotently |
| `POST /api/pos/:id/short-close` | Approve short close and release stock |
| `POST /api/pos/:id/invoice` | Upload the gated invoice |

## Two-gate implementation requirement

The acceptance endpoint and appointment endpoint both update their own state. A shared server-side coordinator evaluates the PO after either event:

```text
if rejected:
    close without reservation
else if accepted and appointment_matched and reservation_not_created:
    run atomic inventory reservation once
else:
    keep the remaining gate visible
```

Reservation idempotency must be enforced in the database. Retrying either endpoint must not create another reservation or movement.

---

# 8 Operational Screens Queues and Reports

## Dashboard

Shows work that needs action:

- PO extraction and review.
- Acceptance pending.
- Appointment booking or document matching pending.
- Both gates complete but reservation failed.
- Warehouse mapping missing.
- Inventory shortage or threshold concern.
- Shipment planning pending.
- Dispatch due or late.
- POD missing.
- Delivery differences.
- Invoice pending.
- Notification or integration failure.

Every count opens the relevant filtered queue.

## PO Inbox

- Upload PDF and select platform.
- Review extraction result and warnings.
- Correct header and lines.
- View warehouse mapping.
- Accept or reject.
- View appointment gate independently.
- Search and filter by platform, state, date, destination and deadline.

## PO Details

The implemented page structure contains:

- Overview.
- Lines and Inventory.
- Appointment.
- Shipments.
- POD and Discrepancies.
- Invoice.
- Audit Activity.

The page header shows platform, PO ID, status, customer, destination, warehouse, value, fulfilment progress, appointment and deadline.

## Inventory

The current UI is SKU-first. Users view total physical, blocked and allocatable stock, then expand the SKU to see warehouse-level physical, blocked, threshold, allocatable and in-transit quantities.

## Appointment Queue and Calendar

- POs awaiting booking.
- Uploaded appointments awaiting match.
- Appointment date and slot.
- Booking deadline.
- Rescheduled, missed, completed and cancelled appointments.
- Replacement history.

## Shipment Planner and Tracker

- Add trucks and SKU lines.
- Compare shipment quantities with blocked quantity.
- Record vehicle, driver, route, timing and cost.
- View chronological events.
- Monitor POD status and open in-transit quantity.

## POD and Invoice Queues

- Dispatched shipments without POD.
- PODs awaiting quantity confirmation.
- Short, damaged or rejected differences.
- Fully delivered or short-closed POs awaiting invoice.
- Failed invoice email and retry state.

## Administration and Audit

- Users and roles.
- Platforms, warehouses and SKUs.
- Destination mappings and route estimates.
- SKU-warehouse thresholds.
- Notification settings.
- Searchable append-only audit history.

## Reports

- PO register by platform and status.
- Acceptance and rejection reasons.
- Appointment performance and missed slots.
- Warehouse assignments and overrides.
- Inventory and threshold positions.
- Blocked stock by PO.
- Shortage and replenishment queues.
- In-transit stock by shipment.
- Fulfilment and remaining quantities.
- Shipment time and cost variance.
- POD ageing and delivery differences.
- Invoice pending and notification failures.
- User actions and audit history.
- Channel fill rate and root cause.
- Penalty and chargeback exposure.
- Transporter performance.

Exports support CSV or Excel, with drill-down to the source record and document.

---

# 9 Permissions Audit Security and Reliability

## Roles

### Team Member or Associate Processor

Runs daily PO, appointment, shipment, POD, invoice and controlled stock-addition work.

### Manager

Has operational permissions plus warehouse override, short close, threshold control and restricted exception approval.

### Director Admin or Administrator

Manages master data, users, mappings, routes, policies, reports and system settings. Historical movements and audit events remain immutable.

### Super Admin

Has full administration control, subject to audit and segregation rules.

### QC User or Auditor

Read-only access to permitted operational records, documents and audit history.

## Current application role mapping

The current database uses `TEAM_MEMBER`, `MANAGER`, `ADMIN` and `QC`. The service layer prevents QC writes and limits management actions to Manager or Admin. The enriched model can extend this mapping without changing the workflow.

## Segregation of duties

- PO creator and restricted PO approver should be separate where an approval threshold applies.
- QC inspector cannot release the same batch.
- Stock counter cannot approve the related adjustment.
- Vendor bank-detail changes require dual approval and callback verification.
- QA alone controls release from non-released quality states.

## Audit event

Each event records:

- User and role.
- Server timestamp.
- Action.
- Record type and ID.
- Old and new values.
- Reason where required.
- Related PO, shipment, SKU, warehouse or document.
- Source screen, API or automated process.

Required audit events include upload, correction, acceptance, rejection, mapping, override, appointment match or replacement, reservation, release, dispatch, shipment correction, POD confirmation or replacement, discrepancy resolution, short close, invoice upload or resend, threshold change, user/role change and master-data change.

## Security

- Authentication is required for all users.
- Server-side permission checks apply to every restricted action.
- MFA is required for admin and approver roles in production.
- Data is encrypted in transit and at rest.
- Documents use authorised access rather than public paths.
- Sensitive PII, tax IDs, addresses and phone numbers are protected.
- Client timestamps never control audit or inventory events.

## Reliability

- Reservation, dispatch, POD and notification retries are idempotent.
- Failed background work enters a visible retry or dead-letter queue.
- Integrations use exponential backoff and manual reprocessing.
- Daily backup and point-in-time recovery are required.
- Restore tests are performed before go-live and quarterly afterward.
- Target RTO is four hours and RPO is one hour for the full BOS platform.

## Performance

- Normal pages load within two seconds at p95.
- Scan transactions target under 500 ms where scanner modules apply.
- Reservation completes atomically within two seconds.
- Search covers at least five years without material degradation.
- The wider system is designed for 200 concurrent users and 99.5% business-hours uptime.

---

# 10 Delivery Plan Testing and Go Live

## Delivery sequence

### Foundation

- Authentication and roles.
- Platforms, warehouses, SKUs and channel identifiers.
- Threshold policies, destination mappings and route estimates.
- Immutable inventory movement and audit framework.

### PO and appointment workflow

- PO extraction and human review.
- Duplicate checks.
- Warehouse mapping.
- Independent acceptance and appointment gates.
- Atomic reservation after both gates.
- Shortage and notification handling.

### Shipment and delivery

- Multi-truck planning.
- Dispatch and in-transit stock.
- Shipment events.
- POD and delivery differences.
- Short close.

### Invoice dashboard and reporting

- Invoice gate.
- Work queues and reports.
- QC read-only access.
- Backup and recovery tests.

### Connected BOS phases

The wider platform continues with transactional ledger hardening, inbound and mobile scanning, quality, ingestion and procure-to-pay, planning and MRP, channel integrations, manufacturing, costing and control tower. These modules connect to the same masters, document engine, stock ledger, workflow engine and audit framework.

## Testing

| Layer | Required coverage |
|---|---|
| Unit | Extraction normalisation, mapping, formulas, status rules and permissions |
| Integration | Two-gate coordination, reservation, dispatch, POD, short close and invoice gate |
| Concurrency | Two reservations competing for the same stock |
| Document | Real Amazon, Flipkart and Blinkit formats, duplicates and unreadable files |
| Permission | Team Member, Manager, Admin, Super Admin and QC boundaries |
| End to end | PO upload through parallel gates, multi-truck delivery, POD, invoice and closure |
| Recovery | Extraction retry, email retry, repeated API request and backup restore |
| Ledger | Balance rebuild and movement reconciliation |

## Go-live readiness

- Warehouse and destination mappings are approved.
- Active items and channel identifiers are loaded.
- Thresholds and opening stock are reconciled.
- Role and permission tests pass.
- Real source files from each supported platform pass extraction UAT.
- Acceptance and appointment work correctly in either order.
- Concurrent reservation tests pass.
- Multi-truck and partial-delivery scenarios pass.
- POD duplication and correction tests pass.
- Restricted actions appear in audit history.
- Backup restore succeeds in a clean environment.

---

# 11 Product Acceptance and Client Review

The product is accepted when:

1. Supported PO files can be uploaded, extracted, reviewed and saved without duplicates.
2. Destination mapping selects the correct warehouse or creates a visible exception.
3. Acceptance and appointment processing work independently in either order.
4. Rejection closes the PO without reservation.
5. Reservation occurs once only after acceptance and appointment matching are complete.
6. Protected threshold stock cannot be reserved.
7. Concurrent requests cannot reserve the same stock twice.
8. Partial reservation records the correct shortage.
9. Shipment planning stays locked until both gates and reservation are complete.
10. One PO can be split across multiple trucks without exceeding blocked quantity.
11. Dispatch moves only dispatched quantity from blocked to in-transit.
12. POD confirmation removes only confirmed delivered quantity.
13. Short, damaged and rejected quantities remain visible until resolved.
14. Duplicate POD upload does not repeat an inventory movement.
15. Invoice upload remains blocked until full delivery or approved short close.
16. QC users can view but cannot change records.
17. Required actions create permanent audit events.
18. Inventory balances can be rebuilt from movements.
19. The team can operate without the Excel dispatch tracker.
20. Every PO workspace links the complete document and quantity history.

## Wider BOS acceptance controls

As connected modules are activated:

- Ledger entries balance across locations.
- Derived balances match the ledger after rebuild.
- Unreleased or short-dated batches cannot dispatch.
- Batch traceability works backward and forward in under 10 minutes.
- Inspection sample size comes from the approved AQL plan.
- Expired calibration blocks result entry.
- Closed periods reject back-dated postings.
- Invoice matching queues all tolerance failures.
- A complete disaster-recovery restore succeeds.

---

# 12 Client Inputs Required

## Operational inputs

- Sample PO, appointment, consignment, POD and invoice documents for every platform.
- Current Excel dispatch and inventory trackers.
- Destination-to-source-warehouse rules.
- Warehouse, FC, city and route master.
- Active SKU master with channel IDs, EAN/GTIN/UPC, HSN, pack and UOM.
- Threshold stock by SKU and warehouse.
- Appointment deadlines and platform-specific rules.
- Email recipients, templates and escalation owners.
- User list, roles and approval responsibilities.

## Master-data and BOS inputs

- Item, BOM, routing and vendor extracts.
- Warehouse zones, racks and bins.
- Batch, shelf-life and channel residual-life rules.
- QA inspection parameters, limits and sampling plans.
- GST, statutory-document and Tally export requirements.
- Approval thresholds and escalation SLAs.
- Inventory holding cost, lead-time and planning parameters.
- Baseline values for agreed success metrics.

## Optional integration inputs

- Amazon SP-API, Flipkart, Meesho, quick-commerce and Shopify credentials.
- GSP credentials for e-invoice and e-way bill.
- SMTP and WhatsApp Business configuration.
- Tally import/export specification.
- Transporter and external-lab interfaces.

---

# Appendix A Status Model

## PO statuses

```text
UPLOADED
EXTRACTION_REVIEW_REQUIRED
WAREHOUSE_MAPPING_REQUIRED
UNDER_REVIEW
ACCEPTANCE_PENDING
APPOINTMENT_PENDING
ACCEPTED_AWAITING_APPOINTMENT
APPOINTMENT_MATCHED_AWAITING_ACCEPTANCE
READY_FOR_RESERVATION
INVENTORY_SHORTAGE
INVENTORY_BLOCKED
SHIPMENT_PLANNING
PARTIALLY_DISPATCHED
FULLY_DISPATCHED
PARTIALLY_DELIVERED
DELIVERY_ISSUE
FULLY_DELIVERED
SHORT_CLOSED
INVOICE_UPLOADED
CLOSED
REJECTED
CANCELLED
ON_HOLD
```

The status is supported by independent facts such as `accepted_at`, appointment match state, reservation state and reconciled quantities. One status string must not hide line-level truth.

# Appendix B Core Data Model

## Current implemented entities

`users`, `platforms`, `warehouses`, `skus`, `warehouse_sku_policies`, `inventory_balances`, `destination_mappings`, `route_estimates`, `purchase_orders`, `purchase_order_lines`, `po_documents`, `stock_reservations`, `appointments`, `shipments`, `shipment_lines`, `shipment_events`, `pods`, `pod_lines`, `invoices`, `notifications`, `inventory_movements`, `audit_events`.

## Required extensions for full workflow fidelity

- Appointment document versions and match history.
- Reservation line and reservation idempotency key.
- Delivery exception and discrepancy disposition.
- POD-to-shipment link.
- Document extraction field confidence.
- Notification attempts and retry history.
- Warehouse override request and approval.
- Status transition history.
- File attachment access policy.

## Wider BOS entities

The broader platform adds master, document, stock ledger, valuation, batch, quality, planning, procurement, manufacturing, statutory, costing, return and integration entities described in the v2 architecture. All use the shared workflow, attachment, audit and notification services.

# Appendix C Database Constraints

- Unique platform plus external PO ID.
- Unique source document hash within its business context.
- One active appointment per PO, with retained versions.
- One invoice per PO.
- One active reservation per PO unless explicitly versioned.
- Shipment line SKU must exist on the PO.
- Active shipment quantity cannot exceed blocked quantity.
- POD confirmation cannot exceed outstanding dispatched quantity.
- Inventory and audit movements are immutable.
- Reservation, dispatch and POD functions run atomically.
- A repeated idempotency key returns the original result.

# Appendix D Reference File Map

| Reference | Information contributed |
|---|---|
| `SCM_DOC.docx` | Main workflow, responsibilities, controls, screens and acceptance rules |
| `Novel_SCM_QC_Platform_Spec_v2.0.pdf` | BOS architecture, masters, ledger, QC, planning, procurement, non-functional and phased requirements |
| `4S2BJXYY - PO.pdf` | Amazon/RK PO header, line and commercial fields |
| `4S2BJXYY - Box Label.pdf` | FC and PO box-label fields |
| `998424004985.pdf` | Amazon appointment fields |
| `49990010116382.pdf` and `.xlsx` | Blinkit RO header, item, tax and quantity fields |
| `2026-10-03_10-04-20.jpeg` | Blinkit appointment pass fields and QR presentation |
| Flipkart purchase-order workbooks | PO, supplier, retailer, tax, product, quantity and contract fields |
| Flipkart consignment PDFs | Consignment, destination, delivery date, quantity and value fields |
| `Copy of DISPATCH PO's.xlsx` | Current operational columns, warehouse references, lead times and shipment-status practices |

# Appendix E Reference Test Scenarios

1. Amazon PO with many product lines and partial appointment quantity.
2. Amazon box-label association by PO and FC.
3. Flipkart PO with partial consignment from a larger approved quantity.
4. Flipkart PO with a complete single consignment.
5. Consignment document with missing quantity detail routed to document review.
6. Blinkit RO with three item lines and a separate appointment pass.
7. Duplicate workbook or PDF detected by hash.
8. Appointment ID or quantity differing from a manually entered tracker value.
9. One channel identifier mapped incorrectly to more than one internal product.
10. Acceptance completed before appointment and appointment completed before acceptance; both converge on one reservation.

# Appendix F Current UI and Design Direction

The current product uses an industrial command-centre style with restrained colour, high information density and status-based emphasis. The layout provides a fixed navigation rail and operational modules for Overview, PO Inbox, Inventory, Shipments, Appointments, Invoices, Administration and Audit Log.

PO Details uses progressive disclosure through tabs. Inventory uses SKU-first totals with warehouse expansion. Identifiers and quantities should use tabular or monospaced presentation where it improves scanning. Semantic colour is reserved for available, accepted, warning, blocked, in-transit and error states.

# Appendix G Final Product Decisions

1. `SCM_DOC.docx` controls the workflow.
2. Supporting sources add detail without reordering the workflow.
3. PO acceptance and appointment processing are parallel gates.
4. Reservation runs only after both gates are complete.
5. Appointment booking remains external.
6. Warehouse selection comes from platform and destination mapping.
7. Warehouse changes require approval and a reason.
8. Threshold stock cannot be normally allocated.
9. Dispatch moves stock from blocked to in-transit.
10. POD confirmation removes only delivered stock from company ownership.
11. One PO may use multiple trucks and PODs.
12. One PO has one final externally generated invoice in this workflow.
13. QC is view-only in the channel operations workspace unless assigned a separate QC module role.
14. Every important action is append-only and auditable.
15. The stock ledger, workflow engine, document service, audit service and notification service are shared BOS foundations.

# Appendix H Connected BOS and QC Module Requirements

These modules surround the channel PO workflow. They share its masters, ledger, documents, approvals and audit services, but they do not change the sequence defined in the authoritative workflow.

## H1 Master data

### Item master

- Structured item code, legacy codes, EAN/GTIN and channel identifiers.
- FG, SFG, RM, PM, consumable, spare and kit classes.
- Brand, category, variant, pack configuration and exact UOM conversions.
- Dimensions, weight, volumetric weight and pallet pattern.
- HSN, GST and effective-dated MRP history.
- Shelf life and minimum residual life by channel.
- QC inspection-plan linkage, COA and retention-sample requirements.
- Make or buy, approved vendors, lead time, MOQ and order multiple.
- ABC, XYZ and FSN planning classes.
- Controlled status and lifecycle dates.

Item activation requires Category or NPD, Costing, QA and Finance approval. An item cannot become active without an inspection plan.

### BOM and routing

- Effective-dated, versioned multi-level BOMs.
- Component, quantity, UOM, wastage, phantom and approved substitution rules.
- Operations, work centres, machines, cycle time, setup time and labour standard.
- Engineering change control with QA sign-off and old-stock disposition.
- Standard-cost and latest-purchase-cost roll-up.

### Vendor master

- Legal identity, GSTIN, PAN, MSME status, addresses and bank data.
- Dual approval and callback verification for bank changes.
- Vendor-item prices, lead time, MOQ, rate contract and capacity.
- Payment terms, certificates, audit results and approval status.
- Certificate-expiry block and alerting.

### Warehouse and channel masters

- Company, site, zone, rack and barcode-labelled bin hierarchy.
- Separate quarantine, rejected, return, near-expiry, MRB and retention zones.
- Virtual locations for marketplaces, transit and job work.
- Channel-specific appointment, labelling, packaging, shelf-life, penalty, return and SLA rules.

Every master has an owner. Changes use approval and audit history. Bulk uploads return validation errors and never silently import partial invalid data.

## H2 Transactional document and ledger core

- Server-generated, gapless document numbering by type, company and financial year.
- Draft, Submitted, Cancelled and Amended states.
- Submission posts ledger entries.
- Cancellation creates reversal entries.
- Amendments create new versions and retain prior versions.
- Monthly period close blocks back-dated posting.
- Reopening requires approval and audit history.
- Quantity and valuation ledgers remain parallel and reconcilable.
- Moving weighted-average valuation is maintained per item and node.
- Landed cost is apportioned by configured value, weight or volume basis.
- GST documents, IRN and e-way bill use a GSP integration.
- Tally exports include control totals, acknowledgements and re-push support.

## H3 Document and invoice ingestion

Supported sources include vendor invoices, channel sales documents, settlement files, transporter LRs and bills, vendor COAs, GSTR-2B, distributor stock and sales uploads.

Validation includes:

- Document type classification.
- GSTIN and tax arithmetic.
- HSN and item-master mapping.
- Vendor description to internal-item mapping with confidence.
- Duplicate key checks.
- PO, GRN and invoice matching.
- Exception reason, owner and ageing.

Purchase-invoice matching uses vendor, PO, item, quantity and rate against the accepted GRN quantity. The default quantity and rate tolerance is zero unless a controlled policy says otherwise.

Uploaded documents provide financial and reconciliation data. Physical quantity, batch, manufacturing date, expiry and quality state come from live scanned operations.

## H4 Demand planning and forecasting

- Daily sales and stock by channel, SKU, FC or node.
- Lost-sales indicators such as stock-out days and listing suppression.
- Price, promotion, advertising and event calendars.
- Explainable forecast models selected by backtesting.
- OOS-corrected demand.
- New-product analogue and ramp curves.
- Thirteen-week daily and twelve-month monthly horizons.
- Weekly statistical, KAM, supply-review and sign-off cycle.
- Frozen, slushy and free planning windows.
- WMAPE, MAPE and bias by SKU, channel and owner.

## H5 Inventory policy and redistribution

- Monthly or on-demand policy recalculation.
- ABC, XYZ and FSN segmentation.
- Safety stock, reorder point, EOQ, maximum stock and days-of-cover calculations.
- Policy by SKU and node.
- Shelf-life cap on maximum stock.
- Daily redistribution suggestions when one node is above maximum and another is below reorder point.
- Cost-benefit comparison before stock-transfer approval.
- Alerts for ROP, safety stock, projected stock-out, excess cover, zero A-class stock, ageing and no movement.

## H6 MRP and automatic PO

MRP runs nightly and on demand across a 26-week weekly horizon.

```text
Gross requirement
= independent demand
+ BOM-dependent demand

Available
= released on-hand
- reservations
- quarantine, blocked and rejected stock
+ scheduled receipts
+ planned stock-transfer inbound

Net requirement
= gross requirement - available + safety stock
```

Order quantity applies MOQ, order multiple, EOQ, shelf-life maximum and vendor capacity. Release date subtracts measured lead time, inbound QC and safety time.

Rules include low-level BOM processing, wastage, frozen-window protection, demand pegging, vehicle-fill optimisation and price-break evaluation without breaching shelf-life limits.

MRP suggestions require planner action and reason. Approval is driven by value, deviation, vendor status and emergency conditions. Auto-release is limited to proven low-risk items after stable operation.

## H7 Procurement and vendor management

- RFQ and landed-cost quote comparison.
- Rate contracts and index-linked escalation.
- Should-cost models.
- Controlled vendor onboarding from RFI through trial order.
- Vendor portal for PO acknowledgement, ASN, batch, LR, COA, invoice, GRN, rejection, payment and NCR/CAPA.
- PO, post-QC GRN and invoice three-way match.
- Debit notes for rejection, shortage, rate difference and quality recovery.
- MSME 45-day monitoring.
- Monthly vendor scorecard covering quality, delivery, cost, responsiveness and compliance.

## H8 Inbound gate GRN and putaway

```text
Gate entry
-> weighbridge where needed
-> unload and count against ASN
-> scanned GRN with batch MFG and expiry
-> quarantine stock
-> automatic QC lot
-> QA disposition
-> FEFO putaway
-> gate time-out
```

No GRN is created without a valid source document type. Over-receipt tolerance is controlled. Batch fields are mandatory for batch-controlled receipts. Pallet and case labels include item, batch, quantity, GRN and QC state. Damage photos and detention time are captured.

## H9 Quality management

### Quality states

`QUARANTINE`, `UNDER_TEST`, `RELEASED`, `CONDITIONAL_RELEASE`, `ON_HOLD`, `MRB`, `REJECTED`, `RETURN_TO_VENDOR`, `SCRAP` and `RETENTION`.

Only released stock is generally issuable and saleable. QA controls release. Every transition requires user, timestamp, reason and electronic approval where applicable.

### Quality masters

- Parameter definitions, method, unit, specification and criticality.
- Versioned inspection plans for IQC, IPQC, FQC and PDI.
- ISO 2859-1 or IS 2500 attribute sampling and configurable AQLs.
- Normal, tightened, reduced and skip-lot switching.
- Instrument calibration and automatic expiry block.
- Inspector qualifications and requalification.
- Controlled reference samples and artwork.

### Incoming in-process and final inspection

- GRN automatically creates an inspection lot.
- System calculates sample size and random sample instructions.
- Inspectors record actual values and evidence.
- Vendor COA is compared with internal results.
- External-lab requests and TAT are tracked.
- Line clearance gates production.
- Defined-frequency process checks feed control charts.
- Repeated out-of-spec results can hold the line.
- FQC and channel-specific PDI gate dispatch.

### NCR CAPA complaint and recall

- NCR records affected item, batch, quantity, evidence, severity and responsibility.
- MRB dispositions include justified acceptance, deviation, rework, downgrade, return and scrap.
- CAPA records containment, structured root cause, corrective and preventive actions, owner, evidence and effectiveness.
- Complaints link to item and batch and trend by SKU, line, shift and vendor lot.
- Recall follows both forward and backward traceability with recovered-versus-dispatched reconciliation.
- A mock recall runs at least every six months.

## H10 Manufacturing

- Master production schedule from constrained forecast and firm demand.
- Manufacturing orders, job cards, scanned material issue and production receipt into quarantine.
- Material issue, consumption, return, scrap and yield reconciliation.
- OEE by machine and line.
- Downtime, changeover and SMED tracking.
- Preventive maintenance, breakdown and spares use.
- Productivity, scrap and wastage by reason.
- Electronic BMR and BPR assembled from source transactions.

## H11 Inventory counting ageing and returns

- Blind cycle counts: A monthly, B quarterly and C half-yearly.
- Recount and approval above configurable variance thresholds.
- Full stock take with freeze, count, reconciliation and posted adjustment.
- Ageing buckets and value-weighted provisioning.
- Expiry actions at six, four, three and two months, followed by controlled scrap at expiry.
- Marketplace, distributor and D2C return receipt.
- Mandatory A/B/C quality grading.
- Repack work order with original-batch traceability.
- Return-reason analytics and claim reconciliation.

## H12 Outbound channel fulfilment

Channel ingestion supports Amazon, Flipkart, Meesho, quick-commerce platforms, Tata 1mg, FirstCry, Shopify, distributors and B2B sources through API, file, portal export or controlled fallback.

The wider outbound chain is:

```text
Channel PO
-> ATP using released FEFO stock and channel shelf-life rules
-> allocation and reservation
-> appointment
-> pick and scan verification
-> pack and channel labels
-> PDI
-> statutory documents and ASN
-> dispatch
-> POD
-> received-quantity reconciliation
```

Quick-commerce adds city-level sell-out, three-to-seven-day cover, frequent replenishment and new-city ramp monitoring. GT adds primary sales, secondary sales, distributor closing stock, schemes and claims.

## H13 Costing and control tower

- Landed cost and valuation.
- Purchase-price, usage, yield and overhead variance.
- SKU-channel contribution after commission, fulfilment, advertising and return cost.
- Inventory value by item, batch, node, state and age.
- Founder, SCM, QA, Plant and KAM dashboards.
- Configurable alerts with owner, action, channel and escalation ladder.
- Daily digest and alert-volume controls.
- Standard reports, ad-hoc queries, subscriptions, exports and source drill-down.

## H14 Platform and integrations

- Shared workflow and approval engine.
- Global audit and attachment services.
- Notification and escalation engine.
- PWA and offline sync queue for physical operations.
- Camera and handheld barcode scanning.
- Integration gateway for marketplaces, GSP, accounting, transporters, WhatsApp and external labs.
- Retry, exponential backoff, dead-letter queue, alerting and manual reprocessing for every integration.


# Novel SCM Product Document

## 1. End-to-end PO operation flow

Novel SCM manages the operational journey of a channel purchase order (PO):

```text
Sign in
  -> Upload PO document
  -> Extract and review PO fields
  -> Save the PO under a channel and destination
  -> Resolve the source warehouse
  -> Accept the PO
  -> Attach the appointment document
  -> Reserve available stock
  -> Manually plan one or more shipments
  -> Dispatch each truck
  -> Upload POD and enter received quantities
  -> Resolve shortage or discrepancy
  -> Approve short close when the remaining quantity will not arrive
  -> Upload the invoice
  -> Review the audit trail
```

Acceptance and appointment are independent gates. Either one may happen first. Stock reservation is allowed only after both gates are complete. Shipment planning is manual: the user chooses the SKUs and quantities for each truck. One PO can therefore be split across multiple shipments, for example:

```text
PO lines: A, B, C, D
Shipment 1: 75% of A
Shipment 2: remaining 25% of A + B + C + D
```

The database protects the reservation balance, so a shipment cannot plan more than the quantity reserved for that PO line.

## 2. Product overview

Novel SCM is a web-based supply-chain operations workspace for channel POs. It gives the team one operational record that connects the PO document, product lines, warehouse stock, appointment, shipments, delivery confirmation, invoice, and audit history.

The current product is intentionally focused on PO workflows. Production, manufacturing parts, demand planning, MRP, supplier procurement, advanced QC, valuation, statutory accounting, and marketplace API integrations are outside the current operating scope.

### What the product solves

- Keeps PO details and source documents together.
- Converts uploaded documents into editable PO data.
- Maps marketplace product identifiers to internal SKUs.
- Maps destinations to fulfilment warehouses and stock locations.
- Protects stock when an accepted PO is approved.
- Tracks partial shipment, multi-truck dispatch, POD quantities, shortages, and invoice readiness.
- Prevents duplicate or unsafe stock movements through database functions and idempotency keys.
- Preserves important actions in an append-only audit trail.

## 3. Product scope

### Included

- Authentication and role-based access.
- PO upload and review.
- PDF, XLSX, CSV, and DOCX document handling.
- Amazon/RK World, Flipkart, and Blinkit extraction rules.
- Optional OpenRouter extraction with deterministic fallback.
- Channel SKU resolution.
- Warehouse and destination mapping.
- Inventory balances, thresholds, reservations, and movements.
- Acceptance and rejection.
- Appointment attachment.
- Manual shipment planning.
- Multiple shipments per PO.
- Dispatch and in-transit tracking.
- POD upload and received quantity entry.
- Short-close approval.
- Invoice upload after delivery or short close.
- Notifications and file-based development email capture.
- Administration of channels, SKUs, warehouses, locations, mappings, UOMs, and routes.
- Audit log.

### Excluded from the current product

- Production and manufacturing-part workflows.
- Manufacturing orders, BOM execution, routing, OEE, and maintenance.
- Demand forecasting and MRP.
- Supplier RFQ and procurement workflows.
- Full QC inspection and CAPA operations.
- Accounting ledger, GST filing, e-invoice, e-way bill, and Tally integration.
- Direct marketplace and transporter integrations.

## 4. Users and permissions

| Role | Main use |
|---|---|
| Team member | View operational records and perform permitted PO, document, shipment, POD, and inventory actions. |
| Manager | Approve operational actions such as acceptance, master-data changes, and short close when permitted. |
| Administrator | Maintain users, access, and controlled operational data. |
| QC | View records for review; QC users are normally prevented from changing operational records. |

The API checks the authenticated user, company access, write permission, and approval permission before changing data. The company is the main data-security boundary.

## 5. Page views and page elements

### 5.1 Sign-in page

The sign-in page contains:

- Novel SCM branding and product statement.
- Work email field.
- Password field.
- Sign-in button.
- Error message area for invalid credentials or unavailable API access.

On success, the browser stores the access token, refresh token when supplied, and basic user data in local storage. The app then loads the dashboard and operational data.

### 5.2 Shared application shell

After sign-in, every page uses the same shell:

- Left navigation rail.
- Current user name and role.
- Sign-out action.
- Page title and operational-workspace label.
- Search field in the header.
- User avatar initial.
- Toast messages for successful or failed actions.

The navigation pages are Overview, PO Inbox, Inventory, Shipments, Appointments, Invoices, Administration, and Audit Log.

### 5.3 Overview page

The Overview page is the operational starting point.

Elements:

- **Upload purchase order**: opens PO document intake.
- **Awaiting review**: count of POs needing attention.
- **Inventory blocked**: accepted PO activity holding stock.
- **In transit**: shipments currently moving.
- **Awaiting invoice**: delivered PO activity ready for invoice.
- **Recent purchase orders**: latest PO activity with channel, destination, and status.
- **Warehouse pulse**: available stock by SKU and warehouse.

The page receives its summary from `/api/dashboard`.

### 5.4 PO Inbox page

The PO Inbox is the document-intake and PO-review queue.

List elements:

- PO ID.
- Platform and destination.
- Resolved warehouse or **Mapping required**.
- Current status badge.
- Quick Accept action for POs in review.

Selecting a PO opens the full PO workspace.

#### Upload PO flow

1. Select the source platform.
2. Choose a PDF, XLSX, CSV, or DOCX file.
3. The browser validates the extension, MIME type, and 10 MB size limit.
4. The browser extracts readable text where possible.
5. The API stores the original file and extracts structured values.
6. The review screen shows confidence and editable header and line fields.
7. The user corrects missing or wrong fields.
8. The user saves the reviewed PO.

The required save checks are PO ID, PO date, destination, at least one line, an internal SKU for every line, and a positive line quantity.

#### Extracted PO fields

- PO ID, PO date, destination, booking deadline, customer/vendor, and total PO value.
- SKU lines, ordered quantity, and unit price.
- Source identifiers such as channel SKU, ASIN, EAN, HSN, or description.

### 5.5 PO full workspace

Opening a PO displays a full-page workspace with these tabs:

#### Overview tab

Channel, PO status, customer, destination, warehouse, PO value, fulfilment progress, source document, created and accepted timestamps, inventory state, and next steps.

#### Lines & Inventory tab

Each line shows SKU code and name, ordered, allocated, blocked, planned, dispatched, delivered, and remaining quantities.

#### Appointment tab

Appointment ID, status, location, booking time, appointment time, and attached document.

#### Shipments tab

Shipment number, truck, driver, planned dispatch time, expected arrival, cost, status, and POD state.

#### POD & Discrepancies tab

POD files, receiver, delivery confirmation time, and delivery records.

#### Invoice tab

Invoice number, amount, and invoice file. It also explains when the invoice gate is closed.

#### Audit Activity tab

Points the user to the permanent audit history for the PO.

### 5.6 Inventory page

The Inventory page is an inventory and master-data workspace with these tabs:

#### Stock tab

Search, SKU and warehouse stock rows, physical, blocked, in-transit, released, threshold, allocatable, Add stock, and stock transaction history.

Add stock requires SKU, warehouse, optional location, quantity, and reason. The API posts a stock transaction; it does not directly edit a balance.

#### SKUs tab

SKU list, Add SKU, SKU code, product title, item class, base UOM, and edit action.

#### Warehouses tab

Warehouse list, Add warehouse, warehouse code, name, city, state, and locations.

#### Mappings tab

Channel SKU mappings connect marketplace product codes to internal SKUs. Destination mappings connect channel destinations to source warehouses and stock locations.

#### UOMs & routes tab

Unit-of-measure code, name, dimension, route source warehouse, destination key, transit hours, and estimated cost.

### 5.7 Shipments page

The Shipments page tracks truck-level movement.

Top elements:

- POs ready for manual shipment planning.
- One plan button per eligible PO.
- Shipment count.

Shipment table elements:

- Shipment number.
- PO number.
- Vehicle or unassigned state.
- Shipment status.
- Dispatch action for planned shipments.
- Confirm POD action for dispatched or in-transit shipments.

#### Manual multi-shipment planning

The planning modal contains truck number, driver name, driver phone, planned dispatch time, SKU list, remaining quantity per SKU, quantity assigned to this shipment, total selected quantity, and Create shipment.

All SKU quantities start at zero. The user chooses the exact lines and quantities for this truck. A later planning action can create another shipment for the same PO. The API rejects a shipment if its line quantity exceeds the reserved balance.

### 5.8 Appointments page

The Appointments page is a queue for appointment records booked outside the application.

Elements are PO number, destination, appointment status, appointment time, and Attach appointment. The attachment modal accepts the document and captures appointment ID, appointment time, and location.

### 5.9 Invoices page

The Invoices page is the delivery and closure queue.

Elements are PO number, PO status, invoice number or not-uploaded state, Upload invoice, and Short close.

The invoice modal captures invoice file, number, date, amount, and currency. The API allows one invoice per PO and only allows upload after full delivery or approved short close.

The short-close modal captures remaining quantity and reason. It requires approval and releases unneeded blocked stock.

### 5.10 Administration page

The Administration page provides a compact view of platforms, warehouses, and SKUs. Detailed creation and editing of locations, mappings, UOMs, and routes happens in Inventory.

### 5.11 Audit Log page

The Audit Log shows recent immutable events: action, record type and short ID, user, and time. Examples include PO creation, acceptance, rejection, stock addition, master changes, shipment creation, dispatch, POD, short close, invoice upload, and document viewing.

## 6. Data flow

### Browser to API

The React/Vite frontend uses a shared API wrapper that adds the `/api` prefix, sends the bearer token, sends JSON for normal operations, sends multipart form data for documents, refreshes the session after a 401, and displays API errors as toasts or modal messages.

### API to Supabase

The NestJS API uses Supabase for company-scoped reads and security-definer database functions. Write actions check write or approval permission before calling the database.

The main PO read operation is `/api/pos`. The service loads PO headers, lines, channels, sites, gate state, appointments, reservations, shipment records, PODs, invoices, exceptions, items, and documents, then joins them into the shape consumed by the UI.

### Document data flow

```text
Browser file
  -> client validation and text extraction
  -> POST /api/documents/extract
  -> storage save with generated path
  -> PDF text extraction when needed
  -> OpenRouter structured extraction when configured
  -> deterministic platform rules as fallback
  -> SKU identifier resolution
  -> SHA-256 duplicate check
  -> versioned document registration
  -> editable review fields
  -> scm.create_purchase_order
```

### PO and stock data flow

```text
PO saved
  -> source document linked
  -> destination mapping resolves source site/location
  -> acceptance decision recorded
  -> appointment decision recorded
  -> gate view reports readiness
  -> reservation function locks released stock
  -> inventory ledger records reserved quantity
  -> manual shipment records selected line quantities
  -> dispatch moves selected quantity to transit
  -> POD confirms delivered/short/damaged/rejected quantity
  -> short close releases unresolved reserved stock
  -> invoice gate opens
```

Important quantities are physical, blocked, allocatable, planned, dispatched, delivered, and remaining. Stock-changing operations use database functions and idempotency keys, so repeating a request returns the original result instead of making a second movement.

## 7. Core business rules

1. A PO external number is unique within a channel and company.
2. A source document can be detected as a duplicate by SHA-256 hash.
3. A PO needs valid lines before it can be saved.
4. A PO needs a warehouse mapping before acceptance can reserve stock.
5. Acceptance and appointment are separate gates.
6. Reservation is created only after both gates are complete.
7. Only released, allocatable stock can be reserved.
8. Threshold stock is protected from normal reservation.
9. One PO may have multiple shipments.
10. Each shipment may contain selected lines and partial quantities.
11. Total planned quantity cannot exceed reserved quantity.
12. Dispatch is idempotent and moves only the shipment’s planned quantity.
13. POD quantities cannot exceed outstanding dispatched quantity.
14. Short close requires a reason and approval.
15. One invoice is allowed per PO.
16. Invoice upload is gated until full delivery or approved short close.
17. Important changes are audited.
18. QC users are normally read-only.

## 8. PO status lifecycle

Common statuses include:

```text
UPLOADED
EXTRACTION_REVIEW_REQUIRED
UNDER_REVIEW
ACCEPTED
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
```

The status is supported by separate acceptance, appointment, reservation, shipment, POD, and invoice facts. Status should not replace line-level quantities.

## 9. API surface used by the product

### Authentication

- `POST /auth/login`
- `POST /auth/refresh`

### Reads

- `GET /api/dashboard`
- `GET /api/pos`
- `GET /api/masters`
- `GET /api/inventory`
- `GET /api/inventory/transactions`
- `GET /api/audit`

### PO workflow writes

- `POST /api/documents/extract`
- `POST /api/pos`
- `POST /api/pos/:id/accept`
- `POST /api/pos/:id/reject`
- `POST /api/pos/:id/appointment`
- `POST /api/pos/:id/shipments`
- `POST /api/shipments/:id/dispatch`
- `POST /api/shipments/:id/events`
- `POST /api/pos/:id/pods`
- `POST /api/pos/:id/short-close`
- `POST /api/pos/:id/invoice`

### Master and inventory writes

- `POST /api/skus`, `/api/skus/:id`
- `POST /api/warehouses`, `/api/warehouses/:id`
- `POST /api/locations`, `/api/locations/:id`
- `POST /api/mappings`, `/api/mappings/:id`
- `POST /api/routes`, `/api/routes/:id`
- `POST /api/uoms`, `/api/uoms/:id`
- `POST /api/inventory/add`
- `POST /api/inventory/transactions/:id/reverse`

## 10. Database model

| Schema | Responsibility |
|---|---|
| `iam` | Users, roles, and company access. |
| `master_data` | Companies, sites, locations, UOMs, items, identifiers, channels, mappings, and routes. |
| `documents` | Files, versions, extraction runs, fields, and links. |
| `workflow` | Approval requests and status history. |
| `scm` | Channel POs, gates, appointments, shipments, POD, exceptions, short close, and invoices. |
| `inventory` | Batches, stock transactions, ledger entries, policies, reservations, counts, and adjustments. |
| `platform` | Audit, idempotency, notifications, integration jobs, outbox, and document numbering. |
| `quality`, `planning`, `procurement`, `finance`, `manufacturing` | Schema foundations and extensions; not active user workflows in the current scope. |

Key active entities are companies, users, channels, sites, locations, UOMs, items, item identifiers, destination mappings, routes, document versions, purchase orders, PO lines, acceptance decisions, appointments, reservations, reservation lines, reservation allocations, shipments, shipment lines, shipment events, PODs, POD lines, delivery exceptions, short-close decisions, invoices, stock transactions, stock ledger entries, notifications, and audit events.

## 11. Technical implementation map

### Web

- `apps/web/src/main.tsx`: shell, login, navigation, dashboard, PO inbox, shipments, appointments, invoices, administration, audit, and API client.
- `apps/web/src/components/DocumentWorkflowModal.tsx`: appointment, POD, and invoice flows.
- `apps/web/src/components/InventoryWorkspace.tsx`: stock and master-data tabs and forms.
- `apps/web/src/components/PoDetailsPage.tsx`: full PO workspace tabs.
- `apps/web/src/components/PoInboxAccordion.tsx`: expandable PO summary.
- `apps/web/src/components/ShipmentPlanModal.tsx`: manual shipment planning by SKU and quantity.
- `apps/web/src/components/ShortCloseModal.tsx`: short-close approval form.
- `apps/web/src/components/SkuInventoryAccordion.tsx`: SKU-first inventory detail.
- `apps/web/src/lib/document-upload.ts`: file validation and text preparation.
- `apps/web/src/index.css`: fonts, colors, density, and layout.

### API

- `apps/api/src/main.ts`: NestJS bootstrap, CORS, and body limits.
- `apps/api/src/app.controller.ts`: authenticated operational endpoints.
- `apps/api/src/app.service.ts`: company-scoped reads, permission checks, RPC calls, and response shaping.
- `apps/api/src/auth.controller.ts` and `auth.ts`: authentication and guards.
- `apps/api/src/document.controller.ts` and `document.service.ts`: storage, extraction, duplicate detection, and signed URLs.
- `apps/api/src/document-extractor.ts`: deterministic parsing.
- `apps/api/src/openrouter-extractor.ts`: structured AI extraction and validation.
- `apps/api/src/sku-resolver.ts`: identifier, code, and name matching.
- `apps/api/src/notification.controller.ts` and `notification.service.ts`: notification list and retrying send.
- `apps/api/src/email.service.ts`: file capture or SMTP delivery.
- `apps/api/src/supabase.service.ts`: Supabase client and RPC helpers.

### Database and seeds

- `supabase/migrations/202610030001_scm_v2_foundation.sql`: v2 schemas, identity, master data, documents, workflow, audit, and integration foundations.
- `supabase/migrations/202610030002_scm_v2_core.sql`: PO, inventory, reservation, shipment, POD, exception, and invoice entities.
- `supabase/migrations/202610030003_scm_v2_bos_extensions.sql`: extended quality, planning, procurement, finance, and manufacturing tables.
- `supabase/migrations/202610030004_scm_v2_workflows.sql`: atomic functions, ledger controls, idempotency, reservations, shipments, POD, short close, and invoice gates.
- `supabase/migrations/202610030005_scm_v2_security_compat.sql`: RLS, grants, compatibility views, and security controls.
- `supabase/migrations/202610040001_scm_v2_api_cutover.sql`: document registration, stock-add helpers, notification triggers, and shipment events.
- `supabase/migrations/202610060001_harden_superadmin_audit_storage.sql`: audit, storage, and super-admin hardening.
- `apps/api/scripts/seed-v2.ts`: v2 demo data and workflow examples.
- `apps/api/scripts/seed-scm-detail.ts`: source-file-derived warehouses, channels, SKUs, mappings, routes, stock, and POs.
- `data/scm-detail-seed.json`: normalized sample data.

## 12. Validation status

- API tests: 27 passed.
- Web tests: 5 passed.
- Web production build: passed.
- API production build: currently blocked by the existing TypeScript `ignoreDeprecations: "6.0"` configuration error in `apps/api/tsconfig.json`.
- Supabase structural and workflow SQL tests require a migrated Supabase project and were not run in this local environment.

## 13. Design direction

The product uses an industrial command-centre style: ink navigation, warm operational canvas, white work surfaces, warehouse green for usable states, amber for warnings, red for errors, IBM Plex Mono for identifiers, Instrument Sans for interface text, compact tables, and progressive disclosure.

## 14. Related documents

- [USER-GUIDE.md](USER-GUIDE.md): daily operation and data-entry instructions.
- [README.md](README.md): setup, startup, seed, and validation commands.
- [DATABASE_SCHEMA.md](DATABASE_SCHEMA.md): schema ownership, relationships, constraints, and workflow functions.
- [DESIGN.md](DESIGN.md): visual system and layout decisions.
- [COMPLETION-REPORT.md](COMPLETION-REPORT.md): implementation summary and remaining environment validation.

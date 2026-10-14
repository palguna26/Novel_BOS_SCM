# SCM to Sales Integration: Detailed Implementation Plan

## 1. Goal

Build a stable, read-only SCM v2 integration API that lets the separate Sales application synchronize SCM master and operational data through UAT without direct database access.

The work has two parts:

1. Fix SCM data-model and workflow gaps found during the audit.
2. Build a versioned API, service authentication, synchronization contract, OpenAPI documentation, test data and UAT support.

This is an epic. It should be delivered as small changes that can each be reviewed and deployed independently.

## 2. Verified current state

Verified on 2026-10-12.

- The NestJS backend exposes four broad internal reads: `/api/masters`, `/api/inventory`, `/api/inventory/transactions` and `/api/pos` in `apps/api/src/app.controller.ts`.
- `apps/api/src/app.service.ts` loads full tenant datasets and assembles UI responses in memory. It has no external pagination or incremental cursor.
- `apps/api/src/main.ts` has no URI versioning or Swagger setup.
- `apps/api/src/auth.ts` accepts signed-in Supabase user tokens. There is no Sales service identity or integration scope.
- SCM v2 contains product, channel, site, location, inventory ledger, reservation, PO, appointment, shipment, POD, exception, short-close and invoice tables.
- Planning, procurement and valuation tables exist, but no active backend population workflow or read API was found.

## 3. Architecture

```text
SCM PostgreSQL/Supabase
        |
        | internal repository queries and approved read views
        v
SCM NestJS API: /api/v1/integration/*
        |
        | HTTPS + scoped service credential + cursor pagination
        v
Sales synchronization worker
        |
        v
Sales local integration tables and dashboards
```

Rules:

- Sales never receives SCM database credentials.
- Tenant scope comes from the authenticated integration client, not from a caller-supplied company ID.
- Integration controllers are read-only.
- SCM workflow calculations remain authoritative.
- The current frontend routes remain available while the new API is introduced.
- Internal tables are never part of the public contract. Response DTOs are the contract.

## 4. Decisions used by this plan

These are the recommended defaults. Business owners must approve items marked **approval gate** before the related migration is deployed.

| Area | Decision |
|---|---|
| Baseline | SCM v2 namespaced schemas are the only long-term integration baseline. |
| Stock | `available = RELEASED stock`; `allocatable = max(available - threshold, 0)`. Physical, reserved and unavailable states are returned separately. |
| Appointment relationship | Add an appointment header and appointment-to-PO link table so one appointment may cover several POs. **Approval gate.** |
| PO acceptance | Add line-level accepted and rejected quantities while retaining a header decision. **Approval gate.** |
| Short closure | Add line-level short-close quantities linked to PO lines. **Approval gate.** |
| POD | Separate draft/upload, confirmation and approval. Only approved POD quantities count as delivered. **Approval gate.** |
| Ownership transfer | Add an explicit ownership-transfer event. Default it to approved POD time, but keep it independently recordable. **Approval gate.** |
| Invoice cardinality | Allow multiple invoice records per PO with one active version per invoice number. **Approval gate.** |
| Synchronization | Initial collection snapshots plus a durable `/changes` feed using a numeric cursor. |
| UAT notifications | Polling is the supported method. Webhooks are deferred until polling passes UAT. |
| Authentication | Opaque bearer credentials stored only as SHA-256 hashes, scoped to one company and explicit read scopes. |
| Decimal values | Quantities and monetary values are JSON strings to prevent floating-point loss. |
| Dates | UTC ISO 8601 timestamps. Date-only fields remain `YYYY-MM-DD`. |

## 5. Domain fixes

### 5.1 Product and marketplace identifiers

Add to `master_data.items`:

```sql
alter table master_data.items
  add column description text,
  add column subcategory text,
  add column production_lead_time_days numeric(10,2),
  add column pack_quantity numeric(18,6),
  add column carton_quantity numeric(18,6);
```

Extend identifier types to:

```text
EAN, GTIN, UPC, BARCODE, LEGACY,
AMAZON_ASIN, AMAZON_SELLER_SKU,
FLIPKART_PRODUCT_ID, FLIPKART_SKU,
MEESHO_PRODUCT_ID, MEESHO_SKU,
CHANNEL_SKU
```

Add mapping quality fields to `master_data.item_identifiers`:

```sql
mapping_status text not null default 'ACTIVE'
  check (mapping_status in ('ACTIVE','INACTIVE','AMBIGUOUS','UNMAPPED')),
valid_from timestamptz not null default statement_timestamp(),
valid_to timestamptz,
updated_at timestamptz not null default statement_timestamp()
```

Change uniqueness so channel-specific identifiers include `channel_id`. Add an index for case-normalized identifier resolution. Preserve original identifier case in the stored value.

Migration rules:

- Existing `CHANNEL_SKU` rows remain valid.
- Backfill `mapping_status = ACTIVE`.
- Do not guess ASIN or marketplace-specific types during migration.
- Seed and admin workflows must explicitly classify existing generic mappings.

### 5.2 Site and destination addresses

Add structured address fields to `master_data.sites` and `master_data.destination_mappings`:

```text
address_line_1, address_line_2, locality, city, state,
postal_code, country_code, latitude, longitude
```

Keep PO and shipment address snapshots. Master changes must not rewrite historical documents.

### 5.3 Inventory read models

Create `integration.inventory_availability_v` grouped by company, site, item and UOM with:

```text
physical_quantity
available_quantity
reserved_quantity
threshold_quantity
allocatable_quantity
in_transit_quantity
quarantine_quantity
on_hold_quantity
rejected_quantity
damaged_quantity
scrap_quantity
last_movement_at
snapshot_at
```

Create `integration.inventory_balance_detail_v` grouped by company, site, location, item, batch, stock state and UOM.

Definitions:

- Physical: warehouse-held stock excluding transit, customer, external source, external sink and scrap.
- Available: `RELEASED` stock in physical warehouse locations.
- Reserved: `RESERVED` stock in physical warehouse locations.
- Threshold: the latest effective inventory policy threshold.
- Allocatable: `greatest(available - threshold, 0)`.
- In transit: stock in transit locations or `IN_TRANSIT` state.
- Damaged: add a dedicated `DAMAGED` stock state. Stop using `QUARANTINE` as the only representation for damaged delivery stock.
- Snapshot time: database `statement_timestamp()` when the view is read.
- Last movement: maximum posted stock transaction time for the grouping.

Update POD posting so damaged quantity enters `DAMAGED`; rejected quantity enters `REJECTED`.

### 5.4 Reservation lifecycle

Add to `inventory.reservations`:

```text
cancelled_at, cancellation_reason, superseded_at, updated_at
```

Expose allocated quantity as:

```text
sum(reservation_allocations.quantity)
```

Expose open allocation as:

```text
quantity - dispatched_quantity - released_quantity
```

Create `integration.reservation_detail_v` joining PO, PO line, item, reservation line, allocations, batch and stock transaction references.

### 5.5 PO line operational quantities

Add `scm.acceptance_decision_lines`:

```sql
create table scm.acceptance_decision_lines (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  acceptance_decision_id uuid not null references scm.acceptance_decisions(id),
  purchase_order_line_id uuid not null references scm.purchase_order_lines(id),
  accepted_quantity numeric(18,6) not null default 0,
  rejected_quantity numeric(18,6) not null default 0,
  reason text,
  unique (acceptance_decision_id, purchase_order_line_id)
);
```

Rules:

- `accepted + rejected <= ordered`.
- Header `ACCEPTED` may include partial line rejection.
- Header `REJECTED` requires all lines to have zero accepted quantity.
- Reservation demand uses accepted quantity.
- Existing accepted POs are backfilled with accepted quantity equal to ordered quantity.
- Existing rejected POs are backfilled with rejected quantity equal to ordered quantity.

Create `integration.purchase_order_line_state_v` with authoritative values:

```text
ordered_quantity
accepted_quantity
rejected_quantity
reserved_quantity
allocated_quantity
dispatched_quantity
delivered_quantity
damaged_quantity
delivery_rejected_quantity
approved_short_close_quantity
outstanding_quantity
line_status
```

Formula:

```text
outstanding = max(
  accepted - delivered - delivery_rejected - approved_short_close,
  0
)
```

Dispatched quantity is shown separately and never reduces outstanding delivery quantity.

### 5.6 Operational gate view

Extend `scm.po_gate_state_v` or replace it with `integration.po_gate_state_v` containing:

```text
acceptance_status
acceptance_decided_at
appointment_status
appointment_match_status
reservation_eligible
shipment_planning_eligible
operational_hold
hold_reason
current_gate_status
approval_request_id
updated_at
```

Sales must consume this view. It must not infer gates from `purchase_orders.status`.

### 5.7 Multi-PO appointments

Refactor appointments in two migrations:

1. Add `scm.appointment_purchase_orders`.
2. Backfill one link for every current appointment.
3. Update workflows and backend reads to use the link table.
4. Remove the one-active-appointment-per-PO index only after code cutover.
5. Keep `appointments.purchase_order_id` temporarily for compatibility, then remove it in a later release.

Add appointment fields:

```text
scheduled_start_at
scheduled_end_at
confirmation_number
confirmed_at
cancelled_at
cancellation_reason
rescheduled_from_id
updated_at
```

Rules:

- A PO may have at most one active matched appointment unless its channel policy waives appointments.
- An appointment may link to many POs for the same company, channel and destination.
- All linked POs must pass destination consistency checks.

### 5.8 Shipment tracking

Add to `scm.shipments`:

```text
tracking_reference
lr_number
cancelled_at
cancellation_reason
```

Keep multiple shipments per PO and existing partial-dispatch rules.

### 5.9 POD approval and multi-shipment processing

Change POD status values to:

```text
DRAFT, SUBMITTED, APPROVED, REJECTED, REPLACED, REVERSED
```

Add:

```text
submitted_by, submitted_at,
approved_by, approved_at,
rejected_by, rejected_at, rejection_reason,
updated_at
```

Workflow:

1. Upload creates `DRAFT`.
2. Submission validates all linked shipment lines and quantities.
3. Approval posts the delivery stock transaction atomically.
4. Only `APPROVED` PODs update delivered quantities.
5. Reversal creates a new reversing stock transaction and retains the original POD.

Update the backend request so one POD accepts a list of shipment IDs and line results. Preserve `scm.pod_shipment_links` as the many-to-many relationship.

### 5.10 Delivery exceptions

Add `purchase_order_line_id`, `item_id`, `updated_at` and optional `resolution_document_version_id` to `scm.delivery_exceptions`.

Backfill item and PO line through the existing POD and shipment-line relationships.

### 5.11 Line-level short closure

Add `scm.short_close_decision_lines`:

```text
id, company_id, short_close_decision_id,
purchase_order_line_id, approved_quantity,
reason, created_at
```

Rules:

- Sum of approved short closure for a line cannot exceed its outstanding quantity.
- Approval releases only the unshipped reserved quantity for affected lines.
- A short-closed PO is never reported as fully delivered.
- Reversal creates a new decision/version and restores state through an auditable workflow.

### 5.12 Ownership transfer

Add `scm.ownership_transfer_events`:

```text
id, company_id, purchase_order_id, shipment_id, pod_id,
event_type, transferred_at, basis, recorded_by, created_at
```

`basis` values: `POD_APPROVAL`, `CUSTOMER_RECEIPT`, `CONTRACTUAL_EVENT`, `MANUAL_APPROVED`.

### 5.13 Invoice versioning

Remove the unique constraint on `purchase_order_id`. Add:

```text
invoice_type, status, supersedes_invoice_id, active, updated_at
```

Types: `INVOICE`, `CREDIT_NOTE`, `DEBIT_NOTE`.

Statuses: `DRAFT`, `ISSUED`, `SENT`, `CANCELLED`, `SUPERSEDED`.

### 5.14 Planning, inbound and valuation

Treat these as later deliverables:

- Planning endpoints stay disabled until a documented process populates `planning.demand_observations`, `planning.forecasts` and `planning.mrp_suggestions`.
- Inbound endpoints stay disabled until procurement POs, ASNs and goods receipts are used by SCM workflows.
- Valuation endpoints stay disabled until every inventory transaction posts an equal valuation-ledger entry where required and reconciliation tests pass.

Do not return zeroes as if these domains were operational.

## 6. Integration platform schema

Create a new `integration` schema.

### 6.1 Service clients

```sql
create table integration.clients (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references master_data.companies(id),
  name text not null,
  credential_prefix text not null unique,
  credential_hash text not null,
  scopes text[] not null,
  active boolean not null default true,
  expires_at timestamptz,
  last_used_at timestamptz,
  created_by uuid not null references iam.users(id),
  created_at timestamptz not null default statement_timestamp(),
  revoked_at timestamptz,
  unique (company_id, name)
);
```

Credential rules:

- Generate at least 32 random bytes.
- Display plaintext once.
- Store only SHA-256 hash and a short non-secret prefix.
- Compare hashes in constant time.
- Require TLS outside local development.
- Support key rotation with two overlapping active credentials.
- Audit successful use, failed use, creation, rotation and revocation.

Scopes:

```text
master:read
inventory:read
po:read
fulfilment:read
movement:read
finance:read
planning:read
```

### 6.2 Durable change feed

```sql
create table integration.change_log (
  sequence_id bigint generated always as identity primary key,
  company_id uuid not null,
  entity_type text not null,
  entity_id uuid not null,
  operation text not null check (operation in ('CREATED','UPDATED','DEACTIVATED','CANCELLED','REVERSED','SUPERSEDED')),
  entity_version bigint not null default 1,
  changed_at timestamptz not null default statement_timestamp(),
  data jsonb not null default '{}'::jsonb,
  unique (company_id, entity_type, entity_id, entity_version)
);
```

Use narrow database triggers to append changes after successful commits. Store routing data only, not full sensitive records. Sales fetches the latest entity from its normal endpoint.

Cursor format:

```text
base64url({"sequence":123456})
```

Retention:

- Keep change records for at least 180 days through UAT.
- If a cursor is older than retention, return `410 SYNC_CURSOR_EXPIRED` and require a new full snapshot.

### 6.3 API request audit

Create `integration.request_audit` with request ID, client ID, company ID, route, status code, duration, record count, IP hash and timestamp. Do not store credentials or response bodies.

## 7. API standards

### 7.1 Base URLs

```text
Development: http://localhost:4000/api/v1/integration
Staging:     https://<staging-host>/api/v1/integration
Production:  https://<production-host>/api/v1/integration
```

Only the development URL is fixed by the current repository. Staging and production hosts must be supplied by deployment owners.

### 7.2 Authentication

```http
Authorization: Bearer <opaque-service-credential>
X-Request-Id: <optional caller UUID>
```

Return `401` for missing or invalid credentials and `403` for a missing scope.

### 7.3 Collection response

```json
{
  "data": [],
  "page": {
    "limit": 100,
    "nextCursor": null,
    "hasMore": false
  },
  "meta": {
    "requestId": "uuid",
    "asOf": "2026-10-12T10:00:00.000Z"
  }
}
```

Defaults and limits:

- Default `limit=100`.
- Maximum `limit=500`.
- Sort by a stable tuple ending in UUID.
- Invalid cursors return `400 INVALID_CURSOR`.

### 7.4 Error response

```json
{
  "error": {
    "code": "INVALID_FILTER",
    "message": "updatedAfter must be an ISO 8601 timestamp",
    "details": [{"field": "updatedAfter", "reason": "invalid_format"}],
    "requestId": "uuid"
  }
}
```

### 7.5 Query conventions

Common filters:

```text
limit, cursor, updatedAfter, active, status,
channelId, siteId, locationId, itemId,
purchaseOrderId, shipmentId, from, to
```

- Caller cannot override company scope.
- Unknown query parameters return `400`.
- `updatedAfter` is an initial convenience filter. `/changes` is the reliable incremental mechanism.
- Date range end is exclusive.

### 7.6 Compatibility

- Additive optional fields are backward compatible.
- Removing or renaming fields requires a new major path.
- Enum additions are announced before release and consumers must tolerate unknown values.
- Keep a deprecated major version for at least 90 days after replacement during UAT and initial production use.

### 7.7 Rate and timeout defaults

- 300 requests per minute per integration client.
- Burst limit of 30 requests per second.
- 15-second server timeout for collection endpoints.
- Return `429` with `Retry-After`.
- No request may return more than 500 records.

These values must be load-tested before production confirmation.

## 8. Endpoint plan

All endpoints are `GET` and read-only.

| Endpoint | Scope | Main source | Required filters |
|---|---|---|---|
| `/health` | authenticated client | application | none |
| `/products` | `master:read` | items, UOM, conversions | item, status, updatedAfter |
| `/products/{id}` | `master:read` | items | UUID |
| `/product-identifiers` | `master:read` | item identifiers | item, channel, type, value, status |
| `/product-identifiers/resolve` | `master:read` | item identifiers | channel, type, value |
| `/channels` | `master:read` | channels | active, updatedAfter |
| `/sites` | `master:read` | sites | type, active, updatedAfter |
| `/locations` | `master:read` | locations | site, type, active, updatedAfter |
| `/destinations` | `master:read` | destination mappings | channel, source site, active |
| `/inventory` | `inventory:read` | availability view | site, item, stock status |
| `/inventory/balances` | `inventory:read` | detail balance view | site, location, item, batch, state |
| `/reservations` | `inventory:read` | reservation detail view | PO, item, site, status |
| `/purchase-orders` | `po:read` | PO header read view | channel, site, destination, status, dates |
| `/purchase-orders/{id}` | `po:read` | PO aggregate read model | UUID |
| `/purchase-order-lines` | `po:read` | PO line state view | PO, item, status, updatedAfter |
| `/po-gates` | `po:read` | gate view | PO, gate status, eligibility |
| `/appointments` | `fulfilment:read` | appointments and links | PO, channel, destination, status, dates |
| `/shipments` | `fulfilment:read` | shipments | PO, site, status, dates |
| `/shipment-lines` | `fulfilment:read` | shipment lines | shipment, PO line, item |
| `/shipment-events` | `fulfilment:read` | events | shipment, status, dates |
| `/pods` | `fulfilment:read` | PODs, links, lines | PO, shipment, status, dates |
| `/delivery-exceptions` | `fulfilment:read` | exceptions | PO, shipment, item, type, status |
| `/short-closures` | `po:read` | decisions and lines | PO, PO line, status |
| `/invoices` | `po:read` | invoices | PO, type, status, dates |
| `/inventory-movements` | `movement:read` | transactions and ledger | item, site, type, document, dates |
| `/ownership-transfers` | `fulfilment:read` | transfer events | PO, shipment, POD, dates |
| `/changes` | any read scope | change log | cursor, entity types |
| `/valuations` | `finance:read` | valuation read view | disabled until ready |
| `/inbound-commitments` | `planning:read` | procurement read view | disabled until ready |
| `/forecasts` | `planning:read` | forecasts | disabled until ready |

### 8.1 Product response

```json
{
  "id": "uuid",
  "code": "INTERNAL-SKU",
  "name": "Product name",
  "description": null,
  "brand": "Brand",
  "category": "Category",
  "subcategory": null,
  "variant": "Variant",
  "itemClass": "FG",
  "lifecycleStatus": "ACTIVE",
  "baseUom": {"id": "uuid", "code": "EA"},
  "packQuantity": "12.000000",
  "cartonQuantity": "48.000000",
  "minimumOrderQuantity": "48.000000",
  "orderMultiple": "48.000000",
  "leadTimeDays": "7.00",
  "productionLeadTimeDays": null,
  "createdAt": "2026-10-12T10:00:00.000Z",
  "updatedAt": "2026-10-12T10:00:00.000Z"
}
```

Identifier resolution outcomes:

- `200`: exactly one active match.
- `404 PRODUCT_MAPPING_NOT_FOUND`: no active match.
- `409 PRODUCT_MAPPING_AMBIGUOUS`: more than one candidate, with candidate SCM item IDs returned.
- `410 PRODUCT_MAPPING_INACTIVE`: a historical mapping exists but is inactive.

### 8.2 Inventory response

Return every requested quantity even when zero. Include `quantityDefinitionVersion: "1"` so formula changes can be managed explicitly.

### 8.3 PO detail response

PO detail returns header, authoritative gate state and links to lines, appointments, reservations, shipments, PODs, exceptions, short closures and invoices. Large child collections remain separately pageable. The detail response may include only the first 100 children and must provide child collection links.

### 8.4 Movement response

Convert a stock transaction and its ledger legs into:

```text
movementId, type, postingAt, itemId, batchId, UOM,
quantity, source site/location/state,
destination site/location/state,
document type/id/number, reversal reference, reason
```

For adjustments that have no matching source and destination, return one side as null and preserve signed quantity.

## 9. Backend implementation structure

Add:

```text
apps/api/src/integration/
  integration.module.ts
  integration-auth.guard.ts
  integration-scope.decorator.ts
  integration.controller.ts
  integration.service.ts
  integration.repository.ts
  integration-serializer.ts
  integration-exception.filter.ts
  integration-request.interceptor.ts
  dto/
    pagination-query.dto.ts
    product-query.dto.ts
    inventory-query.dto.ts
    po-query.dto.ts
    fulfilment-query.dto.ts
    movement-query.dto.ts
    change-query.dto.ts
  responses/
    product.response.ts
    inventory.response.ts
    purchase-order.response.ts
    fulfilment.response.ts
    movement.response.ts
```

Responsibilities:

- Controller: route definitions and OpenAPI annotations only.
- DTOs: validation and documented query fields.
- Guard: credential validation, tenant binding and scopes.
- Repository: database queries with tenant filters and keyset pagination.
- Service: mapping read models to stable contract fields.
- Serializer: decimal and timestamp normalization.
- Interceptor: request ID, timing, rate limits and audit.
- Exception filter: stable error envelope.

Do not extend the large existing `AppService` for this API.

## 10. OpenAPI and documentation

Add NestJS Swagger packages and expose:

```text
GET /api/docs
GET /api/docs-json
```

Requirements:

- OpenAPI 3.1 where supported by the selected NestJS Swagger version.
- Bearer authentication scheme.
- All filters, schemas, enums and examples documented.
- Disabled endpoints marked `503 DOMAIN_NOT_READY` only in non-production documentation builds; do not advertise them as available production APIs.
- Commit a generated contract snapshot at `docs/openapi/scm-sales-v1.json`.
- Add `docs/integration/business-rules.md`.
- Add `docs/integration/synchronization.md`.
- Add `docs/integration/uat-guide.md`.

CI must fail when generated OpenAPI differs from the committed snapshot.

## 11. Delivery backlog

Each child item should fit within one to three engineering days.

| ID | Work item | Priority | Estimate | Dependency |
|---|---|---:|---:|---|
| I01 | Approve stock, appointment, acceptance, POD, short-close, ownership and invoice rules | Critical | 1-2 days | none |
| I02 | Add integration schema, clients, scopes and request audit | Critical | 2-3 days | I01 |
| I03 | Add change log, triggers, retention and cursor rules | Critical | 2-3 days | I02 |
| I04 | Add API module, auth guard, error envelope, pagination and rate limiting | Critical | 3 days | I02 |
| I05 | Add Swagger, contract snapshot and CI drift check | Critical | 2 days | I04 |
| I06 | Extend product and identifier data model | High | 2 days | I01 |
| I07 | Implement product, identifier and resolution endpoints | High | 3 days | I04, I06 |
| I08 | Extend site and destination addresses | High | 2 days | I01 |
| I09 | Implement channel, site, location and destination endpoints | High | 2 days | I04, I08 |
| I10 | Add inventory read views and damaged state | High | 3 days | I01 |
| I11 | Implement inventory and balance endpoints | High | 3 days | I04, I10 |
| I12 | Add reservation lifecycle fields and read view | High | 2 days | I01 |
| I13 | Add PO acceptance lines and line-state view | High | 3 days | I01 |
| I14 | Implement PO, line, gate and reservation endpoints | High | 3 days | I12, I13 |
| I15 | Refactor appointments to many-to-many PO links | High | 3 days | I01 |
| I16 | Implement appointment endpoint and compatibility migration | High | 2 days | I15 |
| I17 | Add shipment tracking fields and shipment endpoints | High | 2-3 days | I04 |
| I18 | Add POD submission/approval and multi-shipment workflow | High | 3 days | I01, I15 |
| I19 | Add exception fields and endpoints | High | 2 days | I18 |
| I20 | Add line-level short closure and endpoint | High | 3 days | I13 |
| I21 | Add ownership-transfer events and endpoint | Medium | 2 days | I18 |
| I22 | Add invoice versioning and endpoint | Medium | 2 days | I01 |
| I23 | Implement movement transformation endpoint | High | 3 days | I04 |
| I24 | Add Sales integration sample data and lifecycle fixtures | High | 2 days | I07-I23 |
| I25 | Run contract, security, load and UAT tests | Critical | 3-5 days | I24 |
| I26 | Activate inbound commitments | Medium | 3-5 days | procurement workflow decision |
| I27 | Activate valuation posting and reconciliation | Medium | 5-8 days | finance decision |
| I28 | Activate planning reads | Low | 3-5 days | planning population workflow |

Estimated critical path through UAT-ready operational APIs: 35-45 engineering days plus business review time. With one backend/database engineer and part-time QA, plan for 7-10 calendar weeks. Two engineers can reduce elapsed time after I04 because master data, inventory and fulfilment streams can run in parallel.

## 12. Dependency graph

```text
I01 Decisions
  |
  +--> I02 Auth/schema --> I03 Change feed
  |                  \-> I04 API foundation --> I05 OpenAPI
  |
  +--> I06 Product --> I07 Product API
  +--> I08 Address --> I09 Master API
  +--> I10 Inventory --> I11 Inventory API
  +--> I12 Reservation --+
  +--> I13 PO lines ------+--> I14 PO/gate/reservation API
  +--> I15 Appointments --> I16 Appointment API
  +--> I18 POD -----------> I19 Exceptions
  +--> I20 Short close
  +--> I21 Ownership
  +--> I22 Invoice

I04 --> I17 Shipment API
I04 --> I23 Movement API

I07-I23 --> I24 Fixtures --> I25 UAT readiness

I26 Inbound, I27 Valuation and I28 Planning follow operational UAT.
```

The API foundation comes first because every domain needs the same authentication, pagination, error and sync behavior. Product, master data and inventory follow because Sales needs them to interpret PO records. Fulfilment follows PO and appointment relationship fixes.

## 13. Testing plan

| Layer | Coverage | Minimum additions |
|---|---|---:|
| Database | constraints, views, tenant isolation, workflow transitions, reversals | 35 SQL tests |
| Unit | cursor codec, decimal serialization, scope checks, DTO validation, movement transformation | 40 tests |
| API integration | every endpoint success, filters, pagination, errors, scope rejection | 60 tests |
| Contract | OpenAPI snapshot, response-schema validation, enum compatibility | 20 tests |
| Workflow | acceptance through invoice, partial paths and reversals | 12 scenarios |
| Security | invalid/revoked/expired keys, cross-tenant access, rate limits, log redaction | 15 tests |
| Performance | 100K products, 1M ledger entries, 100K POs | 10 benchmark cases |
| UAT | Sales full sync and two incremental sync cycles | 8 scripts |

Performance targets on staging-sized data:

- P95 collection response below 1 second for 100 records.
- P95 single-record response below 500 ms.
- `/changes` P95 below 500 ms for 500 changes.
- No endpoint performs an unbounded table scan.
- No response exceeds 5 MB.

Required lifecycle fixtures:

1. Fully delivered PO.
2. Partial reservation with shortage.
3. One PO with multiple shipments.
4. One appointment linked to multiple POs.
5. One POD linked to multiple shipments.
6. Damaged and rejected delivery quantities.
7. Approved line-level short closure.
8. Cancelled appointment and reservation release.
9. Reversed stock transaction.
10. Superseded product identifier and corrected PO.
11. Multiple invoice versions.
12. Cross-tenant access attempt.

## 14. Acceptance criteria

1. Sales can complete a full initial synchronization without database access.
2. Every returned record is limited to the authenticated client's company.
3. Every collection endpoint returns no more than 500 records and provides a stable next cursor.
4. Sales can resume from a change cursor without missing or duplicating a logical change.
5. Cancelled, deactivated, reversed and superseded records appear in the change feed.
6. Each marketplace identifier resolves to one item, or returns explicit not-found, inactive or ambiguous output.
7. Inventory responses expose physical, available, reserved, threshold, allocatable, in-transit and unavailable quantities using documented formulas.
8. Reservation eligibility comes from SCM's gate view.
9. A reservation cannot be created until acceptance and appointment requirements are satisfied.
10. PO line responses expose authoritative accepted, rejected, reserved, dispatched, delivered, short-closed and outstanding quantities.
11. Dispatched quantities are never reported as delivered before POD approval.
12. One appointment can link to more than one PO when approved by business owners.
13. One POD can link to more than one shipment.
14. Short-closed quantities remain separate from delivered quantities.
15. Movement responses preserve original transactions and explicit reversals.
16. Financial valuation is unavailable until the valuation reconciliation gate passes.
17. OpenAPI documents every available endpoint, filter, enum, schema and error.
18. Revoked and expired credentials fail immediately.
19. Existing SCM frontend routes and workflows pass their current test suite.
20. The Sales team completes the twelve UAT fixture scenarios against staging.

## 15. Deployment and rollback

### Deployment sequence

1. Deploy additive schemas, columns, views and indexes.
2. Backfill data and verify counts.
3. Deploy API foundation with integration endpoints disabled by configuration.
4. Create staging client credentials.
5. Enable master-data endpoints.
6. Enable inventory endpoints.
7. Enable PO and fulfilment endpoints.
8. Run Sales sync and reconciliation.
9. Enable production clients only after UAT sign-off.

### Feature flags

```text
INTEGRATION_API_ENABLED
INTEGRATION_MASTER_ENABLED
INTEGRATION_INVENTORY_ENABLED
INTEGRATION_PO_ENABLED
INTEGRATION_FULFILMENT_ENABLED
INTEGRATION_MOVEMENT_ENABLED
INTEGRATION_FINANCE_ENABLED
```

### Rollback

- Disable affected feature flag first.
- Revoke the integration credential if access control is involved.
- Roll back application code while retaining additive tables and columns.
- Do not drop backfilled data during an incident.
- For relationship migrations, keep compatibility columns until one full release after cutover.
- Reverse workflow postings through new ledger entries; never edit or delete posted ledger entries.

## 16. Files to change or add

| Path | Planned change |
|---|---|
| `apps/api/package.json` | Add Swagger, rate-limit and API test dependencies. |
| `apps/api/src/main.ts` | URI versioning, Swagger and integration error handling. |
| `apps/api/src/app.module.ts` | Register the integration module. |
| `apps/api/src/auth.ts` | Keep user auth; integration auth remains in a separate guard. |
| `apps/api/src/integration/*` | New read-only integration implementation. |
| `apps/api/src/integration/**/*.spec.ts` | Unit and API tests. |
| `supabase/migrations/<timestamp>_sales_integration_foundation.sql` | Integration schema, clients, audit and change feed. |
| `supabase/migrations/<timestamp>_sales_product_master.sql` | Product and identifier fields. |
| `supabase/migrations/<timestamp>_sales_inventory_views.sql` | Inventory read models and damaged state. |
| `supabase/migrations/<timestamp>_sales_po_line_state.sql` | Acceptance lines and PO-line read state. |
| `supabase/migrations/<timestamp>_multi_po_appointments.sql` | Appointment links and scheduling fields. |
| `supabase/migrations/<timestamp>_pod_approval.sql` | POD states, approval and multi-shipment workflow. |
| `supabase/migrations/<timestamp>_short_close_lines.sql` | Line-level short closure. |
| `supabase/migrations/<timestamp>_ownership_and_invoice_versions.sql` | Ownership events and invoice versioning. |
| `supabase/tests/sales_integration_contract.sql` | Database contract tests. |
| `supabase/tests/sales_integration_workflow.sql` | Full lifecycle and reversal tests. |
| `docs/openapi/scm-sales-v1.json` | Generated contract snapshot. |
| `docs/integration/business-rules.md` | Quantity and lifecycle definitions. |
| `docs/integration/synchronization.md` | Snapshot, cursor and correction rules. |
| `docs/integration/uat-guide.md` | Credentials, fixtures and UAT scripts. |

## 17. What must remain unchanged

- Append-only inventory ledger and reversal approach.
- Stable SCM UUIDs.
- Independent acceptance and appointment gates.
- Reservation only after gates pass.
- Multiple shipments and partial dispatches.
- POD-confirmed delivery distinction.
- Tenant isolation.
- Current SCM frontend routes until consumers are migrated.

## 18. Out of scope for the initial UAT API

- Sales writing POs, reservations, shipments or inventory into SCM.
- Direct Sales database access.
- Marketplace sales ingestion inside SCM.
- Advertising, targets, budgets and marketplace analytics.
- Real-time webhooks before polling is proven.
- Authoritative valuation before finance posting is active.
- SCM forecasting endpoints before planning data is populated.
- Production host selection and production credential exchange.

## 19. Definition of done

The integration is ready when:

1. All approval-gate decisions are signed off and recorded in business-rule documentation.
2. Operational endpoints through inventory movements are deployed to staging.
3. OpenAPI and sample responses are published.
4. Sales has a scoped staging credential delivered through a secure channel.
5. Full sync and incremental sync pass with no cross-tenant leakage.
6. All twelve lifecycle fixtures reconcile between SCM and Sales.
7. Existing SCM tests, new integration tests and performance gates pass.
8. The API availability matrix marks each endpoint accurately as available, planned or unsupported.
9. UAT sign-off identifies the exact API version and OpenAPI checksum.

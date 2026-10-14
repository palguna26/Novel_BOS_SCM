# Sales Module Integration Plan

## Decision

Sales and SCM remain separate applications through UAT. Sales reads SCM-owned data only through a versioned SCM backend API. Sales must not connect to the SCM database.

SCM v2 is the integration baseline. The existing `/api/masters`, `/api/inventory`, `/api/inventory/transactions`, and `/api/pos` routes are internal UI routes. They are not the Sales integration contract.

## Code-level availability audit

Status meanings:

- **Supported**: SCM v2 stores the main data and implements the workflow.
- **Partial**: useful data exists, but fields, relationships, rules, or workflow are incomplete.
- **Schema only**: tables exist, but no active backend workflow or integration endpoint was found.
- **Missing**: SCM does not currently model the requested capability.

| Requirement area | SCM status | Main gaps before Sales integration |
|---|---|---|
| Product master | Partial | No product description or subcategory. Product timestamps exist. Lead time, MOQ, order multiple, lifecycle and base UOM exist. |
| Marketplace SKU mapping | Partial | Generic identifiers exist, but identifier types do not distinguish ASIN, Amazon seller SKU, Flipkart SKU and Meesho product/SKU. No mapping confidence or ambiguity state. |
| UOM and pack conversion | Supported | Generic UOM conversion exists. Agree how carton/pack quantity is represented. |
| Channel master | Supported | Needs a dedicated read API and sync fields. |
| Warehouse and location master | Partial | Sites, locations, virtual locations and timezone exist. Site master has only city/state/country; a full structured site address is missing. |
| Destination and fulfilment-centre mapping | Partial | Destination key, name, FC code and source mapping exist. A reusable structured destination address is missing. PO snapshots contain some address fields. |
| Inventory summary | Partial | Physical, reserved/blocked, released, threshold, allocatable and in-transit data exist. Location-level and stock-state detail require a separate response/view. Last movement and snapshot timestamps are missing from the summary. |
| Damaged, rejected and quarantine stock | Supported in ledger | Stock states exist. They are not separated in the current inventory summary API. |
| Batch/lot inventory | Supported | Batch data exists. The integration endpoint must join balances to batches. |
| Reservation and allocation | Supported | Reservation lines and batch/location allocations exist. API calculations and cancellation/release timestamps need completion. |
| PO headers and lines | Partial | Core PO data exists. PO lines do not store line-level accepted/declined quantity, line status or updated timestamp. Delivered/dispatched/reserved totals are currently calculated. |
| Acceptance and operational gates | Partial | Header acceptance and acceptance/appointment gate view exist. Line-level acceptance/rejection and explicit hold reason/planning eligibility fields are missing. |
| Appointments | Partial with conflict | Current schema allows one active appointment per PO and each appointment belongs to one PO. The requirement allows one appointment to cover multiple POs. Start/end windows and confirmation details are also missing. |
| Shipments and dispatch | Supported | Multiple shipments per PO, partial quantities, events, transporter, vehicle, LR document and ETA exist. A plain tracking reference field should be confirmed or added. |
| POD and delivery | Partial | POD-confirmed delivery and multi-shipment link storage exist. The current backend POD flow accepts one selected shipment at a time. Separate verification/approval status is missing. |
| Delivery exceptions | Partial | Exceptions and resolution exist. Item is reached through the POD line rather than stored directly. No general updated timestamp. |
| Short closure | Partial with conflict | Current short close is PO-level and immediately approved by an approver. The request needs PO-line quantities and a clear approval lifecycle. |
| Invoices | Supported | One invoice per PO is enforced. Confirm whether Sales expects multiple invoices or credit/debit adjustments. |
| Inventory movement ledger | Supported | Append-only transactions, entries and reversals exist. The API must group ledger legs into source/destination movements. |
| Demand and forecasts | Schema only | Demand observations, forecasts and MRP suggestions exist, but no active backend endpoints or population workflow were found. Sales owns marketplace forecasting, so these can be deferred unless SCM planning data is required. |
| Open inbound procurement | Schema only | Procurement PO, ASN and receipt tables exist, but no active backend endpoint or workflow was found. Expected inbound quantity/date cannot yet be promised. |
| Inventory valuation | Schema only | `finance.valuation_ledger` exists, but no workflow that posts valuation entries and no API were found. Do not promise authoritative values yet. |
| API versioning and OpenAPI | Missing | No versioned integration routes or Swagger/OpenAPI setup. |
| Service authentication | Missing | Current routes use signed-in Supabase user tokens. A read-only Sales service identity and scope are needed. |
| Pagination, filtering and incremental sync | Missing | Current UI routes load full company datasets. No cursor, `updated_after`, tombstone or correction contract. |
| Webhooks/change events | Partial foundation | An outbox table exists, but no Sales webhook delivery contract or implementation was found. Start with polling. |
| Rate limits and structured errors | Missing | No integration-wide throttling, error envelope or published limits. |

## Business decisions required before freezing the contract

1. **Available stock definition**
   
   Current SCM uses `released` stock as usable stock and calculates `allocatable = max(released - threshold, 0)`. Physical stock also includes unavailable states such as quarantine or rejected stock. Therefore, `available = physical - blocked` is not always correct. Use:
   
   - `physical`: all warehouse-held, non-scrap stock
   - `reserved`: stock state `RESERVED`
   - `available`: stock state `RELEASED`
   - `allocatable`: `max(available - threshold, 0)`
   - unavailable states returned separately

2. **Appointments covering multiple POs**
   
   Decide whether this is required. If yes, replace the direct appointment-to-PO design with an appointment header plus an appointment-to-PO link table.

3. **Line-level PO acceptance**
   
   Decide whether a marketplace can accept or reject individual lines or partial quantities. If yes, add acceptance decision lines.

4. **Line-level short closure**
   
   Add short-close lines linked to PO lines if the approved quantity can differ by SKU.

5. **POD approval**
   
   Decide whether document upload, operational confirmation and approval are separate states. Current SCM confirms the POD during recording.

6. **Ownership transfer**
   
   Current inventory moves from in-transit to a virtual customer location on POD confirmation. Confirm whether this timestamp is also the legal ownership-transfer timestamp. If not, add a separate event.

7. **Financial access**
   
   Define which Sales service role can read unit cost and valuation. Keep valuation in a separate permission scope.

8. **One invoice per PO**
   
   Confirm whether partial invoices, revised invoices, credit notes or debit notes are in scope.

## Target API contract

Base path: `/api/v1/integration`

Initial endpoints:

- `GET /products`
- `GET /products/{itemId}`
- `GET /product-identifiers`
- `GET /channels`
- `GET /sites`
- `GET /locations`
- `GET /destinations`
- `GET /inventory`
- `GET /inventory/balances`
- `GET /purchase-orders`
- `GET /purchase-orders/{poId}`
- `GET /purchase-order-lines`
- `GET /po-gates`
- `GET /appointments`
- `GET /reservations`
- `GET /shipments`
- `GET /shipment-events`
- `GET /pods`
- `GET /delivery-exceptions`
- `GET /short-closures`
- `GET /inventory-movements`
- `GET /invoices`
- `GET /valuations` under a separate financial scope when valuation is ready

Every collection endpoint must support:

- tenant scope derived from the service identity
- cursor pagination
- `updated_after` or an equivalent cursor
- relevant entity filters
- stable UUIDs
- ISO 8601 timestamps with timezone
- decimal quantities and money serialized as strings
- active, cancelled, reversed and superseded records
- a common error response and request ID

Use polling for UAT. Add webhooks only after the polling contract is stable.

## Delivery phases

### Phase 0: Contract and SCM gap decisions

- Resolve the eight business decisions above.
- Define status enums, quantity formulas, nullability and correction rules.
- Add OpenAPI support, API versioning and a read-only Sales service role.
- Define pagination, sync cursor, error envelope and compatibility policy.
- Prepare an API availability matrix that can be sent to the Sales team.

Exit condition: both teams approve the OpenAPI contract and business definitions.

### Phase 1: Product and master data

- Complete product fields and marketplace identifier types.
- Add product, identifier, channel, site, location and destination endpoints.
- Include inactive records and incremental changes.
- Add unmapped and ambiguous mapping responses.

Exit condition: Sales can resolve each marketplace identifier to one stable SCM item UUID or receive a clear mapping error.

### Phase 2: Inventory

- Create authoritative site and location inventory read models.
- Return physical, reserved, available, threshold, allocatable, in-transit and unavailable states.
- Include batch, last movement and snapshot timestamps.
- Add inventory and balance endpoints with filters.

Exit condition: Sales reconciles sample inventory without mixing marketplace observations with SCM stock.

### Phase 3: POs, gates, appointments and reservations

- Add PO header, line and gate endpoints.
- Add authoritative calculated quantities and outstanding formulas.
- Implement chosen line acceptance, appointment relationship and short-close changes.
- Add appointment, reservation and allocation endpoints.

Exit condition: Sales can reproduce the SCM PO tracker without rebuilding SCM gate rules.

### Phase 4: Shipments, POD and exceptions

- Add shipment, line, event, POD, exception and short-close endpoints.
- Complete multi-shipment POD behavior in the backend.
- Expose document references as authorized signed URLs or document metadata.
- Confirm delivery and ownership-transfer rules.

Exit condition: one complete PO lifecycle matches between SCM and Sales, including partial dispatch, damage, rejection and short closure.

### Phase 5: Movements, inbound and finance

- Add movement/reversal endpoints.
- Activate and expose procurement inbound commitments if required.
- Implement valuation posting before exposing valuation endpoints.
- Expose SCM planning data only if it is populated and approved for Sales consumption.

Exit condition: movement reconciliation and authorized valuation totals match SCM reports.

### Phase 6: UAT readiness

- Publish OpenAPI documentation and staging base URL.
- Issue read-only test credentials through a secure channel.
- Load representative product mappings and complete PO lifecycle data.
- Test pagination, incremental sync, corrections, cancellations and reversals.
- Publish rate limits, timeout rules, data freshness and backward compatibility policy.

## Tests required

- Product resolution for Amazon ASIN, seller SKU, Flipkart SKU and Meesho identifier.
- Unmapped, inactive and duplicate product mapping cases.
- Inventory with released, reserved, threshold, quarantine, rejected and in-transit quantities.
- Acceptance before appointment and appointment before acceptance.
- Reservation created only when both gates are complete.
- Partial reservation and shortage.
- Multiple shipments for one PO and partial dispatch.
- POD-confirmed delivery, damage, rejection and short quantity.
- One POD covering multiple shipments if approved.
- Short closure remains different from full delivery.
- Reversal appears as a new movement and is picked up by incremental sync.
- Deactivated master records and historical corrections reach Sales.

## What can be promised now

SCM v2 can be confirmed as the long-term baseline. Product, inventory, PO, gate, reservation, shipment, POD, exception, invoice and movement data mostly exist in the SCM domain model.

The current APIs should not be shared as the final Sales contract. The integration layer, several SCM fields and the business decisions listed above must be completed first. Valuation, inbound procurement and SCM planning outputs should be marked **planned**, not **available**, until their workflows are active and tested.

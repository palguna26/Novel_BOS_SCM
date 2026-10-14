# SCM to Sales Integration API Specification

**Version:** 1.0  
**Status:** Development/UAT contract  
**Owner:** SCM backend  
**Consumer:** Sales Module  
**Base path:** `/api/v1/integration`  
**Transport:** HTTPS and JSON

## 1. Purpose

The Sales Module remains a separate application. It reads SCM operational data through this API. SCM remains the source of truth for product master data, inventory, purchase orders, fulfilment, delivery and financial records.

The Sales Module must not read the SCM database directly and must not write SCM records through this read API.

Any future write requirement must use a separately approved SCM business API.

## 2. Authentication and tenant scope

Every request except documentation access requires:

```http
Authorization: Bearer <sales-integration-token>
Accept: application/json
```

The token is issued for one company/tenant. The company is taken from the credential and must not be supplied by the caller as a trusted query parameter.

Supported credential types:

- UAT environment token configured by SCM deployment.
- Credential issued from `integration.clients` with a hashed secret, scopes, expiry and revocation state.

Initial read scopes:

| Scope | Data |
|---|---|
| `master:read` | Products, marketplace mappings, channels, sites and locations |
| `inventory:read` | Availability, balances, reservations and allocations |
| `po:read` | Purchase orders, PO lines, gates, short closures and invoices |
| `fulfilment:read` | Appointments, shipments, PODs, exceptions and ownership transfers |
| `movement:read` | Inventory transactions and ledger entries |
| `finance:read` | Approved valuation ledger data |
| `planning:read` | Forecasts and inbound commitments |

## 3. Common response format

List endpoints return:

```json
{
  "data": [],
  "page": {
    "limit": 100,
    "hasMore": false,
    "nextCursor": null
  },
  "meta": {
    "requestId": "uuid",
    "asOf": "2026-10-12T10:00:00Z"
  }
}
```

Single-record endpoints return:

```json
{
  "data": {},
  "meta": {
    "requestId": "uuid",
    "asOf": "2026-10-12T10:00:00Z"
  }
}
```

All quantities and monetary values must be treated as decimal strings. This prevents rounding differences between SCM and Sales.

## 4. Errors

```json
{
  "error": {
    "code": "INVALID_FILTER",
    "message": "limit must be an integer between 1 and 500",
    "requestId": "uuid"
  }
}
```

Expected status codes:

| Status | Meaning |
|---|---|
| `200` | Request completed |
| `400` | Invalid filter or request format |
| `401` | Missing or invalid credential |
| `403` | Credential lacks the required scope |
| `404` | Requested record does not exist in the tenant |
| `429` | Rate limit exceeded |
| `500` | Unexpected SCM/API failure |

## 5. Common query parameters

List endpoints accept the parameters that apply to their data domain:

| Parameter | Type | Description |
|---|---|---|
| `limit` | integer | Page size, from 1 to 500. Default 100. |
| `cursor` | string | Opaque cursor returned by the previous response. |
| `updatedAfter` | ISO timestamp | Return records updated after this time. |
| `active` | boolean | Filter active/inactive master records. |
| `status` | string | Domain status filter. |
| `stockStatus` | string | Inventory stock state, such as `RELEASED`, `RESERVED`, `QUARANTINE` or `DAMAGED`. |
| `channelId` | UUID | Marketplace/channel filter. |
| `siteId` | UUID | Warehouse/site filter. |
| `locationId` | UUID | Location filter. |
| `itemId` | UUID | SCM item filter. |
| `purchaseOrderId` | UUID | PO filter. |
| `shipmentId` | UUID | Shipment filter. |
| `identifierType` | string | Marketplace or barcode identifier type. |
| `value` | string | Identifier value. |
| `from` | ISO timestamp | Inclusive start of a date range. |
| `to` | ISO timestamp | Exclusive end of a date range. |

The Sales Module must store and reuse `nextCursor`. It must not construct or decode cursor values itself.

## 6. Endpoint contract

All paths below are relative to `/api/v1/integration`.

### 6.1 Health

#### `GET /health`

Required scope: authentication only.

Returns API version, tenant and server timestamp.

### 6.2 Product and SKU master

#### `GET /products`

Required scope: `master:read`.

Returns product master records with:

- SCM item UUID
- Internal item code, name, description and brand
- Category, subcategory, variant and lifecycle status
- Base UOM
- Lead time, production lead time and minimum order quantity
- Pack/carton quantity and order multiple
- Marketplace identifiers
- UOM conversions
- Creation and update timestamps

#### `GET /products/{id}`

Required scope: `master:read`.

Returns one product by stable SCM item UUID.

#### `GET /product-identifiers`

Required scope: `master:read`.

Returns marketplace and barcode mappings, including:

- Identifier UUID
- SCM item UUID
- Channel UUID
- Identifier type and value
- Mapping status
- Active and validity dates
- Update timestamp

Supported identifier types include `AMAZON_ASIN`, `AMAZON_SELLER_SKU`, `FLIPKART_PRODUCT_ID`, `FLIPKART_SKU`, `MEESHO_PRODUCT_ID`, `MEESHO_SKU`, `EAN`, `GTIN`, `UPC`, `BARCODE`, `CHANNEL_SKU` and `LEGACY`.

#### `GET /product-identifiers/resolve`

Required scope: `master:read`.

Required parameters: `identifierType` and `value`.

Returns the matching SCM product. No match returns `404`. More than one match returns `400` with code `PRODUCT_MAPPING_AMBIGUOUS`.

### 6.3 Channel and warehouse masters

#### `GET /channels`

Required scope: `master:read`.

Returns company-scoped channel UUID, code, name, channel type, ingestion method, active state and timestamps.

#### `GET /sites`

Required scope: `master:read`.

Returns warehouse/site UUID, code, name, address, timezone and active state.

#### `GET /locations`

Required scope: `master:read`.

Returns physical, virtual and transit locations with site relationship, location type, code, name and active state.

#### `GET /destinations`

Required scope: `master:read`.

Returns marketplace/fulfilment destination mappings, including destination key, name, FC code, source site, source location, address, timezone and active state.

### 6.4 Inventory

#### `GET /inventory`

Required scope: `inventory:read`.

Returns SKU/site inventory availability with:

- Company ID, site ID, SCM item ID and UOM
- Physical quantity
- Available quantity
- Reserved/blocked quantity
- Threshold quantity
- Allocatable quantity
- In-transit, quarantine, on-hold, rejected and scrap quantities
- Last movement timestamp
- Snapshot timestamp

Authoritative definitions:

```text
Physical = warehouse-held non-scrap stock excluding transit and external locations
Blocked = RESERVED stock
Available = Physical - Blocked
Allocatable = max(Physical - Blocked - Threshold, 0)
In-transit = transit-location stock or IN_TRANSIT stock state
```

Marketplace-reported inventory must remain separate from this SCM warehouse inventory.

#### `GET /inventory/balances`

Required scope: `inventory:read`.

Returns location, batch and stock-state balances. Supports `siteId`, `locationId`, `itemId` and `stockStatus` filters.

### 6.5 Purchase orders and gates

#### `GET /purchase-orders`

Required scope: `po:read`.

Returns PO headers with nested PO lines, authoritative line state and operational gate state.

Header data includes PO UUID, company, channel, external PO number, PO date, deadline, destination, source site, currency, total value, status and timestamps.

#### `GET /purchase-orders/{id}`

Required scope: `po:read`.

Returns one complete PO by SCM UUID.

#### `GET /purchase-order-lines`

Required scope: `po:read`.

Returns authoritative line quantities:

- Ordered quantity
- Accepted quantity
- Rejected quantity
- Reserved quantity
- Dispatched quantity
- Delivered quantity
- Damaged and rejected delivery quantities
- Approved short-close quantity
- Outstanding quantity
- UOM and item UUID

#### `GET /po-gates`

Required scope: `po:read`.

Returns acceptance and appointment gate state. The Sales Module must use this endpoint instead of deriving acceptance from generic PO status.

Gate data includes acceptance completion, appointment completion, reservation eligibility, acceptance timestamp, appointment reference and related status information.

### 6.6 Reservations and fulfilment

#### `GET /reservations`

Required scope: `inventory:read`.

Returns reservations, reservation lines and allocations with requested, reserved, allocated, shortage, source location, status, creation, cancellation and release information.

Reservation eligibility is controlled by SCM. The Sales Module must not recreate the acceptance and appointment gate logic.

#### `GET /appointments`

Required scope: `fulfilment:read`.

Returns appointment UUID, external number, linked PO UUIDs, destination, scheduled time window, status, match status, confirmation, reschedule/cancellation data and documents.

An appointment may be linked to multiple POs through the relationship returned in `purchaseOrderIds`.

#### `GET /shipments`

Required scope: `fulfilment:read`.

Returns shipment header, line and event data, including source, destination, planned/actual dispatch, vehicle, transporter, tracking/LR reference, status, expected delivery and SKU quantities.

One PO may have multiple shipments and a shipment may contain multiple SKUs.

#### `GET /pods`

Required scope: `fulfilment:read`.

Returns POD records, linked shipment IDs, POD lines, delivered/short/damaged/rejected quantities, approval status and document references.

Only POD-confirmed quantities count as delivered. Dispatched quantity must not be treated as delivered.

#### `GET /delivery-exceptions`

Required scope: `fulfilment:read`.

Returns exception ID, PO/shipment/POD references, affected item and line, exception type, quantities, status, reason, resolution and timestamps.

#### `GET /short-closures`

Required scope: `po:read`.

Returns approved short-close decisions and line-level approved quantities. Short-closed quantity is separate from delivered quantity.

#### `GET /ownership-transfers`

Required scope: `fulfilment:read`.

Returns ownership transfer events created from approved POD/customer receipt or another approved SCM basis.

### 6.7 Financial and planning data

#### `GET /invoices`

Required scope: `po:read`.

Returns invoice ID, linked PO, invoice number/date, amount, currency, status, document reference, invoice type and versioning fields.

#### `GET /valuations`

Required scope: `finance:read`.

Returns approved valuation ledger records, including item/site, valuation date, currency, unit cost and total value movement.

#### `GET /forecasts`

Required scope: `planning:read`.

Returns authorized SCM forecast records. Sales remains responsible for marketplace demand calculations.

#### `GET /inbound-commitments`

Required scope: `planning:read`.

Returns procurement commitments, expected quantities, receipt information and goods receipts where available.

### 6.8 Movement history and synchronization

#### `GET /inventory-movements`

Required scope: `movement:read`.

Returns append-only stock transactions and ledger entries with item, site, location, movement type, quantity delta, UOM, value, posting time and related references.

Corrections and reversals are new ledger entries. Existing entries are not edited or deleted by Sales.

#### `GET /changes`

Required: any read scope.

Returns durable change records with sequence ID, entity type, entity UUID, operation, version, timestamp and synchronization payload.

Use the `sequence_id` cursor to resume incremental synchronization.

Supported operations include `CREATED`, `UPDATED`, `DEACTIVATED`, `CANCELLED`, `REVERSED` and `SUPERSEDED`.

Recommended synchronization:

1. Perform an initial full sync by domain.
2. Store the returned change-feed cursor.
3. Poll `/changes` using that cursor.
4. Upsert created and updated records.
5. Mark cancelled, reversed, deactivated and superseded records according to the operation.
6. Advance the cursor only after the page is committed successfully.

## 7. Data ownership rules

SCM owns:

- Product and SKU master data
- Warehouse and location masters
- Warehouse stock and stock movements
- Reservations and allocations
- PO acceptance and appointment gates
- Shipments, PODs and delivery exceptions
- Short closures, invoices and approved valuations

Sales owns:

- Marketplace ingestion
- Marketplace observations
- Sales analytics and SKU performance
- Advertising, targets and budgets
- Demand analysis and replenishment recommendations
- Sales dashboards and reporting

Sales recommendations remain read-only planning outputs unless a separate write API is approved.

## 8. Operational requirements

- Use stable UUIDs as record identity.
- Use ISO 8601 timestamps with timezone.
- Treat all cursors as opaque.
- Do not double-count marketplace inventory and SCM warehouse inventory.
- Do not treat dispatched quantity as delivered quantity.
- Do not treat short-closed quantity as delivered quantity.
- Do not write directly to SCM tables.
- Do not send production credentials by email.

## 9. UAT test scenarios

The Sales Module should test:

1. Product mapping for Amazon, Flipkart and Meesho identifiers.
2. Unmapped and ambiguous identifier resolution.
3. Warehouse availability, reservation and threshold calculations.
4. Acceptance pending, appointment pending and reservation eligibility gates.
5. One PO with multiple shipments and partial dispatch.
6. POD delivery with shortage, damage and rejection quantities.
7. Approved short closure without reporting full delivery.
8. Inventory cancellation, correction and reversal through the change feed.
9. Tenant isolation and scope rejection.
10. Cursor resume after interrupted synchronization.


Subject: SCM–Sales Integration API: Implementation Status and UAT Plan

Hi Akanksh,

Attachment: `11-sales-integration-api-spec.md`

Thank you for sharing the consolidated Sales Module integration requirements.

I have attached the detailed **SCM-Sales Integration API Specification** for development use. Please start building the Sales Module integration against this specification.

We have aligned the integration architecture as follows:

- SCM and Sales will remain independent applications through UAT.
- SCM will remain the source of truth for product master, inventory, reservations, purchase orders, gates, appointments, shipments, POD, exceptions, short closure, movements and approved financial data.
- Sales will consume SCM operational data through read-only SCM backend APIs.
- Sales will not connect directly to the SCM database.
- Any future Sales-to-SCM write operation will use a separately authorized SCM business API.
- SCM v2 is the long-term integration baseline.

We have prepared a versioned integration API under:

```text
/api/v1/integration
```

The current API surface covers:

- Product master and product lookup by SCM item UUID.
- Marketplace identifier mapping and identifier resolution.
- Channels, sites, warehouses, locations and destinations.
- Inventory availability and location/stock-state balances.
- Purchase orders, PO lines and operational gate state.
- Reservations and allocations.
- Appointments.
- Shipments, shipment lines and shipment events.
- PODs, delivery quantities and linked shipments.
- Delivery exceptions.
- Short closures.
- Invoices.
- Inventory movements and reversals.
- Ownership-transfer events.
- SCM forecasts, inbound commitments and valuation data where those SCM workflows are populated and authorized.
- Incremental changes through a change-feed endpoint.

The API includes tenant scoping, read-only permissions, scoped Sales credentials, cursor pagination, filters, incremental synchronization support, stable SCM UUIDs, decimal-safe quantities and monetary values, ISO 8601 timestamps, structured error responses, request IDs, rate limiting and request auditing.

The following SCM changes have been added to support the integration contract:

- Product description, subcategory, pack/carton quantities and production lead time fields.
- Explicit marketplace identifier types for Amazon, Flipkart and Meesho.
- Structured warehouse and destination address fields.
- Authoritative inventory availability views with physical, available, reserved, threshold, allocatable, in-transit and unavailable quantities.
- Reservation lifecycle fields and allocation details.
- PO line state calculations for accepted, rejected, reserved, dispatched, delivered, short-closed and outstanding quantities.
- Acceptance decision lines.
- Appointment-to-PO relationship support.
- Appointment scheduling and confirmation fields.
- POD approval fields and multi-shipment relationships.
- Delivery exception item and PO-line references.
- Line-level short-close records.
- Ownership-transfer events.
- Invoice types and versioning support.
- Durable change-log records for corrections, cancellations, reversals, deactivations and superseded records.

The agreed quantity definitions are:

- Physical stock: warehouse-held, non-scrap stock excluding transit and external locations.
- Available stock: physical stock minus blocked/reserved stock.
- Reserved stock: stock in the reserved state.
- Allocatable stock: `max(physical stock - blocked stock - threshold stock, 0)`.
- In-transit stock: stock in transit locations or with the in-transit state.
- Delivered quantity: only POD-confirmed quantity. Dispatched quantity is not treated as delivered.
- Short-closed quantity: reported separately and never treated as delivered.
- Inventory corrections and reversals: represented as new append-only movement records.

The implementation also includes OpenAPI documentation at `/api/docs` and a versioned contract snapshot for Sales review. The attached specification is the working contract for endpoint paths, authentication, scopes, filters, response formats, quantity definitions and synchronization behavior.

Before UAT, we will complete the following deployment activities:

1. Complete the remaining Supabase PostgREST schema exposure and RLS policy configuration.
2. Deploy the backend integration API.
3. Create a staging Sales integration client with read-only scopes.
4. Send the backend base URL and test credentials through a secure channel.
5. Load representative product mappings and complete PO lifecycle fixtures.
6. Validate full synchronization, incremental synchronization, corrections, cancellations and reversals.
7. Run the agreed scenarios for partial reservation, multiple shipments, POD delivery, shortages, damages, rejections and short closure.
8. Confirm staging reconciliation between SCM and Sales before production access is considered.

The repository also includes `supabase/tests/sales_integration_validation.sql` for the staging database contract check.

The current backend build passes, and the SCM API test suite passes with 7 test suites and 55 tests, including integration credential authentication tests. The API starts successfully and Swagger exposes all 28 integration routes. The three integration migrations have been applied to the configured Supabase project, and the integration validation SQL passes.

I will send you the backend base URL as soon as the API is deployed. Until then, please use the attached API specification as the development contract and proceed with the Sales-side integration, mock adapters and synchronization logic.

Best regards,

Palguna

# Inventory Management Design

## Goal

Complete inventory management for stock operations and related master data. The feature must support stock visibility and adjustment, SKU/product management, warehouse and location management, channel mappings, units of measure, and route estimates.

## Scope

The existing Inventory page becomes a tabbed workspace with these areas:

- **Stock:** SKU totals, warehouse breakdown, low-stock status, stock adjustment, transaction history, and reversal.
- **SKUs:** create and edit product title, SKU code, item class, base UOM, lifecycle status, and active/inactive state.
- **Warehouses:** create and edit warehouse details and manage locations under each warehouse.
- **Mappings:** connect channel product codes and destinations to internal SKUs and warehouses.
- **UOMs & routes:** manage units of measure and warehouse-to-destination route estimates.

Out of scope: changes to purchase-order workflow, shipment workflow, invoice workflow, or new inventory accounting rules.

## User experience

The page loads the current company’s inventory and master data, then refreshes the affected tab after a successful save. Search and simple filters should be available for lists where useful.

Stock adjustment opens a form for SKU, warehouse, location, UOM, quantity, and reason. Stock history shows the transaction, actor, timestamp, quantity, and reversal state. Reversal requires approval access and a reason.

SKU and warehouse forms validate required fields and prevent duplicate codes. Locations belong to one warehouse and require a location type. Mappings require a channel, external product code, internal SKU, and optional destination/warehouse. UOMs and routes can be edited or deactivated while inactive records remain visible for historical context.

Successful saves show confirmation and refresh the relevant data. Validation and API errors remain visible in the form so the user can correct them.

## Backend design

Keep company scoping and permission checks in the API service. Add authenticated operations for:

- Updating SKU and warehouse details.
- Creating and updating warehouse locations.
- Creating and updating channel/product mappings.
- Creating and updating route estimates.
- Creating and updating UOM records.
- Listing stock transactions for the current company.

Use the existing stock RPCs and ledger as the source of truth for stock changes. Preserve idempotency keys for stock writes. Preserve audit events for all writes and enforce write versus approval permissions consistently with the existing service.

## Data flow

The web client requests inventory and master data through the existing authenticated API helper. Inventory writes send JSON payloads to explicit API endpoints. The API validates the payload, scopes it to the authenticated company, performs the database write or RPC call, and returns the saved record/result. The client then refreshes the affected list.

## Validation and safety

- Required fields are validated in the UI and API.
- Duplicate codes and conflicting mappings return clear errors.
- Records are deactivated instead of deleted when historical references may exist.
- Stock reversal is approval-gated and requires a reason.
- All list and write queries are company-scoped.
- Existing database constraints and ledger behavior remain authoritative.

## Verification

Add API tests for permission checks, required fields, duplicate handling, company scoping, and stock transaction listing. Add focused web tests for inventory tab actions and form submission states. Run the API test suite, web tests, and both builds.


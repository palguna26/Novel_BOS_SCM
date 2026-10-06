# Inventory Management Implementation Plan

## Completed

1. Add API endpoints for stock transaction history.
2. Add SKU and warehouse update endpoints.
3. Add warehouse location create/update endpoints.
4. Add channel SKU and destination mapping endpoints.
5. Add route and UOM create/update endpoints.
6. Extend master-data loading with item identifiers.
7. Replace the read-only Inventory view with tabs for stock, SKUs, warehouses, mappings, UOMs, and routes.
8. Add forms for stock adjustment, SKU/product title, warehouse, location, mapping, UOM, and route creation.
9. Add stock totals, warehouse-level rows, search, low-stock indication, and transaction history display.
10. Refresh inventory and master data after successful writes.

## Validation

- Frontend production build: passed.
- Backend production build: passed.
- Backend test command was blocked by the local shell not exposing the Node/npm executable; rerun `npm test` in a normal Node-enabled shell.

## Follow-up

- Add reversal controls directly to the transaction history panel.
- Add edit/deactivate controls for mappings, locations, UOMs, and routes.
- Add focused API and web tests for the new forms and permission paths.


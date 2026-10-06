# SCM Database Clean Rebuild Design

## Decision

Use a clean, namespaced PostgreSQL model while leaving the current public schema untouched until cutover. The stock ledger is the quantity source of truth. Compatibility views preserve current read field names.

## Required workflow

PO acceptance and appointment matching are independent gates. Either can happen first. Reservation is attempted only after both are complete, and one active reservation is allowed. Shipment planning follows reservation. Dispatch moves stock to transit. POD moves confirmed stock to delivered. Differences stay open until resolved or short-closed. Invoice is allowed only after full delivery or approved short close.

## Main design choices

- Separate schemas define clear ownership.
- Company ID is carried on operational rows for security and support.
- Quantities use numeric(18,6).
- Documents are immutable, versioned records.
- Acceptance and appointments retain history.
- Inventory balances are derived from paired ledger entries.
- Reservations retain line and batch allocations.
- Shipments retain the exact reservation allocations dispatched.
- POD can link to several shipments.
- Corrections create reversals or replacement versions.
- Workflow writes are atomic and idempotent.
- Current public tables remain in place until controlled cutover.

## Failure handling

Any failed transaction rolls back all of its status, quantity, audit and idempotency changes. Duplicate completed requests return the stored result. Integration and notification failures keep retry history and may move to a dead-letter status.

## Validation

Validate DDL on a fresh PostgreSQL database, run integrity queries, exercise both gate orders, repeat every stock-changing request, reconcile ledger balances, build the API and web applications, and complete a controlled data comparison before switching traffic.

The full table map, controls and cutover rules are maintained in the root DATABASE_SCHEMA.md file.

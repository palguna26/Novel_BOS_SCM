# SCM v2 Channel Workflow Cutover Implementation Plan

## Goal

Move the running channel SCM application from the legacy `public` tables to the namespaced v2 model, complete the documented workflow, and prove it with automated tests and a controlled cutover.

## Work sequence

### 1. API foundations

- Add explicit v2 schema configuration and company context.
- Read authenticated profiles and company access from `iam`.
- Add helpers for `compat` reads and namespaced RPC calls.
- Add request idempotency-key handling.
- Add stable API error mapping.

### 2. Document ingestion

- Split extraction into platform adapters.
- Normalize Amazon/RK World, Flipkart and Blinkit PO fields.
- Normalize appointment documents.
- Return header fields, line fields, confidence and warnings.
- Persist immutable file and document version metadata in v2.
- Add duplicate-hash handling and extraction tests using supplied formats.

### 3. PO and gate cutover

- Rebuild PO reads from v2 query/compat views.
- Create reviewed POs through `scm.create_purchase_order`.
- Record acceptance and rejection through `scm.record_acceptance`.
- Record or replace appointments through `scm.record_appointment`.
- Expose gate state, reservation result and shortage details.
- Verify acceptance-first and appointment-first behavior.

### 4. Inventory and shipment cutover

- Read inventory from ledger-derived v2 views.
- Add controlled stock-addition and reversal operations.
- Create shipments through `scm.create_shipment`.
- Dispatch through `scm.dispatch_shipment`.
- Add shipment event creation and timeline reads.
- Enforce planned, reserved and dispatched quantity limits.

### 5. POD, exceptions and invoice

- Register immutable POD document versions.
- Confirm POD through `scm.record_pod`.
- Expose delivery exceptions and resolution state.
- Approve short close through `scm.short_close_purchase_order`.
- Upload invoices through `scm.upload_invoice`.
- Add notification outbox status and retry endpoints.

### 6. Web workflow

- Add a typed API client and shared domain types.
- Replace the single-file application with route-level modules.
- Add actionable dashboard filters and queues.
- Complete document review, gate, shipment, POD, exception and invoice forms.
- Apply role-aware actions while keeping server-side enforcement authoritative.
- Preserve the approved industrial command-centre design and responsive layout.

### 7. Seed, migration and cutover

- Add an idempotent v2 demo seed with all roles and workflow states.
- Add migration checks for exposed schemas and grants.
- Add old-to-v2 reconciliation queries.
- Document the feature switch, rollout and rollback procedure.

### 8. Verification

- API unit tests for permissions, input mapping, errors and idempotency keys.
- Document tests for all supplied channel formats.
- SQL structural, workflow, ledger, retry and concurrency tests.
- Web component and role-visibility tests.
- Full build and end-to-end PO-to-invoice test.

## Completion rule

The cutover stage is complete only when both gate orders converge on one reservation, ledger totals reconcile, role checks pass, the full PO-to-invoice flow works against a fresh v2 database, and every acceptance criterion for the channel workflow has direct evidence.


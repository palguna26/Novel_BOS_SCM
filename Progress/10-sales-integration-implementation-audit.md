# Sales Integration Implementation Audit

Audit date: 2026-10-12

## Verified complete in the worktree

- Read-only integration controller at `/api/v1/integration`.
- Tenant-scoped authentication using a UAT environment credential or `integration.clients` credential.
- Read scopes for master, inventory, PO, fulfilment, movement, finance and planning data.
- Cursor pagination envelope and structured integration error responses.
- 300 requests/minute in-process rate limit per client.
- Request IDs and request audit writes.
- Swagger UI at `/api/docs` and a committed OpenAPI snapshot.
- Product, identifier, identifier resolution, channel, site, location and destination routes.
- Inventory availability and balance routes.
- PO, PO-line state, gate and reservation routes.
- Appointment, shipment, POD, exception, short-close, invoice and ownership-transfer routes.
- Inventory movement and durable change-feed routes.
- Valuation, forecast and inbound commitment routes with separate scopes.
- Additive migrations for integration credentials, change log, inventory availability, product fields, identifier types, acceptance lines, appointment links, short-close lines, ownership events, POD fields and invoice versioning.
- Inventory definitions aligned with SCM rules: available = physical - blocked; allocatable = max(physical - blocked - threshold, 0).
- Common `active` and inventory `stockStatus` filters are implemented and documented.
- Existing backend build: passed.
- Backend tests: 7 suites and 55 tests passed, including integration credential authentication tests.
- Full workspace build: passed for API and web.
- OpenAPI snapshot route check: passed; all controller routes are represented, including locations and destinations.
- Detailed Markdown API specification delivered at `Progress/11-sales-integration-api-spec.md`.
- Live API startup: passed with the configured application environment.
- Live Swagger check: passed; `/api/docs` is available and `/api/docs-json` exposes all 28 integration routes.
- Supabase migration deployment: passed; all three migrations are recorded in the project migration history.
- Supabase integration validation SQL: passed with no failures.

## Not verifiable in this environment

- Exposing the `integration` schema to PostgREST so the API can query it. The database objects now exist, but PostgREST reports `Invalid schema: integration` until the schema is added to the exposed schemas.
- Resolving the Supabase security advisor finding before exposing the schema: seven new tables have RLS disabled (`integration.clients`, `integration.change_log`, `integration.request_audit`, `scm.acceptance_decision_lines`, `scm.appointment_purchase_orders`, `scm.short_close_decision_lines`, `scm.ownership_transfer_events`).
- PostgreSQL view, trigger, constraint and RLS execution.
- Live authenticated requests against staging Supabase.
- Sales full-sync and incremental-sync reconciliation.
- Performance targets against production-sized data.
- SQL migration execution after the change-log trigger fix; this must be rerun in staging because no local PostgreSQL instance is available.

The configured remote project is reachable and the migrations are applied. The remaining live API gate is PostgREST schema exposure plus the approved RLS policy decision.

## Staging gate before sending production readiness confirmation

1. Start or connect to the staging Supabase project.
2. Apply migrations through `20261012124500_sales_lifecycle_backfill_triggers.sql`.
3. Run `supabase/tests/scm_v2_validation.sql`, `supabase/tests/scm_v2_workflow_smoke.sql`, and `supabase/tests/sales_integration_validation.sql`.
4. Start the API with `SALES_INTEGRATION_TOKEN` and `SALES_INTEGRATION_COMPANY_ID`, or create an `integration.clients` credential.
5. Call every documented endpoint with a staging credential.
6. Validate full sync, cursor resume, cancellation, reversal and tenant isolation.
7. Complete Sales UAT fixtures before production access.

## Remaining product decisions

- Staging base URL.
- Secure credential exchange channel.
- Whether Sales receives finance and planning scopes in UAT.
- Final API freshness and rate-limit values after staging load testing.

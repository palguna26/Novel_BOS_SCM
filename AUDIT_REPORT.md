# SCM Technical Flaw Audit

Date: 2026-10-14

Scope: `apps/api`, `apps/web`, `platform`, and all Supabase migrations/tests in this repository. This is a code and schema audit. I did not connect to a live Supabase project, so live RLS/storage/runtime behavior still needs confirmation.

## Fixes implemented after audit

The following fixes are now in the working tree:

- PO review quantity and unit-price fields keep the typed value while editing and only convert/validate on save. This removes the accidental `0` caused by converting an empty field on every keystroke.
- PO accept/reject actions now require approval permission in the API service and in the database RPC guard.
- Acceptance is now the reservation trigger. Appointment attachment is no longer required before stock blocking; appointment data can be added afterward.
- Appointment document matching is no longer downgraded just because warehouse resolution needs review.
- Read-only users are rejected before document storage and AI extraction.
- Integration endpoints no longer fall back to normal user sessions unless `ALLOW_USER_INTEGRATION_FALLBACK=true` is explicitly set.
- Change-feed access now requires the dedicated `changes:read` scope.
- Extraction warns when source/destination addresses are identical or contain contradictory logistics labels.
- The PO inbox now hides the accept action for users without approval permission instead of presenting an action that the API will reject.
- POD short, damaged, and rejected quantities now create ledger movements out of `IN_TRANSIT` into explicit `SCRAP`, `QUARANTINE`, and `REJECTED` states.
- Change-log entity versions are serialized per entity and protected by a unique index.
- Notification sending now atomically claims a pending notification before sending, preventing duplicate concurrent sends.
- UOM creation and editing are restricted to `SUPER_ADMIN`; company approvers can no longer change shared reference data.
- Integration audit writes are awaited and failed requests are recorded with their error status when possible.
- Critical PO, shipment, reservation, ledger, and POD child rows now reject cross-company parent relationships at the database boundary.
- Shipment planning now shows the matched route and transit time and cannot proceed without an active route for the source warehouse and destination.
- Main PO, inventory, master-data, audit, and document metadata reads now use a user-JWT-scoped Supabase client; service-role access remains for controlled storage and audited RPC paths.
- PO review warnings now require an explicit operator confirmation before the reviewed PO can be saved.

The database changes are in `supabase/migrations/202610140001_po_review_workflow_fixes.sql`. They must be applied to the UAT database before testing the new workflow. The repository still needs the larger follow-up work listed below, especially explicit source/destination warehouse entities, route/transit-time configuration, exception queues, and end-to-end workflow tests.

## Executive summary

The product is a working prototype with a serious workflow foundation, not production-grade enterprise software yet. The code builds and the current unit tests pass, but the security boundary is weaker than it looks: the API runs all database queries through a Supabase service-role client, important permissions are enforced in application code or inconsistently in SQL, and the database does not enforce tenant consistency across most foreign-key relationships.

Technical credibility: **48/100**

Product classification: **early prototype with real workflow infrastructure**.

## Findings

### F-01 — PO acceptance is not approval-gated

Severity: **Critical**

Evidence: `apps/api/src/app.service.ts:517-520` calls `this.write(user)`, not `this.approve(user)`. The SQL function `scm.record_acceptance` also checks `iam.actor_can_write` at `supabase/migrations/202610030004_scm_v2_workflows.sql:509-512`.

What happens: any user with write access can accept or reject a PO. The repository's own guide says manager/administrator permissions are needed for approval, and acceptance causes reservation logic to run.

Impact: a normal team member can approve commercial demand and trigger inventory reservation. This is a direct separation-of-duties failure.

Fix: require `actor_can_approve` in the database function and `canApprove` in the API for both acceptance and rejection. Add an integration test using a write-only team member.

### F-02 — The API uses the Supabase service-role key for every request

Severity: **Critical**

Evidence: `apps/api/src/supabase.service.ts:19-24` creates the main client with `SUPABASE_SERVICE_ROLE_KEY`. All normal reads and direct writes use that client, for example `apps/api/src/app.service.ts:277-280` and `:302-309`.

What happens: Postgres RLS is bypassed for application queries. Tenant isolation depends on every API query adding the correct `company_id` filter and every RPC validating the actor and company.

Impact: one missed filter becomes a cross-tenant data leak or write. This is especially risky as the codebase grows and has many direct table operations.

Fix: use a user-scoped Supabase client for user reads/writes, or centralize all mutations in audited RPCs and make service-role access a separate, tightly limited worker path. Add cross-company negative tests for every route.

### F-03 — Tenant consistency is not enforced by the database schema

Severity: **Critical**

Evidence: tables duplicate `company_id` but use single-column foreign keys. For example, `scm.purchase_order_lines` has `company_id` and `purchase_order_id references scm.purchase_orders(id)` at `supabase/migrations/202610030002_scm_v2_core.sql:38-57`; `scm.shipment_lines` does the same at `:325-340`; stock ledger rows similarly reference sites/items without composite company keys at `:161-177`.

What happens: the database can store a child row for company A pointing at a parent row for company B. RLS does not repair inconsistent relationships, and the service-role client bypasses RLS.

Impact: corrupted joins, incorrect inventory/workflow totals, and possible cross-tenant exposure through related records.

Fix: use composite foreign keys such as `(company_id, purchase_order_id)` to a matching unique key, or remove redundant tenant columns where safe. Add a migration that finds and rejects existing mismatches.

### F-04 — Document extraction endpoint can be used as a write path by read-only users

Severity: **High**

Evidence: `apps/api/src/document.controller.ts:13-18` calls `saveAndExtract` without checking `canWrite`. `apps/api/src/document.service.ts:37-49` stores the file and registers it. The SQL RPC does check write access at `supabase/migrations/202610040001_scm_v2_api_cutover.sql:21-24`, but the endpoint still performs storage and AI work before the database rejects it.

What happens: a read-only user can upload files, consume storage/AI quota, and create orphaned storage objects before registration fails. If a future RPC path weakens, the same endpoint becomes an actual unauthorized write path.

Fix: reject before storage/extraction when `!user.canWrite`; enforce the same rule in the RPC; add cleanup and abuse tests.

### F-05 — Integration API falls back to every normal user session

Severity: **High**

Evidence: `apps/api/src/integration/integration.guard.ts:40-45` accepts any valid SCM bearer token and assigns all `READ_SCOPES`.

What happens: when the configured static token or integration-client credential is absent or misconfigured, any signed-in user can call the sales integration API as a fully scoped integration client.

Impact: the integration contract is not actually isolated from the interactive application. A stolen ordinary user session gets broad export access.

Fix: remove the fallback outside an explicit local-development mode. Require a client credential in UAT/production and test startup failure when integration credentials are missing.

### F-06 — Integration scope checking is too broad for change-feed access

Severity: **High**

Evidence: `apps/api/src/integration/integration.service.ts:362-376` only checks whether the caller has any scope ending in `:read`, then returns the shared change log.

What happens: a client with only `master:read` can request change events for inventory, finance, fulfilment, and other domains.

Fix: map each change-log entity type to its required scope, or require a dedicated `changes:read` scope.

### F-07 — POD exception quantities do not fully leave transit inventory

Severity: **High**

Evidence: `scm.record_pod` sets `v_remaining := v_confirmed` at `supabase/migrations/202610030004_scm_v2_workflows.sql:1056`. It writes an `IN_TRANSIT -> DELIVERED` ledger movement only for confirmed quantity at `:1067-1089`, while damaged/rejected quantities are only added to shipment counters at `:1094-1097`.

What happens: damaged and rejected units can remain in the in-transit ledger even though the shipment is marked delivered or delivery-issue. The later exception rows do not themselves create a stock movement.

Impact: inventory availability and physical custody reports can be wrong after partial/failed deliveries.

Fix: post explicit ledger movements for confirmed, damaged, rejected, and short quantities, with a defined destination stock state for each. Add a reconciliation test for every POD outcome.

### F-08 — Integration change-log versions race under concurrent writes

Severity: **High**

Evidence: `integration.record_change` calculates `max(entity_version) + 1` at `supabase/migrations/20261012120000_sales_integration_foundation.sql:141-144`. There is no unique constraint on `(company_id, entity_type, entity_id, entity_version)`.

What happens: concurrent updates can assign the same version or make consumers see an ambiguous sequence.

Fix: use a per-entity counter with row locking, or derive version from the global identity sequence. Add a uniqueness constraint and a concurrency test.

### F-09 — Master-data UOMs are global but writable by any approver

Severity: **Medium**

Evidence: `apps/api/src/app.service.ts:424-442` inserts and updates `master_data.uoms` without a company filter. `masters()` reads all active UOMs at `:219`.

What happens: an approver in one company can alter a shared UOM used by every company. There is no dedicated system-admin boundary in this path.

Fix: either make UOMs immutable system reference data and restrict changes to super-admin migrations, or add company ownership and tenant filtering.

### F-10 — Notification sending is not concurrency-safe

Severity: **Medium**

Evidence: `apps/api/src/notification.service.ts:21-28` counts attempts, updates status to `SENDING`, sends email, and then writes the attempt without a transaction or row lock.

What happens: two concurrent requests can both see the same attempt count and both send the same message. The status update result is not checked.

Fix: claim the notification atomically with `UPDATE ... WHERE status IN (...) RETURNING`, or move delivery to a queue with a database lease and unique attempt key.

### F-11 — Rate limiting is process-local and bypassable in production

Severity: **Medium**

Evidence: `apps/api/src/integration/integration.rate-limit.guard.ts:5-13` stores counters in a Node `Map`; copilot rate limiting does the same in `apps/api/src/copilot.service.ts:61,252-263`.

What happens: limits reset on restart and are independent per instance. Horizontal scaling multiplies the allowed rate. The maps also grow with client/user IDs.

Fix: use Redis/Key Value or a gateway-level limiter, cap key cardinality, and add distributed-rate-limit tests.

### F-12 — Integration audit logging silently loses failures and exception requests

Severity: **Medium**

Evidence: `apps/api/src/integration/integration.audit.interceptor.ts:13-22` writes inside an async `tap`, swallows insert errors, and has no error branch for failed requests.

What happens: audit records are best-effort. A database outage or failed API request can leave no audit row, while callers still receive a normal response.

Fix: write audit records in a durable queue/outbox, record both success and failure, and expose audit-write health metrics.

### F-13 — Migration history leaves two competing data models and APIs

Severity: **Medium**

Evidence: the original `public` model and functions remain in `202610010001_scm.sql`, while the v2 model adds schemas `iam`, `master_data`, `documents`, `scm`, `inventory`, etc. The v2 foundation explicitly says the public schema remains untouched. The API still contains compatibility/legacy code and many migrations rewrite the same workflow functions.

What happens: there are two sources of truth and a long chain of function replacements. It is difficult to know which schema is authoritative, and rollback/clean-install behavior is not proven by the repository tests.

Fix: declare one canonical model, archive or remove legacy objects, add a clean-database migration test, and document the supported migration path.

### F-14 — Validation coverage is not production-shaped

Severity: **Medium**

Evidence: `pnpm test` runs 58 API unit tests and 8 web tests. The SQL files under `supabase/tests` are not wired into the root test script. The tests do not exercise real RLS, service-role behavior, concurrent RPC calls, cross-company foreign keys, storage policies, or email races.

What happens: the green test result proves compilation and isolated helper behavior, not end-to-end correctness of the critical workflow.

Fix: run the Supabase SQL tests in CI against a fresh local database, add API-to-database integration tests, and add concurrency/property tests for reservations, dispatch, POD, invoice, and idempotency.

## What is genuinely good

- The v2 model has real transaction-oriented workflow functions and row locking in key paths.
- Idempotency keys are used in most workflow commands.
- Stock is represented as an append-only ledger with reversal support.
- RLS policies, company access tables, audit events, signed document URLs, and integration credentials are real infrastructure, not just UI claims.
- File validation checks extensions and common magic bytes before storage.
- Build and unit-test hygiene is currently good enough to catch basic regressions.

## What is overstated or architectural theater

- “Role-based” control is incomplete because acceptance is write-gated rather than approval-gated.
- “Tenant isolation” is mostly an application convention because the server uses service-role access and the schema lacks company-consistent foreign keys.
- “Audited integration” is best-effort for failed requests and can silently lose audit rows.
- “Production-grade inventory” is not proven while POD exception stock can remain in transit and no live reconciliation test exists.
- “Read-only” document/copilot surfaces still perform expensive storage, extraction, and audit side effects around the read workflow.

## Top 10 priorities

1. Fix acceptance/rejection approval enforcement in both API and SQL.
2. Remove the integration fallback to ordinary user sessions in non-local environments.
3. Define one database tenant model and add composite tenant-safe foreign keys.
4. Stop using the service-role client for normal user data access.
5. Correct POD stock movements for short, damaged, and rejected quantities.
6. Add real database integration tests to CI.
7. Make change-log versioning concurrency-safe.
8. Make notification delivery transactional/leased.
9. Move rate limiting to shared infrastructure.
10. Finish the v2 cutover and retire the legacy model.

## Second-pass critique

This audit is based on static evidence and unit/build execution. I did not prove an exploit against a live database. Some RPCs may contain additional checks in migrations not visible in the cited path, and storage bucket policies were not available as deployed configuration. The highest-confidence findings are F-01, F-02, F-03, F-05, F-06, F-08, F-09, F-10, F-11, F-12, and F-14 because their behavior is directly visible in executable code or schema. F-07 should be confirmed with a live POD test and stock reconciliation query, but the current function is plainly missing ledger handling for non-confirmed quantities.

## Verification performed

- `pnpm test`: passed — 7 API suites / 58 tests and 2 web files / 8 tests.
- `pnpm build`: passed for API and web.
- Static review of all API TypeScript files and all Supabase migrations/tests.
- Added `.github/workflows/validation.yml` to run application tests/builds and the SQL validation files against a fresh Supabase database in CI.
- No live Supabase, storage-policy, browser, or multi-instance test was available in this audit. The local Supabase test command could not run because Docker/Postgres is not available in this environment.

## Product and workflow audit

This section is about the product behavior and user workflow, not only code quality.

### P-01 — The core PO workflow is backwards for the business process

Verdict: **FIXED IN WORKTREE**

Evidence: `USER-GUIDE.md:25,100` says acceptance and appointment can happen in either order and stock is reserved only after both. `supabase/migrations/202610030004_scm_v2_workflows.sql:372-375` checks the reservation gate, and `:541` calls reservation after acceptance. `scm.try_create_reservation` requires both gates through `scm.po_gate_state_v`.

What the user experiences: accepting a PO does not make stock blocked. The UI then asks the user to attach an appointment before the reservation becomes real.

Why this is wrong: PO acceptance is the commercial commitment. It should immediately create a reservation/blocked-stock state. Appointment information is a logistics update that can arrive later.

Required product behavior:

1. Upload and review PO.
2. Accept PO.
3. Immediately reserve available stock and show blocked/shortage quantity.
4. Attach appointment letter later.
5. Extract appointment date, appointment ID, FC, source/destination details, and update logistics only.

The UI currently reflects the wrong model at `apps/web/src/main.tsx:1830-1838`, where the next step is “Upload appointment letter after booking,” while the PO acceptance action is still gated by status at `:715-725` and `:1793-1816`.

Smallest product change: split commercial status from logistics status. Acceptance should call reservation immediately; appointment should never be a prerequisite for stock blocking. A PO can be `ACCEPTED + APPOINTMENT_PENDING`.

### P-02 — Appointment attachment can fail because warehouse resolution is treated as appointment matching

Verdict: **FIXED IN WORKTREE**

Evidence: `supabase/migrations/202610070001_address_based_resolution.sql:111-140` resolves a warehouse from the appointment source city. If there is no unique match, resolution becomes `MISSING_SOURCE_CITY`, `WAREHOUSE_REVIEW_REQUIRED`, or `SOURCE_CONFLICT_REVIEW`. At `:140`, a requested `MATCHED` appointment is changed to `MISMATCHED` unless warehouse resolution is `RESOLVED`.

What happens: the UI submits `matchStatus: 'MATCHED'` at `apps/web/src/components/DocumentWorkflowModal.tsx:78`, but the database can downgrade it based on warehouse resolution. The user may see a failed or mismatched appointment even when the appointment letter itself is valid.

Why this feels intermittent: it depends on whether the PO already has a source warehouse, whether the extracted source city is present, whether exactly one warehouse matches that city, and whether the AI put the address in the right field.

Product problem: appointment identity and warehouse mapping are two separate decisions, but the product treats them as one gate.

Fix: attach the appointment first with an explicit status such as `APPOINTMENT_ATTACHED / WAREHOUSE_REVIEW_REQUIRED`. Let the user resolve the warehouse afterward. Do not reject or downgrade the appointment just because warehouse mapping is incomplete.

### P-03 — Appointment data can overwrite the PO's destination identity

Verdict: **FIXED IN WORKTREE**

Evidence: `supabase/migrations/202610070001_address_based_resolution.sql:145-152` updates the PO using appointment values. It sets `destination_name` from `v_destination_address` and `destination_key` from `v_destination_city`.

What happens: an appointment document can change the PO's destination key/name. A logistics document should enrich or confirm the PO destination, not silently replace the commercial destination record.

Impact: destination mapping, route lookup, shipment display, and downstream integrations can change after appointment upload. This is a direct explanation for “destination address attached to source address” or records that appear duplicated but disagree.

Fix: keep separate fields:

- PO commercial destination: immutable/corrected through PO review.
- Appointment destination: what the appointment letter says.
- Resolved route destination: canonical warehouse/FC master reference.
- Raw extraction: untouched document output.

Only an explicit user correction should change the PO destination.

### P-04 — Source and destination addresses are duplicated across too many objects without a clear ownership rule

Verdict: **PARTIALLY_IMPLEMENTED**

Evidence: source/destination fields exist on purchase orders, appointments, shipments, route snapshots, and extraction JSON. `apps/web/src/main.tsx:1757-1761` displays fallback chains across these fields. `supabase/migrations/202610080003_normalized_route_snapshots.sql:70-100` copies appointment/PO address fields into shipments.

What happens: the UI chooses whichever value is non-empty first. There is no single visible source of truth and no clear label saying whether a value is extracted, user-corrected, master-data-resolved, or copied into a shipment snapshot.

Impact: users cannot tell which address is authoritative. Corrections made later may not update already-created shipments, while appointment uploads may alter PO values.

Fix: show provenance on every address: `Document extracted`, `User corrected`, `Master data`, or `Shipment snapshot`. Use IDs for linked entities and snapshots only where historical accuracy requires it.

### P-05 — Warehouse concepts are not cleanly separated in the product

Verdict: **PARTIALLY_IMPLEMENTED**

Evidence: the UI calls master-data sites “warehouses” at `apps/web/src/main.tsx:1681-1691`. Inventory uses the same site IDs through `site_id`; PO creation stores `source_site_id`; destination mappings point to `source_site_id`; routes use `source_site_id`; shipment creation uses the PO source site and a separate transit location at `supabase/migrations/202610080003_normalized_route_snapshots.sql:83-100`.

What happens: the product has one source warehouse concept, a destination/FC text concept, and a transit location concept, but it does not present these as a clear network model. Destination warehouses are not first-class linked warehouse records; they are mostly keys, names, cities, and addresses.

Impact: users cannot reliably answer “which physical warehouse owns this stock?”, “which destination warehouse/FC receives it?”, or “which route and transit time apply?” without interpreting several fields.

Fix the product model:

- `Source warehouse`: physical inventory-owning site.
- `Source stock location`: bin/zone inside source warehouse.
- `Destination facility`: receiving warehouse/FC master record.
- `Transit route`: source warehouse → destination facility, with transit time and cost.
- `Transit location`: temporary accounting/logistics state, not a warehouse.

Shipment pages should show the linked source warehouse, linked destination facility, route, transit hours, calculated ETA, and any manual override separately.

### P-06 — Warehouse mapping depends on exact city uniqueness, which is too weak for real operations

Verdict: **PARTIALLY_IMPLEMENTED**

Evidence: `master_data.resolve_warehouse_city` at `supabase/migrations/202610070001_address_based_resolution.sql:47-55` returns a warehouse only when exactly one active warehouse matches the normalized city.

What happens: two warehouses in the same city produce no automatic match. A missing or mis-extracted source city also produces no match. The product then falls into mapping/review states that look like upload or appointment failures.

Fix: resolve in this order: explicit warehouse code → destination/source mapping → exact address/postal code → city → manual review. Show the candidate list and confidence instead of silently returning “no match.”

### P-07 — Extraction is allowed to produce plausible but wrong logistics data

Verdict: **FIXED IN WORKTREE**

Evidence: the extractor prompt distinguishes source and destination at `apps/api/src/openrouter-extractor.ts:41-43`, but the validation only checks types and presence at `:147-176`. The PO upload UI maps values directly into the editable form at `apps/web/src/main.tsx:887-905`. There is no semantic check that a source address is a vendor/dispatch address and a destination address is an FC/customer address.

What happens: if the model swaps fields, the product accepts both strings as valid. The user can save a PO with the wrong source/destination relationship unless they notice it in review.

Fix applied: document-specific warnings now flag suspicious source/destination assignments, and PO plus appointment/consignment flows require explicit confirmation when warnings or low confidence are present.

### P-08 — The PO upload flow has a weak failure model

Verdict: **PARTIALLY_IMPLEMENTED**

Evidence: `apps/web/src/main.tsx:860-877` treats extraction as a single request and displays a warning, while `:887-914` immediately constructs the PO form from extracted values. Appointment attachment repeats extraction and upload in `apps/web/src/components/DocumentWorkflowModal.tsx:39-78`.

What happens: a PO may be created with unresolved warehouse/SKU/address fields, then a later appointment upload is expected to repair them. If extraction misclassifies the document or misses the source city, the later appointment path becomes the place where the user discovers the original PO was incomplete.

Fix applied: low-confidence and extraction warnings now require confirmation before document save, and PO details show the next required action. A full persisted extraction-state workflow and retry queue is still outstanding.

### P-09 — Several “next steps” are status text, not actionable product work

Verdict: **PARTIALLY_IMPLEMENTED**

Evidence: the PO details view now shows a state-specific next-action message and direct actions for appointment attachment, shipment planning, and eligible invoice upload. The inbox shows mapping-required status.

What happens: the interface now guides the common PO-to-invoice path from the PO workspace. Warehouse mapping and multi-shipment POD exceptions still route the operator to their dedicated queues.

Fix: every blocked state should include `why blocked`, `who owns it`, `what to do`, and a direct action. Example: `Warehouse unresolved → Review 2 candidate warehouses`.

### P-10 — Shipment route/time is a fallback feature, not a reliable planning feature

Verdict: **PARTIALLY_IMPLEMENTED**

Evidence: shipment creation looks up a route using destination text/city at `supabase/migrations/202610080003_normalized_route_snapshots.sql:62-68`; if no route exists, expected arrival is null at `:96-100`. The UI displays `Route time not set` at `apps/web/src/main.tsx:1826`.

What happens: shipment creation can succeed without a route or ETA. The user gets a shipment page with incomplete timing, even though transit time is a stated operational requirement.

Fix: make route selection mandatory for dispatch planning, show the selected route and transit hours before save, and require an explicit manual override reason when no master route exists.

### Product priority order

1. Change the workflow to accept PO → block stock → attach appointment.
2. Separate appointment attachment from warehouse resolution.
3. Stop appointment uploads from overwriting PO destination identity.
4. Establish one warehouse/facility network model shared by master data, inventory, PO, routes, and shipments.
5. Add extraction provenance and semantic source/destination validation.
6. Turn unresolved states into actionable work queues.
7. Make route and ETA visible and required for shipment planning.
8. Add end-to-end product tests for: new PO, accepted PO without appointment, later appointment attachment, two warehouses in one city, missing source city, swapped addresses, and route missing.

### P-11 — PO review quantity control has an inconsistent quantity interaction

Verdict: **PARTIALLY_IMPLEMENTED**

User-reported behavior: the quantity adjustment control on the PO review page opens as a slider/stepper-style control. Typing a quantity shows `0` first, while changing the quantity with arrow controls does not show the same zero behavior.

Repository evidence: the current PO review form at `apps/web/src/main.tsx:1245-1256` uses a numeric input for the extracted `ordered` quantity and converts every keystroke with `Number(e.target.value)`. That means an empty field becomes numeric `0` immediately. The current repository does not contain the reported slider, so the deployed UAT screen may be from a stale build, another component, or another branch.

Product risk: users are correcting a commercial PO quantity, not adjusting warehouse stock. A visible zero while typing can make a valid extracted quantity look wrong, cause accidental zero submissions, or make the review process feel unreliable.

Fix:

- Use a plain numeric input for PO quantity correction. Do not use a slider for exact PO quantities.
- Keep the field blank until the user enters a value.
- Label the meaning clearly: `Ordered quantity` or `Accepted quantity`, depending on the field.
- Preserve the raw extracted quantity beside the editable corrected value.
- Show a warning when the corrected value differs from the document.
- Validate on blur and submit, not on every keystroke.
- Test blank, `0`, `1`, decimal, arrow increment, paste, backspace, and invalid text cases.

Because the repository code does not match the reported slider behavior, confirm the deployed UAT commit before fixing this screen. A stale frontend bundle or a second frontend implementation is itself a release blocker.

## Client-document evidence

The files in `SCM Detail` materially clarify the required product behavior.

### The client specification already defines the correct order

`SCM Detail/Novel_SCM_QC_Platform_Spec_v2.0.pdf`, page 20, describes the outbound flow as:

`Channel PO → ATP check → Allocate & reserve → Book appointment → Pick list → Dispatch`

This supports the requested behavior: acceptance and inventory reservation come before appointment booking. The current application is out of alignment with the client's own specification because it waits for both acceptance and appointment before reservation.

The same specification says the PO tracker should capture PO number, SKU, quantity, rate, delivery window, destination FC, appointment status, ASN status, dispatched quantity, received quantity, short/excess quantity, fill rate, penalty exposure, and a reason code for every shortfall. These should be treated as first-class fields, not only derived text in a document view.

### The documents prove that extraction must be channel-specific

The supplied files do not use one consistent vocabulary:

- `4S2BJXYY - PO.pdf` uses `Ship to location` and `Delivery Address`.
- `49990010116382.pdf` uses `Delivered By` for the supplier/source and `Delivered To` for the receiving FC.
- `FLSCNISD6F7Y6K7P_consignment_details.pdf` uses `Ship To Address` and `Ship From Address`.
- `FLSCNISD6QGPBUQE_consignment_details.pdf` includes an FC name, destination address, and a separate supplier ship-from address.

This explains why a generic extractor can swap source and destination while still producing valid-looking strings. The parser needs channel/document templates and field provenance. For each document it should store:

- raw label and raw value;
- normalized role: `SOURCE` or `DESTINATION`;
- linked master record, if resolved;
- confidence and reason for the match;
- user correction, if changed.

### The supplied files also show why one PO must support multiple logistics documents

The sample set includes POs, appointment/consignment-style documents, box labels, inventory workbooks, sales exports, and dispatch workbooks. These are not duplicates of one document. They are evidence from different operational stages. The product should link them to a common PO, shipment, warehouse, and item record instead of treating each upload as a new isolated document.

### Reference-backed UAT scenario

Use the client files to test one complete case:

1. Upload `4S2BJXYY - PO.pdf` and confirm Amazon PO number, ASIN, destination FC, quantities, and delivery address.
2. Review and accept the PO.
3. Confirm reserved/blocked stock appears before appointment attachment.
4. Attach the relevant appointment document and confirm only appointment/logistics fields change.
5. Create two shipments from the same PO.
6. Attach a consignment or driver evidence document to the correct shipment.
7. Record POD quantities, including a short/damaged case.
8. Generate the vendor invoice from final accepted quantities.
 
## Latest implementation update

The PO review fixes now also include:

- extraction run status exposed on each PO, with a direct review action for failed or review-required runs;
- field-level extraction provenance rows for top-level extracted values and confidence;
- direct invoice upload from the PO workspace after delivery or short close;
- route, transit-hour, and route-readiness display on the PO workspace;
- separate Administration sections for source warehouses, destination facilities, and transit routes.
- a `master_data.destination_facilities` table, backfilled from existing mappings and linked to new mappings and routes.
- PO, appointment, and shipment records now carry the same destination-facility ID; source warehouse/site IDs remain separate.
- failed document extraction keeps the selected file in the upload modal and clearly tells the operator how to retry.
- the extraction failure state now has an explicit one-click `Retry extraction` action.
- the PO inbox now exports the filtered operational set to an Excel workbook with purchase-order, line, and shipment sheets, including vendor/customer, FC code/city, source warehouse, lead time, reservation, dispatch, delivery, shortage, and invoice fields.
- every database audit write now creates a matching durable outbox event in the same transaction.
- manual inventory increases and decreases now use a signed, balanced `ADJUSTMENT` stock transaction; the old UI path that could only add stock is no longer used.
- inventory decreases are prevented from making internal stock negative, and each adjustment requires a reason and idempotency key.
- the Inventory History view remains tied to immutable stock transactions rather than editable balances.

These changes are covered by the application build and test results.

## Verification completed

- API tests: 61 passed.
- Web tests: 8 passed.
- Production build: passed. Existing bundle-size warnings remain for PDF/Excel dependencies.
- Fresh local database reset: passed.
- `scm_v2_validation.sql`: passed.
- `scm_v2_workflow_smoke.sql`: passed, including accept-before-appointment reservation, appointment-first gating, dispatch, POD short-close, invoice, rollback, and destination-facility linking.
- `sales_integration_validation.sql`: passed.

## Remaining release gaps

- The current API is the v2 command path; the remaining compatibility views are intentionally read-only and should be removed only after the client's UAT confirms no external consumer depends on them.
- Durable background retry/queue handling for failed extraction remains a post-UAT hardening item; the upload flow has bounded server retries and a user-visible retry action.
- The exported workbook should still be compared with the client's dispatch workbook during UAT for any client-specific columns such as dock number or Google location that are not present in the current master data.
- The new transaction-first inventory flow should be verified in UAT with increase, decrease, over-decrease, duplicate-request, reservation, dispatch, POD, and short-close scenarios.

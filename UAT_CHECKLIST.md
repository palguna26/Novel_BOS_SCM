# SCM UAT checklist

Use this checklist after applying the migrations to a fresh UAT database. It covers the client workflow and the fixes from the audit.

## 1. Deploy and database pre-checks

1. Deploy the API and web build from the same commit.
2. Apply all migrations, including `supabase/migrations/202610140001_po_review_workflow_fixes.sql`.
3. Confirm the test user has `can_read`, `can_write`, and `can_approve` set as intended.
4. Confirm at least one active source warehouse has an active non-virtual stock location.
5. Confirm an active source-to-destination route exists with transit hours.
6. Run the SQL files in `supabase/tests` against the UAT database and keep the output with the release record.

## 2. PO review

Use a client PO PDF such as `SCM Detail/4S2BJXYY - PO.pdf`.

- Upload the PDF and confirm the PO number, destination, source, line SKU, quantity, rate, and delivery window.
- Clear and retype the quantity. The field must stay blank while empty and must not turn into `0` until `0` is explicitly entered.
- Enter an invalid or negative quantity. Save must be rejected.
- When extraction warnings or low confidence are shown, confirm the warning before saving.
- Confirm the raw source/destination fields remain separate and are editable before acceptance.
- Confirm a write-only user cannot see or call Accept/Reject.

## 3. Accept first, appointment later

- Accept the PO before attaching an appointment letter.
- Confirm the PO becomes accepted and stock is reserved or shortage is shown immediately.
- Confirm the inventory reservation points to the same source warehouse and stock location used by Inventory.
- Attach the appointment PDF afterward.
- Confirm the appointment is attached without creating a second reservation.
- Confirm the PO commercial destination does not change when appointment addresses are different.
- Confirm appointment source/destination fields are shown as appointment data, not silently substituted for PO data.

## 4. Warehouse mapping edge cases

- Use an appointment with a source city that matches exactly one active warehouse. Confirm it auto-maps.
- Use two active warehouses in the same city. Confirm the system does not choose one silently and asks for manual selection.
- Use a missing or unknown source city. Confirm appointment attachment can still be saved and the mapping remains visibly unresolved.
- Select a warehouse and confirm only its active stock locations are offered.
- Confirm the selected source warehouse is the same master-data record used by Inventory, PO reservations, routes, and shipments.

## 5. Shipment planning

- Plan two shipments from one accepted PO.
- Confirm each shipment shows source warehouse, destination, route, transit hours, and ETA.
- Remove or deactivate the route and confirm shipment creation is blocked with a clear reason.
- Confirm no shipment can be created with a missing source warehouse or stock reservation.

## 6. Transaction-first inventory

- Post an increase from the Inventory screen and confirm it creates an `ADJUSTMENT` transaction with a reason.
- Post a decrease and confirm it creates a second balanced transaction; no balance is edited directly.
- Try to decrease more than the available stock. The transaction must fail and the balance must remain unchanged.
- Open History and confirm each transaction shows its type, status, reason, timestamp, and ledger effect.
- Repeat a request with the same idempotency key. It must not create a duplicate transaction.
- Confirm PO reservation, shipment dispatch, POD receipt, shortage, and short-close movements also appear in the same transaction history.

## 7. Delivery and invoice

- Attach a consignment to the correct shipment, not only to the PO.
- Record a normal POD and confirm delivered stock leaves transit.
- Record short, damaged, and rejected quantities. Confirm each quantity leaves transit and appears in the correct exception state.
- Confirm a POD cannot be attached without selecting a shipment.
- Upload the invoice only after full delivery or an approved short close.

## 8. Evidence to retain

- UAT commit/build identifier.
- Migration output.
- SQL smoke-test output.
- Screenshots or screen recording of accept-first reservation, ambiguous warehouse review, route blocking, and POD exceptions.
- Any failed document extraction with the original PDF and the corrected fields.

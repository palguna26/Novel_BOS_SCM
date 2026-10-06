# SCM Demo Data and PO Workspace Design

## Goal

Make the SCM MVP useful immediately after seeding and make the PO workflow match the document-led operating model in the PRD.

The seed will create several POs in different operational states and one complete end-to-end example. PO upload will accept a PDF only. After extraction, a review modal will let an SCM user correct the scanned data before saving the PO.

## Upload and review flow

1. The user opens PO Inbox and selects a platform.
2. The user drops or selects one PDF. No PO fields are entered on the upload form.
3. The API stores the original PDF and extracts text with `pdfjs-dist`.
4. The API returns extracted fields, confidence, duplicate information, and candidate warehouse mapping.
5. The frontend opens a review modal containing:
   - source PDF preview and filename;
   - extraction confidence and scan warnings;
   - editable PO header fields;
   - editable PO line table for SKU, quantity, unit price, line value, shelf life, and delivery window;
   - warehouse mapping result;
   - required-field validation;
   - duplicate PO warning.
6. The user can correct extracted values in the modal.
7. Saving is blocked until all required fields are complete and valid.
8. The corrected values and original extraction are both stored. The PO enters `UNDER_REVIEW` when mapping exists, or `WAREHOUSE_MAPPING_REQUIRED` when it does not.

The upload endpoint remains separate from PO creation so a failed scan or correction can be retried without creating a business record. The final save endpoint creates the PO and its lines in one operation and records the correction in the audit log.

## PO workspace

PO details becomes a full page rather than a narrow side panel. It keeps a consistent summary header with PO ID, platform, status, warehouse, destination, deadline, total value, and primary next action.

The page contains these detailed sections:

- **Overview:** header facts, source PDF, extraction status, warehouse assignment, shortage summary, deadline alerts, and next-step checklist.
- **Lines & Inventory:** every SKU with ordered, allocated, blocked, threshold, allocatable, shortage, dispatched, delivered, damaged, rejected, and remaining quantities.
- **Appointment:** appointment state, booking and delivery times, location, matching result, document versions, and replacement history.
- **Shipments:** one card or table row per truck with vehicle, driver, route, planned quantities, dispatch state, transit timings, cost, events, and POD state.
- **POD & Discrepancies:** POD files, confirmed quantities, short/damaged/rejected quantities, unresolved exceptions, and correction history.
- **Invoice:** invoice gate explanation, invoice file and details, send state, and resend history.
- **Notifications:** acceptance email, failures, retries, recipients, and timestamps.
- **Audit Activity:** chronological immutable events with actor, role, source screen, reason, old value, and new value.

Sections use tabs on wide screens and remain readable on smaller screens. Actions are shown only when the current role can perform them. QC sees all permitted data but no write controls.

## shadcn component layer

Add a local shadcn-style component layer under `apps/web/src/components/ui`. It will use Tailwind classes and the existing project styling, with no visual dependency on the old ad-hoc buttons or panels.

The first components are `Button`, `Badge`, `Card`, `Dialog`, `Input`, `Label`, `Select`, `Tabs`, `Table`, `Alert`, `DropdownMenu`, `Toast`, and `Progress`. Components stay small and composable. Workflow screens own their data and action logic; UI components do not call the API.

## Seed data

The Supabase seed will be idempotent and create:

- four demo users: Administrator, Manager, Team Member, and QC;
- Amazon/RK World and Flipkart platforms;
- two warehouses, several SKUs, destination mappings, route estimates, and threshold policies;
- opening stock, stock-addition movements, reservations, dispatch movements, delivery movements, and audit history;
- several POs covering extraction review, inventory shortage, appointment pending, shipment planning, in transit, delivery discrepancy, fully delivered, and invoice pending;
- one complete multi-truck PO with appointment, shipment events, POD, invoice, notifications, and audit trail;
- local sample PO, appointment, POD, and invoice PDF fixtures linked to the complete example and available for review in the UI.

Seed reruns update or reuse demo records instead of creating duplicate users, masters, POs, documents, movements, or audit events.

## Error handling

- Unreadable PDFs remain in a document review state with a visible extraction warning.
- Duplicate platform/PO combinations are rejected before final save.
- Missing mappings are visible in the review modal and prevent acceptance.
- Missing required fields prevent review save.
- RPC failures show a user-readable toast and leave the source document available for retry.
- Failed email delivery remains visible in Notifications and can be retried without creating another reservation.

## Testing

Add focused tests for:

- PDF-only upload and review validation;
- corrected extraction values becoming the saved PO values;
- duplicate PO rejection;
- seeded multi-truck PO details data shape;
- role-aware PO actions;
- invoice gating and POD discrepancy rendering.

Run API and web builds after implementation. Live Supabase verification requires configured project credentials and the migration to be applied.

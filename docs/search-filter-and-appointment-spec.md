# Search, PO Filters, and Appointment Document Extraction

## Context

The application currently has a visual global search field, but it does not
change the displayed records. Inventory has a working local SKU search, but
the PO Inbox has no search or filter controls. Appointment uploads also depend
on the API extraction service and do not show extracted values in the form.

This spec covers the complete operational flow: API availability, appointment
document extraction, global search, and PO filtering.

## Current State

Verified on 2026-10-07:

| Area | Current behavior | Gap |
|---|---|---|
| API | API defaults to port 4000 in `apps/api/src/main.ts` | Upload fails with `ERR_CONNECTION_REFUSED` when API is not running |
| Dev command | Root `npm run dev` invokes both workspace services through pnpm | Running from `apps/web` starts only Vite |
| Appointment upload | `DocumentWorkflowModal` posts to `/api/documents/extract`, then saves the result | Extracted values are not displayed back in the form |
| Appointment parser | Rule parser recognizes a limited set of labels | Common labels and scanned PDFs may not be recognized |
| Global search | `Search records...` input exists in `apps/web/src/main.tsx:328` | No state, handler, or filtering logic is attached |
| Inventory search | `InventoryWorkspace` filters SKU code, name, and warehouse locally | This behavior must remain unchanged |
| PO filters | No PO filter controls exist | Users cannot narrow records by status, platform, warehouse, dates, or exceptions |

## Goals

1. Make document extraction failures visible and actionable.
2. Extract and display appointment details before the user saves them.
3. Provide fast search across loaded PO records.
4. Provide usable PO filters and allow filters to be combined.
5. Preserve existing inventory search and all existing PO actions.

## Proposed Change

### 1. API and development environment

The web application shall use one configured API base URL:

```text
VITE_API_URL=http://localhost:4000
```

The root development command shall start both services. The web app shall
show a clear connection banner when an API request fails with a network error:

```text
API is unavailable. Start the SCM API service on port 4000.
```

Document upload errors shall distinguish:

- API unavailable
- Unauthorized session
- Unsupported file
- Extraction failed
- Document saved but fields require manual review

The frontend shall not silently continue after the extraction request fails.

### 2. Appointment extraction

When a user selects an appointment file, the frontend shall:

1. Read text from PDF, XLSX, CSV, and DOCX as it does today.
2. Send the file and extracted text to `/api/documents/extract`.
3. Display the returned appointment fields in the form.
4. Display extraction confidence and warnings.
5. Allow the user to correct any field.
6. Require confirmation before saving the appointment.

The form shall display:

| Field | Source | Required to save |
|---|---|---|
| Appointment ID | `extracted.appointmentId` | Yes |
| Appointment time | `extracted.appointmentAt` | No, unless required by workflow policy |
| Location | `extracted.destination` | Yes |
| Linked PO | `extracted.linkedPoIds` and current PO | Must match current PO or require confirmation |
| Confidence | `extracted.confidence` | No |
| Warnings | `extracted.warnings` | No, but visible |

The extracted appointment time shall be converted to the format required by
`datetime-local` for display, while the API payload shall use an ISO timestamp.

The parser shall recognize at least these equivalent labels:

- `Appointment ID`, `Appointment Id`, `Appointment No`, `Appointment Number`
- `Appointment Time`, `Appointment Date and Time`, `Reporting Date and Time`
- `Destination FC`, `FC`, `Facility`, `Location`, `Ship To`, `Delivered To`
- `PO`, `PO Number`, `PO No`, `POs`

The parser shall preserve identifiers as strings and shall not guess missing
values. Missing values must produce warnings and leave the field blank.

For image-only or scanned PDFs, the application shall report:

```text
No selectable text was found. Enter the appointment details manually or use OCR.
```

OCR is not part of the first implementation unless an OCR provider is already
available. The file must still be stored for manual review.

Expected appointment save payload:

```ts
{
  documentVersionId: string;
  appointmentId: string;
  appointmentAt: string | null; // ISO 8601
  location: string;
  matchStatus: 'MATCHED' | 'REVIEW_REQUIRED' | 'UNMATCHED';
  matchDetails?: Record<string, unknown>;
}
```

### 3. Global search

The global search field shall become a controlled input. It shall search the
currently loaded records without a full page reload.

Searchable PO fields:

- PO number / external ID
- customer
- destination
- warehouse name
- platform name
- appointment ID
- SKU code and SKU name

Search rules:

- Case-insensitive.
- Trim leading and trailing spaces.
- Match partial text.
- Match across any searchable field.
- Empty search restores all records.
- Results update as the user types.
- A clear button resets the query.
- Show `No records match your search` when the result is empty.

The search must use stable record IDs as React keys and must not mutate the
original PO array.

### 4. PO Inbox filters

Add a filter bar to the PO Inbox below the search field.

Required filters:

| Filter | Values |
|---|---|
| Status | All, Under Review, Accepted, Inventory Shortage, Appointment Pending, Appointment Booked, Shipment Planning, In Transit, Fully Delivered, Short Closed, Delivery Issue, Invoice Uploaded |
| Platform | All active platforms in loaded data |
| Warehouse | All active warehouses in loaded data |
| Appointment | All, Pending, Booked, Missing document |
| Stock exception | All, No shortage, Shortage, Below threshold |
| PO date | All, Today, Last 7 days, Last 30 days, Custom range |

Filters shall be combinable using AND behavior. For example, `Status =
Accepted` and `Warehouse = Bengaluru` shows only accepted POs assigned to the
Bengaluru warehouse.

The filter bar shall include:

- Apply immediately on selection.
- `Clear filters` action.
- Active-filter count.
- Visible filter chips or equivalent summary.
- Empty-state text explaining which filters are active.

The selected search query and filters shall remain while opening and closing a
PO detail view, but shall reset on page refresh unless URL persistence is
implemented.

### 5. Data and API behavior

For the first version, search and filters may be client-side because the PO
list is already loaded by the dashboard. No database migration is required.

If the PO list grows beyond 1,000 records, add server-side query parameters:

```text
GET /api/pos?q=&status=&platformId=&warehouseId=&appointment=&exception=&from=&to=
```

The server-side response shall return the same PO shape currently consumed by
the frontend and shall include a total count.

## Acceptance Criteria

1. Starting the root development command makes both the web app and API
   reachable; port 4000 accepts authenticated requests.
2. If port 4000 is unavailable, the UI shows an API error banner instead of a
   generic fetch error.
3. Selecting a text-based appointment PDF populates Appointment ID, time, and
   location when those values exist in the document.
4. The user can edit extracted appointment values before saving.
5. A missing appointment ID or location is shown as a warning and cannot be
   saved without manual completion or an explicit review status.
6. Appointment identifiers from `Appointment No` and `Appointment Number` are
   extracted.
7. Appointment extraction warnings and confidence are visible before save.
8. The global search field filters PO records by PO number, SKU, customer,
   destination, warehouse, platform, and appointment ID.
9. Clearing global search restores the complete PO list.
10. Each required PO filter is available and has the specified values.
11. Multiple filters combine with AND behavior.
12. Clear filters restores the unfiltered PO list.
13. Existing inventory SKU search continues to filter by SKU code, name, and
   warehouse.
14. Existing PO accept, appointment, shipment, POD, invoice, and detail-view
   actions continue to work after filtering.
15. No React unique-key warnings are produced by the PO list, filter options,
   or search results.

## Testing Plan

| Layer | Tests | Count |
|---|---|---:|
| Unit | Search normalization and matching across all searchable fields | 8+ |
| Unit | Filter predicates, date ranges, empty values, and AND behavior | 10+ |
| Unit | Appointment label extraction and ISO/datetime-local conversion | 8+ |
| Component | Search typing, clear action, filter selection, chips, empty state | 8+ |
| Integration | Upload appointment file, inspect extraction response, save appointment | 3+ |
| Integration | API unavailable, unauthorized, invalid file, extraction warning | 4+ |
| E2E | Search PO, apply two filters, open detail, clear filters | 2+ |
| E2E | Upload appointment, correct extracted value, save, reload PO | 1+ |

## Implementation Order

1. API connection and error handling. This removes the current hard failure and
   makes document testing reliable.
2. Appointment extraction response and form population. This fixes the data
   quality issue before adding more UI controls.
3. Search state and shared PO matching helpers. Filters should reuse the same
   normalized PO data.
4. PO filter bar and empty states.
5. Tests, React key cleanup, and regression verification.

## Rollback Plan

The change is frontend and parser logic only, with no required database
migration. Roll back by reverting the implementation commit. Existing stored
documents and appointment records remain unchanged. If server-side query
parameters are later added, they may be removed without changing stored data.

## Effort Estimate

| Component | Estimate |
|---|---:|
| API connection/error states | 2–3 hours |
| Appointment extraction and form population | 4–6 hours |
| Search and shared matching logic | 2–3 hours |
| PO filter bar and empty states | 4–6 hours |
| Tests and regression checks | 4–6 hours |
| Total | 16–24 hours |

## Files Reference

| File | Change |
|---|---|
| `apps/web/src/main.tsx:57` | Centralize API error handling and global PO search state |
| `apps/web/src/main.tsx:328` | Connect the global search input to PO results |
| `apps/web/src/components/DocumentWorkflowModal.tsx:25-47` | Extract on upload, populate fields, show warnings, validate appointment payload |
| `apps/web/src/lib/document-upload.ts` | Preserve extraction warnings and handle empty/scanned documents |
| `apps/api/src/document-extractor.ts:64-186` | Expand appointment labels and normalize appointment date/location values |
| `apps/api/src/document.service.ts` | Preserve extraction metadata and return document version details |
| `apps/api/src/document.controller.ts` | Keep upload errors explicit and testable |
| `apps/api/src/document-extractor.spec.ts` | Add appointment label and date tests |
| `apps/web/src/components/InventoryWorkspace.tsx:17-32` | Preserve and regression-test existing SKU search |
| `apps/web/src/components/PoInboxAccordion.tsx` | Add or consume filtered PO results if filtering is moved into the inbox component |

## Out of Scope

- Automatic warehouse switching because of stock shortage.
- OCR implementation or selection of an OCR vendor.
- Full-text search across document contents.
- Database migration for server-side filtering in the first version.
- Changes to inventory allocation rules.
- Changes to PO acceptance, reservation, dispatch, POD, or invoice business rules.

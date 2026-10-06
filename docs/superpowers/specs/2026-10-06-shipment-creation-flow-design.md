# Shipment Creation Flow Design

## Goal

Make shipment creation start from one clear `Create shipment` action on the Shipment page. The first step must select an eligible purchase order; the second step keeps the existing shipment planning fields and SKU quantity entry.

## User flow

1. User clicks `Create shipment` in the Shipment page header.
2. A two-step modal opens with PO selection.
3. The modal lists only POs that are accepted, have an appointment date, and still have allocatable quantity available.
4. User selects exactly one PO and continues.
5. The modal shows shipment planning fields: truck number, driver name, driver phone, planned dispatch time, and SKU quantities.
6. User submits the shipment. The existing shipment endpoint is used, the modal closes, and the tracker refreshes.

## UI behavior

- The existing per-PO manual planning buttons are replaced by the single header action.
- PO selection shows PO number, appointment date, destination, warehouse, and remaining units.
- Continue is disabled until one PO is selected.
- Quantity inputs are capped at each SKU's remaining quantity.
- Create shipment is disabled until at least one SKU quantity is entered.
- If no eligible POs exist, the selection step shows an empty state with the eligibility rule.
- Existing dispatch and POD actions remain unchanged.

## Implementation boundaries

- `Shipments` owns modal open/close state and refresh behavior.
- `ShipmentPlanModal` owns the two-step UI and selection/planning state.
- The existing `POST /api/pos/:poId/shipments` contract remains unchanged.
- No API, database, or unrelated shipment lifecycle changes are needed.

## Validation

- Build the web app with the existing TypeScript/Vite build.
- Verify the modal opens from the header button, eligible PO filtering works, step navigation works, and the existing shipment submission remains wired.
- Verify dispatch and POD controls are unaffected.

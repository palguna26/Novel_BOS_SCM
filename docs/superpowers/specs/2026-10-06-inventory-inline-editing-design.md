# Inventory Inline Editing Design

## Goal

Allow users to edit stock details and SKU master data directly in the Inventory page, with explicit confirmation for every edit section.

## Behavior

- Stock tab: an expanded SKU detail panel has an `Edit` action for stock adjustments.
- SKUs tab: each SKU row has an `Edit` action that turns the row into an inline form.
- Each edit section has `Save` and `Cancel` controls.
- No field saves automatically on blur.
- Save uses the existing API endpoints and success/error feedback.
- Cancel restores the read-only view without changing data.

## Scope

- Stock editing uses the existing inventory adjustment flow and requires quantity and reason confirmation.
- SKU editing supports code, product title, item class, and base UOM.
- Other Inventory tabs, History, and existing add dialogs remain unchanged.

## Validation

- Build the web app with the existing TypeScript/Vite build.
- Verify Stock and SKU edits can be entered, saved, cancelled, and show errors.
- Verify no request is sent on blur.
- Verify existing add and History actions still work.

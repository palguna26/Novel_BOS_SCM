# Inventory SKU Expansion Design

## Goal

Make SKU details expand inline in the Inventory Stock tab instead of opening a popup.

## Behavior

- Clicking a SKU row toggles its inline detail panel.
- Multiple SKU panels can remain open at the same time.
- The expanded panel keeps the current SKU summary metrics and warehouse-level stock details.
- The separate History action remains a modal for stock transactions.
- Other Inventory tabs and edit dialogs are unchanged.

## Implementation

- Add an `expandedSkus` state collection in `InventoryWorkspace`.
- Render the detail panel directly after each expanded SKU row.
- Reuse the existing `StockDetail` content for the inline panel.
- No API or database changes are required.

## Validation

- Build the web app with the existing TypeScript/Vite build.
- Verify multiple SKU rows can be expanded and collapsed independently.
- Verify the History button still opens transaction history.
- Verify existing edit and add dialogs remain modal.

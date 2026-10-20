# In-Product Page-Scoped Guides

## Goal

Add an in-product Guide button beside Copilot in the shared top-right header. The guide is scoped to the current page or workspace so users can learn the task in front of them without opening a separate documentation site.

## User experience

- Add a `Guide` button immediately left of `Copilot`.
- Open the guide in a right-side panel on desktop and a full-width drawer on mobile.
- Change guide content automatically when the user changes pages.
- Switch to PO-specific help when a PO detail workspace is open.
- Keep Guide and Copilot as separate panels.
- Support keyboard focus, visible focus states, and close behavior.

## Guide structure

Every guide uses the same order:

1. At a glance: the page purpose and recommended starting point.
2. Page map: a compact visual card showing the main areas and their relationship.
3. Common tasks: expandable numbered steps with small UI-style visuals.
4. Key terms: plain-language definitions for fields, states, and quantities.
5. Checks before you continue: validations, permission rules, and warnings.

Visuals use lightweight in-app cards and flow diagrams rather than static screenshots. This keeps them responsive and avoids stale screenshots when the UI changes.

## Page coverage

- Overview: daily workflow and dashboard metrics.
- PO Inbox: upload, review, accept/reject, search, filters, and PO workspace.
- Inventory: stock adjustments, SKU setup, thresholds, warehouses, locations, channel SKU mappings, UOMs, routes, and inventory history.
- Shipments: plan, dispatch, expand shipment details, and confirm POD.
- Appointments: attach or replace appointment and consignment documents.
- Invoices: invoice eligibility, upload, short close, and delivery exceptions.
- Administration: platforms, warehouses, locations, mappings, UOMs, and routes.
- Audit Log: finding events and understanding recorded changes.

## Inventory guide requirements

Inventory receives the most detailed guide. It must explain:

- The meaning of on hand, allocated, blocked, planned, dispatched, delivered, and remaining quantities.
- How an adjustment changes stock and why a reason is required.
- How to search and inspect SKU-level inventory.
- How to edit thresholds and interpret low-stock states.
- How SKU, warehouse, location, channel mapping, UOM, and route records relate.
- What changes are recorded in Inventory History.

The primary visual flow is:

`Adjust stock -> enter quantity and reason -> save -> history entry`

The quantity flow is:

`On hand -> allocated -> blocked -> planned -> dispatched -> delivered`

## Implementation design

- Add a reusable `GuidePanel` component alongside `CopilotPanel`.
- Store guide content in a typed frontend registry keyed by page name.
- Support nested guide context for PO detail and the active Inventory tab.
- Add `guideOpen` state to the shared app shell.
- Reuse existing icons, Tailwind styles, and app colors.
- Do not add database or API changes in the first release.

## Accessibility and interaction

- Use dialog semantics and descriptive labels.
- Provide keyboard close behavior and visible focus states.
- Keep the panel scrollable independently from the page.
- Make guide sections expandable and usable on narrow screens.
- Ensure Guide and Copilot do not appear as two competing overlays at once.

## Testing

Add coverage for:

- Guide button placement, open, and close behavior.
- Correct content after page changes.
- Inventory sections and terminology.
- PO workspace-specific content.
- Mobile drawer behavior.
- Guide and Copilot overlay coordination.

## Success criteria

A user can open the guide from every main page, understand the page purpose, follow at least one visual task, and find the relevant Inventory or PO instructions without leaving the product.

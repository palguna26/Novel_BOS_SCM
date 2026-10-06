# Appointments Accordion Design

## Goal

Make the Appointments tab use inline expandable PO rows, matching the Inventory interaction.

## Behavior

- Each PO row can be expanded or collapsed inline.
- Multiple appointment rows can remain expanded at the same time.
- The expanded section shows PO status, destination, warehouse, customer/platform, appointment status, and appointment date.
- POs without an appointment keep the existing `Attach appointment` action inside the expanded section.
- The document attachment workflow remains a modal.

## Implementation

- Add expanded PO state to `Appointments`.
- Replace the static row with a toggle button and an inline details panel.
- Keep the existing appointment data and attachment API flow unchanged.
- No API or database changes are required.

## Validation

- Build the web app with the existing TypeScript/Vite build.
- Verify multiple rows can expand and collapse independently.
- Verify appointment upload still opens and saves through the existing workflow.
- Verify rows with and without appointments render the correct details.

# Design System â€” NOVEL SCM

## Product Context

- **What this is:** An internal supply-chain operations workspace for purchase orders, warehouse inventory, appointments, shipments, proof of delivery, invoices, and audit history.
- **Who it is for:** SCM managers, warehouse teams, operations coordinators, and QC reviewers.
- **Space/industry:** Warehouse and supply-chain operations software.
- **Project type:** Data-dense internal web application.
- **Memorable thing:** Serious software for serious warehouse work.

## Aesthetic Direction

- **Direction:** Industrial command center.
- **Decoration level:** Minimal with intentional operational emphasis.
- **Mood:** Dependable, precise, calm under pressure, and built for repeated daily use.
- **Research references:** [Cin7 dashboard](https://help.core.cin7.com/hc/en-us/articles/9034604706191-Using-the-Dashboard), [Cin7 inventory](https://www.cin7.com/features/inventory/inventory-management/), and [SAP warehouse dashboard material](https://assets.dm.ux.sap.com/co-sap-now-bogota/pdfs/02_optimizando_la_gestion_de_almacenes.pdf).

## Typography

- **Display/Hero:** Instrument Sans, semibold. Direct and compact for operational page headings.
- **Body:** Instrument Sans. Clear at small sizes and easy to scan in forms and tables.
- **UI/Labels:** Instrument Sans, medium or semibold.
- **Data/Tables:** IBM Plex Mono with tabular numbers. Use for SKU codes, PO IDs, quantities, timestamps, and audit records.
- **Code:** IBM Plex Mono.
- **Loading:** Google Fonts CDN for the MVP. Self-host before an offline or restricted deployment.
- **Scale:** 12px labels, 13px dense table text, 14px default UI text, 16px panel headings, 20px section headings, 30px page headings, 48px hero/display text.

## Color

- **Approach:** Restrained. Color is reserved for status, action, and risk.
- **Primary:** `#14211F` ink. Navigation, primary text, and high-contrast actions.
- **Secondary:** `#176B57` warehouse green. Primary actions, available stock, accepted states, and progress.
- **Canvas:** `#F4F5F2` warm operational canvas.
- **Surface:** `#FFFFFF` cards, tables, forms, and review panels.
- **Muted text:** `#66736F` supporting labels and metadata.
- **Borders:** `#DFE5E1` quiet separators and table rules.
- **Semantic:** success `#176B57`, warning `#B7791F`, error `#B84A4A`, info `#356B8C`.
- **Dark mode:** Keep ink-based contrast, switch the canvas to `#111917`, surfaces to `#18231F`, and reduce semantic saturation while retaining clear status contrast.

## Spacing

- **Base unit:** 4px.
- **Density:** Compact-to-comfortable. Tables should fit real warehouse work without feeling cramped.
- **Scale:** 2xs(2), xs(4), sm(8), md(16), lg(24), xl(32), 2xl(48), 3xl(64).

## Layout

- **Approach:** Grid-disciplined.
- **Grid:** Fixed 218px navigation rail on desktop, one working canvas, responsive single-column layout below 900px.
- **Max content width:** 1440px.
- **Page padding:** 30â€“38px desktop, 18â€“24px compact screens.
- **Border radius:** sm 4px for buttons and controls, md 6px for panels, lg 12px for grouped review areas, full 9999px for status badges.
- **Information hierarchy:** Show SKU-level inventory first, then reveal warehouse rows on click. Use the same progressive disclosure pattern for PO details and review workflows.

## Motion

- **Approach:** Minimal-functional.
- **Easing:** enter ease-out, exit ease-in, move ease-in-out.
- **Duration:** micro 80ms, short 180ms, medium 280ms.
- **Allowed motion:** Accordion expansion, upload progress, button feedback, and page-level state changes that help users understand what happened.

## Safe Choices

- Left navigation keeps major operational modules visible.
- Tables use predictable columns, status badges, and monospace identifiers.
- Semantic colors are limited to meaningful states: available, warning, blocked, error, and in transit.

## Deliberate Risks

- Use a warm canvas and industrial green instead of a generic blue SaaS palette. This gives the app a warehouse identity while keeping the interface neutral enough for long sessions.
- Use SKU-first progressive disclosure for inventory. Many systems start with warehouse rows, but the userâ€™s primary question is whether a SKU is usable overall before checking its warehouse allocation.
- Keep decoration nearly absent. Hierarchy, rules, data type, and status carry the visual interest.

## Decisions Log

| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-10-02 | Industrial command-center direction selected | Matches the memorable product promise: serious software for serious warehouse work. |
| 2026-10-02 | Instrument Sans + IBM Plex Mono selected | Gives interface text a clear human voice while making operational identifiers easy to scan. |
| 2026-10-02 | Restrained ink, warm canvas, and warehouse green palette selected | Keeps attention on stock state and exceptions without making every screen look urgent. |
| 2026-10-02 | SKU-first inventory hierarchy selected | Matches the required interaction: see SKU totals first, then inspect warehouse-level stock. |

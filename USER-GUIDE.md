# Novel SCM User Guide

## 1. End-to-end PO operation

Use this order for a normal PO:

```text
Sign in
-> Upload PO
-> Review extracted PO data
-> Save the PO
-> Check SKU and destination mappings
-> Accept or reject the PO
-> Attach the appointment document
-> Wait for both acceptance and appointment gates
-> Reserve stock
-> Manually plan one or more shipments
-> Dispatch each shipment
-> Upload POD and enter actual received quantities
-> Short close any approved remainder, if needed
-> Upload the invoice
-> Check Audit Log
```

Acceptance and appointment can be completed in either order. Stock is reserved only after both are complete.

Shipment planning is manual. The system does not decide that all remaining PO quantity belongs on one truck. For example, a PO with A, B, C, and D can be planned as:

```text
Shipment 1: 75% of A
Shipment 2: remaining 25% of A + B + C + D
```

## 2. Sign in and shared page controls

1. Open the SCM web address.
2. Enter your work email.
3. Enter your password.
4. Select **Sign in**.

After sign-in, the left navigation shows **Overview**, **PO Inbox**, **Inventory**, **Shipments**, **Appointments**, **Invoices**, **Administration**, and **Audit Log**.

The top bar shows the current page, a search field, and your user avatar. The bottom of the navigation shows your name, role, and **Sign out**.

Your role controls what you can change. QC users are normally view-only. Manager and administrator permissions are needed for approval and controlled master-data actions.

## 3. Overview

The Overview page is the daily starting page.

### Page elements

- **Upload purchase order**: opens PO document intake.
- **Awaiting review**: count of POs needing review.
- **Inventory blocked**: accepted PO activity holding stock.
- **In transit**: shipments currently moving.
- **Awaiting invoice**: delivered PO activity ready for invoice.
- **Recent purchase orders**: latest PO activity with channel, destination, and status.
- **Warehouse pulse**: available stock by SKU and warehouse.

Use the Overview to see what needs attention, then open the relevant page.

## 4. PO Inbox

The PO Inbox is the main PO intake and review page.

### List columns

- **PO ID**: external PO number.
- **Platform / destination**: sales channel and customer destination.
- **Warehouse**: source warehouse resolved from the destination mapping.
- **Status**: current PO state.
- **Action**: quick Accept action when the PO is under review.

Select a row to open the full PO workspace.

### Upload and review a PO

1. Select **Upload purchase order**.
2. Select the source platform.
3. Choose a PDF, XLSX, CSV, or DOCX file.
4. Select **Scan and open review**.
5. Review the extracted confidence value and fields.
6. Correct PO ID, PO date, destination, booking deadline, customer/vendor, and total value.
7. Review every PO line.
8. Select the correct internal SKU for each line.
9. Correct the quantity and unit price.
10. Add or remove lines if the document was read incorrectly.
11. Select **Save reviewed PO**.

Files must be 10 MB or smaller. If the file cannot be read, complete the fields manually. The product supports Amazon/RK World, Flipkart, and Blinkit-style documents with rule-based fallback when AI extraction is unavailable.

### Accept or reject a PO

Before accepting, check the PO ID, destination, warehouse, SKU lines, quantities, and shortage.

- Select **Accept** or **Accept PO** when the PO is correct.
- Select **Reject** when it should not be processed and provide a reason.

Acceptance starts the stock reservation gate. It does not reserve stock until the appointment gate is also complete.

## 5. PO full workspace

The full workspace opens when you select a PO row or **Open full PO workspace**.

### Overview tab

Shows channel, PO status, customer, destination, warehouse, PO value, fulfilment progress, source document, created and accepted times, inventory state, and next steps.

### Lines & Inventory tab

Each line shows:

- **Ordered**: customer-requested quantity.
- **Allocated**: quantity reserved from stock.
- **Blocked**: quantity held for the PO.
- **Planned**: quantity assigned to active shipment plans.
- **Dispatched**: quantity sent from the warehouse.
- **Delivered**: quantity confirmed on POD.
- **Remaining**: quantity not yet delivered.

### Appointment tab

Shows appointment ID, status, location, booking time, appointment time, and the attached document.

### Shipments tab

Shows each shipment number, truck, driver, planned dispatch time, expected arrival, cost, status, and POD state.

### POD & Discrepancies tab

Shows POD files, receiver details, confirmation time, and delivery information.

### Invoice tab

Shows invoice number, amount, and invoice file. The invoice gate remains closed until full delivery or approved short close.

### Audit Activity tab

Use **Audit Log** for the permanent event list for this PO.

## 6. Inventory

Inventory is a workspace with five tabs: **Stock**, **SKUs**, **Warehouses**, **Mappings**, and **UOMs & routes**.

### Stock tab

The stock table shows SKU, product name, warehouse, physical quantity, blocked quantity, in-transit quantity, released quantity, threshold, and allocatable quantity.

Use **Add stock** to enter an opening balance or manual receipt. Enter SKU, warehouse, optional location, quantity, and a reason. Use a clear reason such as `Opening stock` or `Supplier receipt`.

Use **History** to review stock transactions. Stock changes are posted as transactions; old ledger history is not edited directly.

### SKUs tab

Add or edit SKU code, product title, item class, and base UOM. The SKU is the internal product identity used by PO lines and inventory.

### Warehouses tab

Add or edit warehouse code, name, city, and state. Locations can be created under a warehouse with a code, name, and type such as warehouse, zone, rack, bin, quarantine, rejected, or return.

### Mappings tab

#### Channel SKU mapping

Connects a channel product identifier to an internal SKU.

Example: Amazon `B0CZTQBG78` -> internal SKU `NT-8906006351271`.

Enter channel, internal SKU, and external product code.

#### Destination mapping

Connects a channel destination to the source warehouse and stock location. Enter channel, destination key, destination name, warehouse, and source location.

### UOMs & routes tab

Create units of measure with code, name, and dimension. Create route estimates with warehouse, destination key, transit hours, and estimated cost.

## 7. Shipments

The Shipments page tracks truck-level movement.

### Plan a shipment manually

1. Confirm the PO has an accepted reservation and appointment.
2. Open **Shipments**.
3. Select **Plan shipment** for the PO.
4. Enter truck number, driver name, driver phone, and planned dispatch time.
5. Enter a quantity in **This shipment** for each SKU that belongs on this truck.
6. Leave other SKU quantities at zero.
7. Check **units selected for this shipment**.
8. Select **Create shipment**.

The modal shows the remaining quantity for each SKU. It starts all shipment quantities at zero. Create another shipment for the same PO when another truck is ready.

The system rejects a plan that exceeds the reserved quantity. It also keeps planned quantity visible so you do not accidentally plan the same stock twice.

### Dispatch a shipment

1. Find a shipment with status **PLANNED**.
2. Check the vehicle and planned lines.
3. Select **Dispatch**.

Dispatch moves the shipment quantity from blocked stock to in-transit stock.

### Confirm POD

1. Find a dispatched or in-transit shipment.
2. Select **Confirm POD**.
3. Upload the POD document.
4. Enter receiver and delivery time.
5. Enter delivered, short, damaged, and rejected quantities for each outstanding shipment line.
6. Save the POD.

The system checks the quantities against the outstanding dispatched quantity and updates PO delivery progress.

## 8. Appointments

Appointments are booked outside SCM. This page records the appointment after booking.

### Attach an appointment

1. Open **Appointments**.
2. Find a PO marked **Pending booking**.
3. Select **Attach appointment**.
4. Upload the appointment file.
5. Enter appointment ID, appointment time, and location.
6. Save.

The PO can reach reservation readiness when both appointment and acceptance are complete.

## 9. Invoices and short close

The Invoices page contains the delivery and closure queue.

### Upload an invoice

1. Open **Invoices**.
2. Find a PO marked **FULLY_DELIVERED** or **SHORT_CLOSED**.
3. Select **Upload invoice**.
4. Upload the invoice document.
5. Enter invoice number, invoice date, and amount.
6. Save.

Only one invoice is allowed for a PO.

### Short close a PO

Use short close when the remaining quantity will not be supplied.

1. Find a PO with a delivery issue or partial delivery.
2. Select **Short close**.
3. Enter the remaining quantity.
4. Enter the reason.
5. Select **Approve short close**.

Short close releases the remaining blocked stock and opens the invoice gate. It is an approval action and should be used only with a clear business reason.

## 10. Administration

Administration gives a compact view of platforms/channels, warehouses, and SKUs. Use the Inventory workspace for detailed master-data creation and editing.

## 11. Audit Log

The Audit Log shows recent permanent operational events: action, record type and record ID, user, and time.

Use it to answer who accepted a PO, changed a mapping, added stock, created a shipment, dispatched a truck, uploaded a POD, approved short close, or uploaded an invoice.

## 12. Common problems

### Warehouse shows “Mapping required”

Create or correct a destination mapping in **Inventory -> Mappings**.

### A PO line has no matching SKU

Create a Channel SKU mapping or select the internal SKU manually during PO review.

### Allocatable stock is lower than physical stock

Some stock may already be blocked, in transit, or protected by the threshold. Check the Stock tab and PO reservations.

### Shipment cannot be planned

Check that the PO has both an accepted reservation and an appointment, and that at least one line still has unplanned reserved quantity.

### Shipment quantity is rejected

The selected quantity is greater than the remaining reserved balance. Reduce the quantity or check earlier shipment plans.

### Invoice upload is unavailable

The PO must be fully delivered or approved for short close first.

### Document upload fails

Use PDF, XLSX, CSV, or DOCX and keep the file at or below 10 MB. Check that the file content matches its extension.

## 13. Good operating habits

- Review every extracted field before saving a PO.
- Use one internal SKU for one product.
- Maintain exact destination mappings.
- Check the warehouse before accepting a PO.
- Plan only the quantity physically assigned to each truck.
- Use a new shipment for every separate truck movement.
- Confirm POD quantities carefully.
- Enter clear reasons for stock changes and short close.
- Use Audit Log when investigating a change.

For architecture and implementation details, read [PRODUCT-DOC.md](PRODUCT-DOC.md).

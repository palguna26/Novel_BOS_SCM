# Novel SCM User Guide

This guide explains how to use the Novel SCM operations workspace. It covers the main pages, the data entered on each page, and the normal purchase-order journey from upload to invoice.

## 1. What the system does

Novel SCM keeps one record for each purchase order (PO). It connects:

- Purchase orders and their product lines
- Marketplace or channel information
- Warehouses and stock
- Delivery appointments
- Shipments and trucks
- Proof of delivery (POD)
- External invoices
- Audit history

The basic flow is:

```text
Upload PO -> Review PO -> Accept PO -> Book appointment -> Plan shipment
-> Dispatch -> Confirm POD -> Upload invoice -> Close
```

The system protects stock during this flow. Accepted PO quantities are blocked, dispatched quantities become in transit, and delivered quantities leave company stock only after POD confirmation.

## 2. Sign in

1. Open the SCM web address.
2. Enter your work email.
3. Enter your password.
4. Select **Sign in**.

Your access depends on your role. QC users are normally view-only. SCM team members, managers, and administrators can have different action permissions.

Use **Sign out** at the bottom of the left menu when finished.

## 3. Overview page

The Overview page is the daily starting point. It shows:

- **Awaiting review**: POs that need checking
- **Inventory blocked**: accepted POs holding stock
- **In transit**: shipments that are moving
- **Awaiting invoice**: delivered POs ready for invoice upload
- **Recent purchase orders**: the latest PO activity
- **Warehouse pulse**: available stock by warehouse and SKU

Select **Upload purchase order** to start a new PO.

## 4. PO Inbox

The PO Inbox is where POs are uploaded, reviewed, accepted, rejected, and opened for more detail.

### Upload a PO

1. Open **PO Inbox**.
2. Select **Upload purchase order**.
3. Choose a PDF, XLSX, CSV, or DOCX file.
4. Wait for the system to read the document.
5. Check the extracted fields and line items.
6. Correct anything that is wrong or missing.
7. Select **Save reviewed PO**.

Files must be 10 MB or smaller. The system may read fields automatically, but the user must check the result before saving.

### Important PO fields

- **Platform**: Amazon, Flipkart, Blinkit, or another sales channel
- **PO number**: the external PO reference
- **Destination**: where the customer expects the goods
- **Customer**: customer name, when supplied
- **Deadline**: the required date, when supplied
- **SKU**: the internal product code
- **Quantity**: how many units were ordered
- **Unit price**: price for one unit

### Review a PO

Select a PO row to open its detail view. Check:

- Destination and assigned warehouse
- PO value
- Product lines and quantities
- Inventory shortage, if any
- Source document
- Appointment, shipment, POD, and invoice progress

If the destination has no mapping, the warehouse will show **Mapping required**. Fix the mapping or use the permitted manager override before continuing.

### Accept or reject

- Select **Accept PO** when the information and stock check are correct. The system blocks the required inventory.
- Select **Reject** when the PO should not be processed. Enter a reason.

Do not accept a PO until its destination, SKU, quantity, and warehouse are correct.

## 5. PO detail page

The PO detail page has these tabs:

### Overview

Shows the source document, creation time, acceptance time, inventory state, and next steps.

### Lines & Inventory

Shows each SKU and its quantities:

- **Ordered**: quantity requested by the customer
- **Allocated**: quantity assigned from stock
- **Blocked**: allocated stock held for this PO
- **Dispatched**: quantity sent from the warehouse
- **Delivered**: quantity confirmed by POD
- **Remaining**: ordered quantity not yet delivered

### Appointment

Shows appointment ID, status, location, booking time, appointment time, and attached document.

### Shipments

Shows shipment number, truck, driver, dispatch time, expected arrival, cost, and POD status.

### POD & Discrepancies

Shows uploaded delivery documents and receiver information. Use this area to check whether the delivery was confirmed.

### Invoice

Shows invoice number, amount, and invoice file. Invoice upload is available only after full delivery or an approved short close.

### Audit Activity

Shows where to find the permanent record of actions in **Audit Log**.

## 6. Inventory page

The Inventory page has five areas: **Stock**, **SKUs**, **Warehouses**, **Mappings**, and **UOMs & routes**.

### Stock

The Stock area shows stock by SKU and warehouse:

- **Physical**: stock physically recorded at the warehouse
- **Blocked**: stock reserved for accepted POs
- **Allocatable**: stock still available to use

Select **Adjust stock** to add stock. Enter:

- SKU
- Warehouse
- Optional location
- Quantity
- Reason

Always enter a clear reason, such as `Opening stock`, `Cycle count correction`, or `Supplier receipt`.

Select **History** to see stock transactions. Stock history should be corrected through a new transaction, not by changing old history.

### SKUs

An SKU is the internal code for a product. Add or edit:

- SKU code
- Product title
- Item class, such as FG, RM, PM, or KIT
- Base unit of measure

Use one consistent SKU for the same product. This is what connects PO lines to inventory.

### Warehouses

Add or edit:

- Warehouse code
- Warehouse name
- City
- State

You can also add warehouse locations. A location has a code, name, warehouse, and type such as warehouse, zone, rack, bin, quarantine, rejected, or return.

### Mappings

Mapping tells the system that two names refer to the same thing.

#### Channel SKU mapping

Connects an external marketplace product code to an internal SKU.

Example: `AMZ-123` on Amazon = internal SKU `KB-001`.

Enter:

- Mapping type: **Channel SKU**
- Channel
- Internal SKU
- External product code

#### Destination mapping

Connects a marketplace destination to the warehouse and source location that should fulfil it.

Example: `Bengaluru FC` -> Bengaluru Warehouse -> Stock location.

Enter:

- Mapping type: **Destination**
- Channel
- Destination key
- Destination name
- Warehouse
- Source location

Good mappings help the system assign the correct warehouse automatically when a PO is uploaded.

### UOMs & routes

#### Units of measure (UOMs)

Add a code, name, and dimension. Examples are `EA` for each, `KG` for weight, or `L` for length.

#### Route estimates

Add the warehouse, destination key, transit hours, and estimated cost. These values help the team plan movement and expected arrival.

## 7. Shipments page

The Shipments page tracks truck-level movement.

### Plan a shipment

1. Confirm that the PO has an accepted reservation and appointment.
2. Select **Plan** for the ready PO.
3. Enter truck number.
4. Enter driver name and phone.
5. Enter planned dispatch time.
6. Check the reserved quantity.
7. Select **Create shipment**.

### Dispatch

For a planned shipment, select **Dispatch**. The system moves the dispatched quantity into in-transit stock.

### Confirm delivery

When the truck has delivered, select **Confirm POD**. Upload the POD document and enter:

- Receiver
- Delivery time

The system uses the delivery confirmation to update delivered quantities and remove delivered stock from company inventory.

## 8. Appointments page

Appointments are booked outside this system. This page records the appointment information after booking.

1. Open **Appointments**.
2. Find the PO marked **Pending booking**.
3. Select **Attach appointment**.
4. Upload the appointment document.
5. Enter appointment ID, appointment time, and location when needed.
6. Save the record.

The appointment is then visible on the PO detail page.

## 9. Invoices page

Invoices are created outside SCM and uploaded here after delivery.

### Upload an invoice

1. Open **Invoices**.
2. Find a PO marked **Fully delivered** or **Short closed**.
3. Select **Upload invoice**.
4. Choose the invoice file.
5. Enter invoice number, invoice date, and amount.
6. Select the upload action.

The invoice is linked to the PO. One external invoice is expected per PO.

### Short close

Use **Short close** when the PO will not be fully delivered but the remaining quantity is accepted as closed.

Enter:

- Remaining quantity
- Reason

Short close approval is a manager-level action. It should only be used with a clear business reason.

## 10. Administration page

Administration shows controlled master data used by the operation:

- Platforms or channels
- Warehouses
- SKUs

Use the Inventory page for the detailed setup of SKUs, warehouses, locations, mappings, UOMs, and routes. Administrators maintain this data so normal users can process POs consistently.

## 11. Audit Log

The Audit Log is the permanent history of important actions. It shows:

- Action performed
- Record type and record ID
- User
- Time

Use it to answer questions such as:

- Who accepted or rejected a PO?
- Who changed master data?
- Who adjusted stock?
- Who approved a short close?
- When was a POD or invoice uploaded?

Audit history is for traceability. It should not be treated as a normal editable list.

## 12. Normal daily workflow

### New PO

1. Upload the PO in **PO Inbox**.
2. Review the extracted information.
3. Confirm SKU mappings and destination mapping.
4. Check warehouse and inventory.
5. Accept or reject the PO.

### Before dispatch

1. Attach the appointment letter.
2. Confirm the appointment details.
3. Open **Shipments**.
4. Plan the truck and driver.
5. Dispatch the shipment.

### After delivery

1. Upload and confirm the POD.
2. Check delivered and remaining quantities.
3. If fully delivered, upload the invoice.
4. If the remainder will not be supplied, request an approved short close.
5. Upload the invoice after short close approval.

## 13. Common problems

### Warehouse shows “Mapping required”

The destination is not connected to a warehouse. Add or correct a destination mapping in **Inventory -> Mappings**.

### A PO line does not match inventory

The external product code may not be mapped to the correct internal SKU. Add a **Channel SKU** mapping, then review the PO again.

### Allocatable stock is lower than physical stock

Some stock may already be blocked, or the system may be protecting threshold stock. Check the Stock tab and the PO reservations.

### Shipment cannot be planned

The PO may not have an accepted inventory reservation, an appointment, or any remaining allocated quantity.

### Invoice upload is unavailable

The PO must be fully delivered or approved for short close first.

### A document will not upload

Check that the file is PDF, XLSX, CSV, or DOCX and is no larger than 10 MB.

## 14. Good data-entry habits

- Use the same SKU code everywhere.
- Use exact marketplace destination names in mappings.
- Enter reasons for stock changes and short closes.
- Check extracted documents before saving.
- Do not create duplicate mappings for the same channel and product.
- Do not accept a PO with the wrong warehouse or quantity.
- Confirm POD quantities carefully before uploading the invoice.
- Use Audit Log when investigating a change.

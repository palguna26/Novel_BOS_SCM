# Address-Based Warehouse Resolution Design

## Goal

Use appointment-document addresses as the source of truth for warehouse and destination resolution instead of destination keys and manually maintained destination mappings.

## Extraction

Appointment and PO extraction should retain the original document text and extract as much meaningful structured data as available:

- Full source and destination addresses
- City, state, postal code, and country
- Facility or warehouse name and code
- Appointment number, date, time, status, slot, and reporting instructions
- PO number, channel, supplier, customer, contacts, and document references
- Quantities, cartons, SKU/product identifiers, and logistics metadata
- Confidence, warnings, and unmatched or conflicting fields

Missing values are left null. The system must not invent data.

## Resolution

- Normalize city names and common variants such as Bangalore/Bengaluru, Gurgaon/Gurugram, and Mysore/Mysuru.
- Match the source address city to `master_data.sites.city` for warehouse resolution.
- Resolve destination to a normalized city record without requiring a destination key.
- Use source warehouse city and destination city for route and transit-time lookup.
- Preserve the raw extracted addresses alongside normalized values.
- If there is no match or multiple plausible matches, mark the record for address review instead of silently assigning it.

## Display

Show full source and destination addresses in PO, Appointment, Shipment, and relevant detail views. Show the normalized city and matched warehouse separately so users can see both the original document value and the system resolution.

## Compatibility

Existing destination-key mappings should no longer be required for new appointment-based workflows. Existing records may remain readable, but new resolution should prefer appointment addresses and city matching.

## Validation

- Add extraction and normalization tests for address variants and missing/ambiguous data.
- Verify warehouse and route resolution from appointment addresses.
- Verify unresolved addresses create a visible review state.
- Verify full addresses are returned by the API and rendered in the relevant UI.
- Build API and web applications.

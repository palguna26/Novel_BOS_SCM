# SCM Schema Details for the Sales Module

Version: SCM v2 clean-rebuild design  
Prepared: 3 October 2026  
Audience: Sales-module, reporting, integration and data teams

## 1. Purpose

This file explains where the sales module should read SCM data. It covers customers, channels, products, channel purchase orders, acceptance, appointments, inventory, reservations, shipments, proof of delivery, delivery issues, invoices, demand and forecasts.

The sales module should treat SCM as the owner of fulfilment and inventory facts. Sales may store its own customer activity, leads, opportunities, targets and internal sales workflow, but it should reference SCM records by their UUID keys.

## 2. Important deployment note

Two database models currently exist:

| Model | Location | Current use |
|---|---|---|
| Existing MVP | public schema | The current NestJS API still reads and writes these tables |
| SCM v2 | Namespaced schemas described below | The approved clean-rebuild model, ready for controlled migration and API cutover |

The v2 migrations are additive. They do not delete or rename the current public tables.

For a new sales integration:

- Build the long-term contract against SCM v2.
- Use the compat schema only when old field names are needed.
- Do not write directly to SCM tables.
- Confirm which database environment has completed the v2 cutover before connecting.
- Always include company_id in reads and data exchanges.

## 3. Main sales data flow

    master_data.companies
      |
      +-- master_data.channels
      +-- master_data.customers
      +-- master_data.items
      +-- master_data.sites and locations
      |
      +-- scm.purchase_orders
            |
            +-- scm.purchase_order_lines
            +-- scm.acceptance_decisions
            +-- scm.appointments
            +-- inventory.reservations
            |     +-- inventory.reservation_lines
            |           +-- inventory.reservation_allocations
            +-- scm.shipments
            |     +-- scm.shipment_lines
            |     +-- scm.shipment_events
            +-- scm.pods
            |     +-- scm.pod_shipment_links
            |     +-- scm.pod_lines
            +-- scm.delivery_exceptions
            +-- scm.short_close_decisions
            +-- scm.invoices

Inventory availability comes from inventory.inventory_summary_v. It is calculated from the immutable inventory ledger, not from an editable balance table.

## 4. Rules the sales team must preserve

1. Acceptance and appointment matching are separate events.
2. Either event may happen first.
3. Inventory reservation happens only after both events are complete.
4. One PO may have many lines, shipments and PODs.
5. One POD may cover several shipments.
6. Only POD-confirmed quantity is delivered quantity.
7. Short, damaged and rejected quantities remain delivery issues until resolved.
8. Short close is an approved business decision. It is not the same as full delivery.
9. Inventory movements and audit events are append-only.
10. Reversals are new records. Existing ledger rows must not be changed.

## 5. Common conventions

| Convention | Meaning |
|---|---|
| id | UUID primary key for the record |
| company_id | Tenant and security boundary; required on operational records |
| item_id | Internal product key |
| channel_id | Marketplace or sales-channel key |
| site_id | Warehouse, plant, marketplace, customer or transit node |
| location_id | Warehouse, zone, rack, bin or virtual stock location |
| purchase_order_id | SCM channel purchase-order key |
| numeric(18,6) | Standard quantity precision |
| numeric(18,4) | Standard money precision where higher costing precision is not required |
| timestamptz | Timestamp with timezone; store and exchange as ISO 8601 |
| active | Current usable master or current version flag |

Unless stated otherwise, all joins use UUID keys. Do not join records by display names.

## 6. Best sources for the sales module

| Sales need | Preferred source | Main keys |
|---|---|---|
| Company | master_data.companies | id |
| Channel or marketplace | master_data.channels | id, company_id |
| Customer | master_data.customers | id, company_id |
| Product or SKU | master_data.items | id, company_id |
| Channel product code | master_data.item_identifiers | item_id, channel_id |
| Channel rules | master_data.channel_policies | channel_id, item_id |
| Warehouse | master_data.sites | id, company_id |
| PO header | scm.purchase_orders | id, company_id, channel_id |
| PO lines | scm.purchase_order_lines | purchase_order_id, item_id |
| Acceptance and appointment gates | scm.po_gate_state_v | purchase_order_id |
| Reservation and shortage | inventory.reservations and reservation_lines | purchase_order_id, purchase_order_line_id |
| Current inventory | inventory.inventory_summary_v | company_id, site_id, item_id, uom_id |
| Batch inventory | inventory.stock_balance_v | location_id, item_id, batch_id, stock_state |
| Shipment status | scm.shipments and shipment_lines | purchase_order_id, shipment_id |
| Delivery confirmation | scm.pods and pod_lines | purchase_order_id, shipment_line_id |
| Delivery problems | scm.delivery_exceptions | purchase_order_id, shipment_id |
| Short close | scm.short_close_decisions | purchase_order_id |
| Invoice | scm.invoices | purchase_order_id |
| Daily sales and stock history | planning.demand_observations | observation_date, channel_id, item_id |
| Forecast | planning.forecasts | period_start, channel_id, item_id |
| Inventory value | finance.valuation_ledger | site_id, item_id, posting_at |

## 7. Detailed sales-facing schema reference

Legend:

- Required means the value cannot be null.
- Generated means the database calculates the value.
- JSON means the value is JSONB.

### 7.1 master_data.companies

Company and legal entity master.

| Column | Type | Required | Notes |
|---|---|---:|---|
| id | uuid | Yes | Primary key |
| code | text | Yes | Unique company code |
| legal_name | text | Yes | Legal company name |
| gstin | text | No | GST registration |
| pan | text | No | PAN |
| base_currency | char(3) | Yes | Default INR |
| active | boolean | Yes | Default true |
| created_at | timestamptz | Yes | Server timestamp |
| updated_at | timestamptz | Yes | Server timestamp |

### 7.2 master_data.channels

Marketplace, quick-commerce, D2C, distributor, B2B or retail channel.

| Column | Type | Required | Notes |
|---|---|---:|---|
| id | uuid | Yes | Primary key |
| company_id | uuid | Yes | Company owner |
| code | text | Yes | Unique inside company |
| name | text | Yes | Display name |
| channel_type | text | Yes | MARKETPLACE, QUICK_COMMERCE, D2C, DISTRIBUTOR, B2B or RETAIL |
| ingestion_method | text | Yes | API, FILE, PORTAL_EXPORT or MANUAL |
| active | boolean | Yes | Current channel flag |
| created_at | timestamptz | Yes | Server timestamp |
| updated_at | timestamptz | Yes | Server timestamp |

### 7.3 master_data.customers

Customer master used when the PO can be linked to a controlled customer record.

| Column | Type | Required | Notes |
|---|---|---:|---|
| id | uuid | Yes | Primary key |
| company_id | uuid | Yes | Company owner |
| code | text | Yes | Unique inside company |
| name | text | Yes | Customer name |
| gstin | text | No | GST registration |
| active | boolean | Yes | Current customer flag |

### 7.4 master_data.items

Internal product and SKU master. Sales should use item_id as the product key.

| Column | Type | Required | Notes |
|---|---|---:|---|
| id | uuid | Yes | Primary key |
| company_id | uuid | Yes | Company owner |
| code | text | Yes | Internal item code, unique inside company |
| legacy_code | text | No | Previous system code |
| name | text | Yes | Product name |
| item_class | text | Yes | FG, SFG, RM, PM, CONSUMABLE, SPARE or KIT |
| brand | text | No | Brand |
| category | text | No | Category |
| variant | text | No | Product variant |
| base_uom_id | uuid | Yes | Links to master_data.uoms |
| hsn_code | text | No | HSN code |
| gst_rate | numeric(7,4) | Yes | Percentage, default 0 |
| shelf_life_days | integer | No | Product shelf life |
| batch_controlled | boolean | Yes | Whether batch is required |
| serial_controlled | boolean | Yes | Whether serial tracking is required |
| make_or_buy | text | No | MAKE, BUY or BOTH |
| lead_time_days | numeric(10,2) | Yes | Planning lead time |
| minimum_order_qty | numeric(18,6) | Yes | MOQ |
| order_multiple | numeric(18,6) | Yes | Required order multiple |
| abc_class | char(1) | No | A, B or C |
| xyz_class | char(1) | No | X, Y or Z |
| fsn_class | char(1) | No | F, S or N |
| lifecycle_status | text | Yes | DRAFT, PENDING_APPROVAL, ACTIVE, ON_HOLD, INACTIVE or OBSOLETE |
| active_from | date | No | Start date |
| active_to | date | No | End date |
| created_at | timestamptz | Yes | Server timestamp |
| updated_at | timestamptz | Yes | Server timestamp |

Related product tables:

| Table | Use |
|---|---|
| master_data.item_identifiers | EAN, GTIN, UPC, legacy, barcode and channel SKU mappings |
| master_data.item_uom_conversions | Exact item-specific unit conversion |
| master_data.item_mrp_history | Effective-dated MRP history |
| master_data.channel_policies | Shelf-life, appointment, PDI, packaging, labels and SLA rules |

### 7.5 master_data.sites and locations

Sites describe business nodes. Locations describe the stock hierarchy or a virtual location.

master_data.sites fields:

| Column | Type | Required | Notes |
|---|---|---:|---|
| id | uuid | Yes | Primary key |
| company_id | uuid | Yes | Company owner |
| code | text | Yes | Site code |
| name | text | Yes | Site name |
| site_type | text | Yes | WAREHOUSE, PLANT, OFFICE, VENDOR, CUSTOMER, MARKETPLACE or TRANSIT |
| city | text | No | City |
| state | text | No | State |
| country_code | char(2) | Yes | Default IN |
| timezone | text | Yes | Default Asia/Kolkata |
| active | boolean | Yes | Current site flag |

master_data.locations fields:

| Column | Type | Required | Notes |
|---|---|---:|---|
| id | uuid | Yes | Primary key |
| company_id | uuid | Yes | Company owner |
| site_id | uuid | Yes | Parent site |
| parent_location_id | uuid | No | Location hierarchy |
| code | text | Yes | Unique within site |
| name | text | Yes | Location name |
| location_type | text | Yes | Physical or virtual location type |
| barcode | text | No | Scan code |
| virtual | boolean | Yes | True for transit, customer and accounting locations |
| active | boolean | Yes | Current location flag |

Use master_data.destination_mappings to resolve a channel destination to the source site and source location.

### 7.6 scm.purchase_orders

Channel purchase-order header and the main record for sales fulfilment reporting.

| Column | Type | Required | Notes |
|---|---|---:|---|
| id | uuid | Yes | Primary key |
| company_id | uuid | Yes | Company owner |
| channel_id | uuid | Yes | Links to master_data.channels |
| external_id | text | Yes | Marketplace or customer PO number |
| po_date | timestamptz | Yes | Source PO date |
| deadline | timestamptz | No | Delivery or fulfilment deadline |
| destination_key | text | Yes | Mapping key from source document |
| destination_name | text | Yes | Display destination |
| customer_id | uuid | No | Controlled customer link |
| customer_name | text | No | Source customer text when no master link exists |
| source_site_id | uuid | No | Assigned warehouse or source site |
| source_location_id | uuid | No | Assigned source location |
| currency | char(3) | Yes | Default INR |
| total_value | numeric(18,4) | Yes | PO value |
| status | text | Yes | Current operational summary status |
| source_document_version_id | uuid | No | Original PO document version |
| created_by | uuid | No | User who created the record |
| created_at | timestamptz | Yes | Server timestamp |
| updated_at | timestamptz | Yes | Server timestamp |

Unique business key: company_id + channel_id + external_id.

Do not use status alone to decide whether the PO is accepted or appointed. Use scm.po_gate_state_v for those independent facts.

### 7.7 scm.purchase_order_lines

Ordered products, price, tax, delivery window and channel shelf-life requirement.

| Column | Type | Required | Notes |
|---|---|---:|---|
| id | uuid | Yes | Primary key |
| company_id | uuid | Yes | Company owner |
| purchase_order_id | uuid | Yes | PO header |
| line_number | integer | Yes | Unique within PO |
| item_id | uuid | Yes | Internal product |
| channel_item_code | text | No | Channel product code from PO |
| description | text | No | Source description |
| ordered_quantity | numeric(18,6) | Yes | Ordered quantity |
| uom_id | uuid | Yes | Unit of measure |
| unit_price | numeric(18,4) | Yes | Unit price |
| tax_rate | numeric(7,4) | Yes | Tax percentage |
| delivery_window_start | timestamptz | No | Earliest delivery |
| delivery_window_end | timestamptz | No | Latest delivery |
| minimum_residual_shelf_life_days | integer | Yes | Minimum shelf life at allocation |
| created_at | timestamptz | Yes | Server timestamp |

Line value before tax is ordered_quantity multiplied by unit_price.

### 7.8 Acceptance and appointment

scm.acceptance_decisions keeps every decision version.

| Important column | Meaning |
|---|---|
| purchase_order_id | PO being decided |
| decision | ACCEPTED, REJECTED or CANCELLED |
| reason | Required for rejection |
| decided_by and decided_at | Decision owner and server time |
| supersedes_decision_id | Previous decision version |
| active | Current decision flag |

scm.appointments keeps every appointment version.

| Important column | Meaning |
|---|---|
| purchase_order_id | PO being appointed |
| appointment_number | Channel appointment reference |
| booking_at | Booking timestamp |
| appointment_at | Delivery appointment timestamp |
| location_name | Appointment location |
| destination_code | Channel destination code |
| status | Booking lifecycle |
| match_status | PENDING, MATCHED, MISMATCHED or WAIVED |
| match_details | JSON comparison details |
| supersedes_appointment_id | Previous version |
| active | Current appointment flag |

scm.po_gate_state_v is the easiest sales read:

| Column | Meaning |
|---|---|
| purchase_order_id | PO key |
| company_id | Company key |
| acceptance_complete | Current decision is accepted |
| appointment_complete | Current appointment is matched or approved as waived |
| ready_for_reservation | Both gates are complete |
| accepted_at | Acceptance timestamp |
| appointment_id | Current appointment |
| appointment_at | Appointment timestamp |

### 7.9 Reservations and shortage

inventory.reservations is the reservation header.

| Important column | Meaning |
|---|---|
| purchase_order_id | Reserved PO |
| version | Reservation version |
| status | ACTIVE, PARTIALLY_DISPATCHED, FULFILLED, RELEASED, CANCELLED or SUPERSEDED |
| source_site_id and source_location_id | Stock source |
| stock_transaction_id | Ledger reservation transaction |
| created_at | Reservation timestamp |

inventory.reservation_lines contains the result for each PO line.

| Column | Type | Meaning |
|---|---|---|
| purchase_order_line_id | uuid | PO line |
| required_quantity | numeric(18,6) | Quantity requested by reservation |
| reserved_quantity | numeric(18,6) | Quantity reserved |
| shortage_quantity | numeric(18,6) | Generated required minus reserved, floored at zero |
| uom_id | uuid | Quantity unit |

inventory.reservation_allocations provides batch and location detail. Its quantity is the original reserved quantity. dispatched_quantity and released_quantity show how the reservation was consumed.

### 7.10 Inventory views

Use inventory.inventory_summary_v for sales availability.

| Column | Type | Meaning |
|---|---|---|
| company_id | uuid | Company |
| site_id | uuid | Warehouse or site |
| item_id | uuid | Product |
| uom_id | uuid | Unit |
| physical | numeric(18,6) | On-hand stock at internal locations |
| blocked | numeric(18,6) | Reserved stock not yet dispatched |
| in_transit | numeric(18,6) | Dispatched stock still owned by the company |
| released | numeric(18,6) | QC-released stock at internal locations |
| threshold | numeric(18,6) | Protected stock level |
| allocatable | numeric(18,6) | Maximum of released minus threshold and zero |

Use inventory.stock_balance_v only when batch, location or quality state is required.

| Column | Meaning |
|---|---|
| location_id | Exact physical or virtual stock location |
| item_id | Product |
| batch_id | Batch, when controlled |
| stock_state | RELEASED, RESERVED, QUARANTINE, UNDER_TEST, CONDITIONAL_RELEASE, ON_HOLD, MRB, REJECTED, RETURN_TO_VENDOR, IN_TRANSIT, DELIVERED, SCRAP or RETENTION |
| quantity | Current ledger-derived quantity |
| value | Current ledger-derived value |

Do not calculate availability directly from inventory.stock_ledger_entries unless a ledger audit is required.

### 7.11 scm.shipments

Shipment header. One PO may have many shipments.

| Column | Type | Required | Notes |
|---|---|---:|---|
| id | uuid | Yes | Primary key |
| shipment_number | text | Yes | System shipment number |
| purchase_order_id | uuid | Yes | PO header |
| reservation_id | uuid | Yes | Source reservation |
| appointment_id | uuid | Yes | Matched appointment |
| source_site_id | uuid | Yes | Source warehouse |
| source_location_id | uuid | Yes | Source location |
| transit_location_id | uuid | Yes | Virtual in-transit location |
| destination_name | text | Yes | Delivery destination |
| transporter_id | uuid | No | Transporter master |
| truck_number | text | No | Vehicle number |
| truck_type | text | No | Vehicle type |
| truck_capacity | numeric(18,6) | No | Vehicle capacity |
| driver_name | text | No | Driver name |
| driver_phone | text | No | Restricted contact data |
| status | text | Yes | Shipment lifecycle |
| planned_dispatch_at | timestamptz | No | Planned departure |
| expected_arrival_at | timestamptz | No | Expected arrival |
| actual_dispatch_at | timestamptz | No | Actual departure |
| actual_arrival_at | timestamptz | No | Actual arrival |
| estimated_cost | numeric(18,4) | Yes | Planned logistics cost |
| actual_cost | numeric(18,4) | No | Actual logistics cost |
| currency | char(3) | Yes | Cost currency |
| route_snapshot | JSON | Yes | Route values copied at shipment creation |
| lr_document_version_id | uuid | No | LR or transport document |
| created_at and updated_at | timestamptz | Yes | Server timestamps |

scm.shipment_lines fields:

| Column | Meaning |
|---|---|
| purchase_order_line_id | PO line being shipped |
| reservation_line_id | Reservation source |
| planned_quantity | Planned truck quantity |
| dispatched_quantity | Quantity moved to transit |
| delivered_quantity | POD-confirmed quantity |
| damaged_quantity | Quantity marked damaged |
| rejected_quantity | Quantity rejected at delivery |
| uom_id | Quantity unit |

scm.shipment_events stores chronological status, event time, location and notes. scm.shipment_checks stores PDI, barcode, case-label, shipper-marking, MRP and ASN-quantity results.

### 7.12 POD and delivery issues

scm.pods fields:

| Column | Meaning |
|---|---|
| purchase_order_id | PO delivered |
| document_version_id | Immutable POD file version |
| delivery_at | Source delivery timestamp |
| receiver_name | Receiver |
| status | DRAFT, CONFIRMED, REPLACED or REVERSED |
| replaces_pod_id | Previous POD version |
| confirmed_by and confirmed_at | Confirmation owner and time |
| stock_transaction_id | Delivery ledger transaction |

scm.pod_shipment_links handles a POD that covers one or more shipments.

scm.pod_lines fields:

| Column | Meaning |
|---|---|
| shipment_line_id | Shipment product line |
| confirmed_quantity | Accepted delivery quantity |
| short_quantity | Missing quantity |
| damaged_quantity | Damaged quantity |
| rejected_quantity | Rejected quantity |
| difference_reason | Difference code or reason |
| notes | Free-text detail |

scm.delivery_exceptions fields:

| Column | Meaning |
|---|---|
| purchase_order_id | Affected PO |
| shipment_id | Affected shipment, when known |
| pod_line_id | Source POD line, when known |
| exception_type | SHORT, DAMAGED, REJECTED, MISSING_POD, MISMATCH or OTHER |
| quantity | Affected quantity |
| reason | Required problem description |
| status | OPEN, INVESTIGATING, RESOLVED, SHORT_CLOSED, CLAIMED or CANCELLED |
| owner_id | Exception owner |
| resolution | Resolution detail |
| resolved_by and resolved_at | Resolution owner and time |

### 7.13 Short close and invoice

scm.short_close_decisions stores an approved or rejected short-close decision.

| Important column | Meaning |
|---|---|
| purchase_order_id | PO being closed short |
| remaining_quantity | Unfulfilled order quantity |
| reason | Required business reason |
| status | PENDING, APPROVED, REJECTED or REVERSED |
| approved_by and approved_at | Approver and time |
| release_stock_transaction_id | Ledger release of remaining blocked stock |

scm.invoices stores one external channel invoice per PO.

| Column | Type | Required | Notes |
|---|---|---:|---|
| id | uuid | Yes | Primary key |
| company_id | uuid | Yes | Company owner |
| purchase_order_id | uuid | Yes | Unique PO link |
| invoice_number | text | Yes | Unique inside company |
| invoice_date | date | Yes | Invoice date |
| amount | numeric(18,4) | Yes | Invoice amount |
| currency | char(3) | Yes | Default INR |
| document_version_id | uuid | Yes | Invoice file |
| recipients | JSON | Yes | Delivery recipients |
| send_status | text | Yes | PENDING, SENDING, SENT, FAILED or DEAD_LETTER |
| sent_at | timestamptz | No | Successful send time |
| error | text | No | Latest delivery error |
| uploaded_by | uuid | No | User |
| uploaded_at | timestamptz | Yes | Server timestamp |

Invoice upload is allowed only when the PO is FULLY_DELIVERED or SHORT_CLOSED.

### 7.14 Demand and forecast data

planning.demand_observations is the daily sales and stock history by channel, item and optional site.

| Column | Meaning |
|---|---|
| observation_date | Business date |
| channel_id | Sales channel |
| site_id | FC or node, when known |
| item_id | Product |
| sales_quantity | Observed sales |
| stock_quantity | Observed closing stock |
| stockout_days | Lost-sales indicator |
| listing_suppressed | Channel listing was unavailable |
| price | Observed price |
| promotion_flag | Promotion was active |
| event_tags | JSON event labels |

planning.forecasts is the signed planning output by period, channel, item and optional site.

| Column | Meaning |
|---|---|
| forecast_run_id | Forecast version |
| period_start | Forecast period |
| channel_id | Sales channel |
| site_id | Node, when planned at node level |
| item_id | Product |
| statistical_quantity | Model output |
| override_quantity | Approved business override |
| final_quantity | Quantity used by planning |
| override_reason | Reason for override |
| wmape | Weighted forecast error |
| bias | Forecast bias |

Only use forecasts from a run whose status is SIGNED_OFF unless the screen is explicitly showing work in progress.

## 8. Status values

### 8.1 PO status

UPLOADED, EXTRACTION_REVIEW_REQUIRED, WAREHOUSE_MAPPING_REQUIRED, UNDER_REVIEW, ACCEPTANCE_PENDING, APPOINTMENT_PENDING, ACCEPTED_AWAITING_APPOINTMENT, APPOINTMENT_MATCHED_AWAITING_ACCEPTANCE, READY_FOR_RESERVATION, INVENTORY_SHORTAGE, INVENTORY_BLOCKED, SHIPMENT_PLANNING, PARTIALLY_DISPATCHED, FULLY_DISPATCHED, PARTIALLY_DELIVERED, DELIVERY_ISSUE, FULLY_DELIVERED, SHORT_CLOSED, INVOICE_UPLOADED, CLOSED, REJECTED, CANCELLED, ON_HOLD.

### 8.2 Shipment status

PLANNED, VEHICLE_ASSIGNED, LOADING, DISPATCHED, IN_TRANSIT, ARRIVED, UNLOADING, PARTIALLY_DELIVERED, DELIVERED, DELIVERY_ISSUE, RETURNED, CANCELLED.

### 8.3 Reservation status

ACTIVE, PARTIALLY_DISPATCHED, FULFILLED, RELEASED, CANCELLED, SUPERSEDED.

### 8.4 Quality and stock states

RELEASED, RESERVED, QUARANTINE, UNDER_TEST, CONDITIONAL_RELEASE, ON_HOLD, MRB, REJECTED, RETURN_TO_VENDOR, IN_TRANSIT, DELIVERED, SCRAP, RETENTION.

## 9. Calculations for sales screens

Use these definitions consistently:

    Line value before tax = ordered_quantity * unit_price

    Available = physical - blocked

    Allocatable = max(released - threshold, 0)

    Reservation shortage = required_quantity - reserved_quantity

    PO open quantity = ordered quantity - delivered quantity - approved short-close quantity

    Shipment outstanding = dispatched quantity - delivered quantity - damaged quantity - rejected quantity

    Fill rate = delivered quantity / ordered quantity

Do not treat planned shipment quantity as dispatched quantity. Do not treat dispatched quantity as delivered quantity.

## 10. Recommended read queries

Every query below uses a company parameter. Keep that filter in every production query.

### 10.1 PO pipeline summary

    select
      po.id as purchase_order_id,
      po.external_id,
      po.po_date,
      po.deadline,
      c.code as channel_code,
      c.name as channel_name,
      coalesce(cu.name, po.customer_name) as customer_name,
      po.destination_name,
      s.code as source_site_code,
      s.name as source_site_name,
      po.currency,
      po.total_value,
      po.status,
      gate.acceptance_complete,
      gate.appointment_complete,
      gate.accepted_at,
      gate.appointment_at,
      coalesce(q.ordered_quantity, 0) as ordered_quantity,
      coalesce(q.reserved_quantity, 0) as reserved_quantity,
      coalesce(q.shortage_quantity, 0) as shortage_quantity,
      coalesce(ship.dispatched_quantity, 0) as dispatched_quantity,
      coalesce(ship.delivered_quantity, 0) as delivered_quantity,
      inv.invoice_number,
      inv.amount as invoice_amount,
      inv.send_status as invoice_send_status
    from scm.purchase_orders po
    join master_data.channels c on c.id = po.channel_id
    left join master_data.customers cu on cu.id = po.customer_id
    left join master_data.sites s on s.id = po.source_site_id
    left join scm.po_gate_state_v gate on gate.purchase_order_id = po.id
    left join lateral (
      select
        sum(pol.ordered_quantity) as ordered_quantity,
        sum(coalesce(rl.reserved_quantity, 0)) as reserved_quantity,
        sum(coalesce(rl.shortage_quantity, 0)) as shortage_quantity
      from scm.purchase_order_lines pol
      left join inventory.reservation_lines rl
        on rl.purchase_order_line_id = pol.id
       and rl.reservation_id = (
         select r.id
         from inventory.reservations r
         where r.purchase_order_id = po.id
         order by r.version desc
         limit 1
       )
      where pol.purchase_order_id = po.id
    ) q on true
    left join lateral (
      select
        sum(sl.dispatched_quantity) as dispatched_quantity,
        sum(sl.delivered_quantity) as delivered_quantity
      from scm.shipments sh
      join scm.shipment_lines sl on sl.shipment_id = sh.id
      where sh.purchase_order_id = po.id
        and sh.status <> 'CANCELLED'
    ) ship on true
    left join scm.invoices inv on inv.purchase_order_id = po.id
    where po.company_id = $1
    order by po.created_at desc;

### 10.2 PO line fulfilment

    select
      po.external_id,
      pol.id as purchase_order_line_id,
      pol.line_number,
      i.code as item_code,
      i.name as item_name,
      pol.channel_item_code,
      u.code as uom,
      pol.ordered_quantity,
      coalesce(r.reserved_quantity, 0) as reserved_quantity,
      coalesce(r.shortage_quantity, 0) as shortage_quantity,
      coalesce(sh.planned_quantity, 0) as planned_quantity,
      coalesce(sh.dispatched_quantity, 0) as dispatched_quantity,
      coalesce(sh.delivered_quantity, 0) as delivered_quantity,
      greatest(pol.ordered_quantity - coalesce(sh.delivered_quantity, 0), 0) as remaining_quantity
    from scm.purchase_order_lines pol
    join scm.purchase_orders po on po.id = pol.purchase_order_id
    join master_data.items i on i.id = pol.item_id
    join master_data.uoms u on u.id = pol.uom_id
    left join lateral (
      select rl.reserved_quantity, rl.shortage_quantity
      from inventory.reservation_lines rl
      join inventory.reservations rh on rh.id = rl.reservation_id
      where rl.purchase_order_line_id = pol.id
      order by rh.version desc
      limit 1
    ) r on true
    left join lateral (
      select
        sum(sl.planned_quantity) as planned_quantity,
        sum(sl.dispatched_quantity) as dispatched_quantity,
        sum(sl.delivered_quantity) as delivered_quantity
      from scm.shipment_lines sl
      join scm.shipments s on s.id = sl.shipment_id
      where sl.purchase_order_line_id = pol.id
        and s.status <> 'CANCELLED'
    ) sh on true
    where po.company_id = $1
      and po.id = $2
    order by pol.line_number;

### 10.3 Inventory available to promise

    select
      s.code as site_code,
      s.name as site_name,
      i.code as item_code,
      i.name as item_name,
      u.code as uom,
      x.physical,
      x.blocked,
      x.in_transit,
      x.released,
      x.threshold,
      x.allocatable
    from inventory.inventory_summary_v x
    join master_data.sites s on s.id = x.site_id
    join master_data.items i on i.id = x.item_id
    join master_data.uoms u on u.id = x.uom_id
    where x.company_id = $1
      and i.lifecycle_status = 'ACTIVE'
    order by s.code, i.code;

### 10.4 Shipment and delivery tracking

    select
      po.external_id,
      sh.shipment_number,
      sh.status as shipment_status,
      sh.truck_number,
      sh.planned_dispatch_at,
      sh.actual_dispatch_at,
      sh.expected_arrival_at,
      sh.actual_arrival_at,
      sum(sl.planned_quantity) as planned_quantity,
      sum(sl.dispatched_quantity) as dispatched_quantity,
      sum(sl.delivered_quantity) as delivered_quantity,
      sum(sl.damaged_quantity) as damaged_quantity,
      sum(sl.rejected_quantity) as rejected_quantity
    from scm.shipments sh
    join scm.purchase_orders po on po.id = sh.purchase_order_id
    join scm.shipment_lines sl on sl.shipment_id = sh.id
    where sh.company_id = $1
    group by po.external_id, sh.id
    order by sh.created_at desc;

### 10.5 Open delivery issues

    select
      po.external_id,
      sh.shipment_number,
      de.exception_type,
      de.quantity,
      de.reason,
      de.status,
      de.created_at,
      de.resolution,
      de.resolved_at
    from scm.delivery_exceptions de
    join scm.purchase_orders po on po.id = de.purchase_order_id
    left join scm.shipments sh on sh.id = de.shipment_id
    where de.company_id = $1
      and de.status in ('OPEN', 'INVESTIGATING')
    order by de.created_at;

### 10.6 Daily sales and stock history

    select
      d.observation_date,
      c.code as channel_code,
      i.code as item_code,
      s.code as site_code,
      d.sales_quantity,
      d.stock_quantity,
      d.stockout_days,
      d.listing_suppressed,
      d.price,
      d.promotion_flag,
      d.event_tags
    from planning.demand_observations d
    join master_data.channels c on c.id = d.channel_id
    join master_data.items i on i.id = d.item_id
    left join master_data.sites s on s.id = d.site_id
    where d.company_id = $1
      and d.observation_date between $2 and $3
    order by d.observation_date, c.code, i.code, s.code;

### 10.7 Latest signed-off forecast

    select
      f.period_start,
      c.code as channel_code,
      i.code as item_code,
      s.code as site_code,
      f.statistical_quantity,
      f.override_quantity,
      f.final_quantity,
      f.override_reason,
      f.wmape,
      f.bias
    from planning.forecasts f
    join planning.forecast_runs fr on fr.id = f.forecast_run_id
    join master_data.channels c on c.id = f.channel_id
    join master_data.items i on i.id = f.item_id
    left join master_data.sites s on s.id = f.site_id
    where f.company_id = $1
      and fr.status = 'SIGNED_OFF'
      and fr.id = (
        select fr2.id
        from planning.forecast_runs fr2
        where fr2.company_id = $1 and fr2.status = 'SIGNED_OFF'
        order by fr2.completed_at desc
        limit 1
      )
    order by f.period_start, c.code, i.code, s.code;

## 11. Compatibility views

The compat schema exposes old-style field names for read compatibility.

| View | Main purpose |
|---|---|
| compat.users | Current user profile fields |
| compat.platforms | Channels using platform naming |
| compat.warehouses | Warehouse sites |
| compat.skus | Active item summary |
| compat.warehouse_sku_policies | Threshold by warehouse and SKU |
| compat.inventory_balances | Physical, blocked and in-transit quantities |
| compat.destination_mappings | Destination-to-warehouse mapping |
| compat.route_estimates | Transit hours and cost |
| compat.purchase_orders | PO header with legacy names |
| compat.purchase_order_lines | Ordered, allocated and delivered quantities |
| compat.po_documents | PO source document and extraction |
| compat.stock_reservations | Reservation header |
| compat.appointments | Current appointment |
| compat.shipments | Shipment header |
| compat.shipment_lines | Shipment quantities |
| compat.shipment_events | Shipment history |
| compat.pods | Confirmed POD header |
| compat.pod_lines | POD quantities |
| compat.invoices | Invoice summary |
| compat.inventory_movements | Ledger entries using old movement names |
| compat.audit_events | Audit history using old field names |
| compat.notifications | Notification summary |

Important: compat is designed for reads. New writes must use approved SCM workflow APIs or database functions.

## 12. Complete schema catalogue

This section lists every v2 relation so the sales team can locate data outside the main sales path.

### iam

| Relation | Purpose |
|---|---|
| iam.users | User profile and application role |
| iam.user_company_access | Per-company read, write and approval access |

### master_data

| Relation | Purpose |
|---|---|
| master_data.companies | Legal companies |
| master_data.sites | Warehouse, plant, customer and virtual business nodes |
| master_data.locations | Physical and virtual location hierarchy |
| master_data.uoms | Units of measure |
| master_data.items | Product and material master |
| master_data.item_identifiers | EAN, GTIN, channel SKU and other identifiers |
| master_data.item_uom_conversions | Item-specific unit conversions |
| master_data.item_mrp_history | Effective-dated MRP |
| master_data.item_approvals | Item activation approvals |
| master_data.channels | Sales channels and marketplaces |
| master_data.channel_policies | Channel-specific fulfilment rules |
| master_data.destination_mappings | Channel destination to source mapping |
| master_data.routes | Transit-time and cost estimates |
| master_data.vendors | Vendor master |
| master_data.vendor_items | Vendor-product commercial data |
| master_data.customers | Customer master |
| master_data.transporters | Transporter master |

### documents

| Relation | Purpose |
|---|---|
| documents.files | Logical document record |
| documents.document_versions | Immutable stored file versions |
| documents.extraction_runs | OCR or extraction execution |
| documents.extracted_fields | Extracted, corrected and confidence values |
| documents.document_links | Generic links from files to business records |

### workflow

| Relation | Purpose |
|---|---|
| workflow.approval_requests | Approval header |
| workflow.approval_steps | Approval sequence and decisions |
| workflow.status_history | Append-only status transitions |

### scm

| Relation | Purpose |
|---|---|
| scm.purchase_orders | Channel PO header |
| scm.purchase_order_lines | Channel PO products and quantities |
| scm.acceptance_decisions | Versioned acceptance decisions |
| scm.appointments | Versioned appointments and matching |
| scm.appointment_documents | Appointment file versions |
| scm.warehouse_override_requests | Controlled source-warehouse override |
| scm.shipments | Shipment header |
| scm.shipment_lines | Shipment quantities by PO line |
| scm.shipment_line_allocations | Exact reservation batches used by shipment |
| scm.shipment_events | Shipment event history |
| scm.shipment_checks | PDI, label and ASN controls |
| scm.pods | POD header and document |
| scm.pod_shipment_links | Many-to-many POD and shipment link |
| scm.pod_lines | Delivered and discrepancy quantities |
| scm.delivery_exceptions | Short, damage, rejection and mismatch work queue |
| scm.short_close_decisions | Approved unfulfilled balance |
| scm.invoices | One external invoice per channel PO |
| scm.invoice_send_attempts | Invoice-delivery attempts |
| scm.po_gate_state_v | Acceptance and appointment facts |

### inventory

| Relation | Purpose |
|---|---|
| inventory.batches | Batch, manufacture date and expiry |
| inventory.stock_transactions | Immutable stock document header |
| inventory.stock_ledger_entries | Quantity and value movements |
| inventory.inventory_policies | Threshold, safety stock, ROP, EOQ and maximum stock |
| inventory.reservations | PO reservation header |
| inventory.reservation_lines | Required, reserved and shortage quantities |
| inventory.reservation_allocations | Reserved batches and locations |
| inventory.count_sessions | Cycle and stock-take sessions |
| inventory.count_lines | Blind count results |
| inventory.adjustments | Approved stock adjustments |
| inventory.stock_balance_v | Ledger balance by batch, location and state |
| inventory.inventory_summary_v | Sales-friendly inventory summary |

### quality

| Relation | Purpose |
|---|---|
| quality.inspection_parameters | Quality measurement master |
| quality.inspection_plans | Versioned inspection plan |
| quality.inspection_plan_parameters | Specifications and sampling rules |
| quality.instruments | Instrument and calibration status |
| quality.inspector_qualifications | Inspector qualification validity |
| quality.inspection_lots | Incoming, process, final or PDI lot |
| quality.inspection_results | Immutable test results |
| quality.dispositions | Release, hold, reject, return or scrap decision |
| quality.ncrs | Non-conformance reports |
| quality.capas | Corrective and preventive actions |
| quality.complaints | Customer and channel complaints |
| quality.recalls | Actual and mock recalls |

### planning

| Relation | Purpose |
|---|---|
| planning.demand_observations | Daily sales, stock and lost-sales signals |
| planning.forecast_runs | Forecast version and sign-off |
| planning.forecasts | Forecast by period, channel, site and item |
| planning.mrp_runs | MRP execution header |
| planning.mrp_suggestions | Purchase, manufacture and transfer suggestions |
| planning.redistribution_suggestions | Inter-site transfer proposals |

### procurement

| Relation | Purpose |
|---|---|
| procurement.rfqs | Request for quotation |
| procurement.rfq_lines | RFQ product lines |
| procurement.vendor_quotes | Vendor quote and landed cost |
| procurement.purchase_orders | Vendor PO header |
| procurement.purchase_order_lines | Vendor PO lines |
| procurement.asns | Advance shipment notice |
| procurement.gate_entries | Vehicle arrival and weighbridge data |
| procurement.goods_receipts | GRN header and quarantine receipt |
| procurement.goods_receipt_lines | GRN item and batch quantities |
| procurement.invoice_matches | PO, GRN and invoice match result |
| procurement.vendor_scorecards | Vendor quality, delivery, cost and compliance scores |

### manufacturing

| Relation | Purpose |
|---|---|
| manufacturing.boms | Versioned bill of material |
| manufacturing.bom_lines | BOM components |
| manufacturing.work_centres | Production work centres |
| manufacturing.machines | Machine master and state |
| manufacturing.routings | Versioned routing |
| manufacturing.routing_operations | Operation time and work-centre plan |
| manufacturing.manufacturing_orders | Production order |
| manufacturing.material_transactions | Issue, consume, return, scrap and receipt |
| manufacturing.downtime_events | Machine downtime |
| manufacturing.maintenance_orders | Preventive and breakdown maintenance |

### finance

| Relation | Purpose |
|---|---|
| finance.fiscal_periods | Open, closed and reopened accounting periods |
| finance.valuation_ledger | Moving-average inventory valuation |
| finance.landed_cost_allocations | Freight and landed-cost allocation |
| finance.accounting_exports | Tally, GSP and custom export control totals |

### platform

| Relation | Purpose |
|---|---|
| platform.document_sequences | Company and financial-year document numbering |
| platform.idempotency_keys | Duplicate-request protection |
| platform.audit_events | Global append-only audit history |
| platform.notifications | Notification queue |
| platform.notification_attempts | Notification retry history |
| platform.integration_jobs | External integration queue |
| platform.integration_attempts | Integration request and response history |
| platform.outbox_events | Transactional event outbox |

## 13. Incremental data pulls

Use these watermarks for incremental sync:

| Data | Recommended watermark |
|---|---|
| PO headers | updated_at, then id as tie-breaker |
| Items, channels, sites and locations | updated_at, then id |
| Appointments | updated_at, then id; keep all versions and use active for current |
| Shipments | updated_at, then id |
| PO lines | created_at for inserts; refresh when the parent PO updated_at changes |
| Acceptance decisions | decided_at, then id |
| Reservations | created_at, then id |
| Shipment events | created_at, then id |
| PODs | confirmed_at, then id |
| Delivery exceptions | created_at for inserts and resolved_at for resolution changes |
| Invoices | uploaded_at, then id |
| Inventory ledger | stock_transactions.created_at, then stock transaction id |
| Audit | occurred_at, then id |
| Demand history | observation_date plus channel, site and item composite key |
| Forecast | forecast_run_id and period_start |

Use an overlap window when reading timestamps. Upsert by primary key in the sales database.

## 14. Security and access

- Row-level security filters data by company access.
- QC users are read-only.
- Direct table writes are not granted to authenticated clients.
- Sensitive fields such as vendor bank data are not exposed through compatibility views.
- Driver phone numbers and document paths should be shown only when the sales role needs them.
- Do not place a Supabase service-role key in a browser or mobile application.
- Prefer a backend integration account with read-only access to approved views.
- The compat schema must be enabled in Supabase API settings before PostgREST clients can select it directly.

## 15. Data-quality checks for the sales module

Before accepting a sync, verify:

1. Every record has the expected company_id.
2. Every PO line joins to one PO and one item.
3. Reserved quantity does not exceed required quantity.
4. Planned shipment quantity does not exceed reserved quantity.
5. Delivered, damaged and rejected quantity does not exceed dispatched quantity.
6. One PO has at most one invoice.
7. One active appointment and one active reservation exist per PO.
8. PO acceptance and appointment are read from scm.po_gate_state_v.
9. Cancelled shipments are excluded from fulfilment totals.
10. Replaced or reversed PODs are excluded from current delivery totals when building custom reports.

The SCM repository includes these database checks in supabase/tests/scm_v2_validation.sql.

## 16. Legacy-to-v2 mapping

| Existing public table | SCM v2 source |
|---|---|
| public.platforms | master_data.channels |
| public.warehouses | master_data.sites |
| public.skus | master_data.items |
| public.warehouse_sku_policies | inventory.inventory_policies |
| public.inventory_balances | inventory.inventory_summary_v |
| public.destination_mappings | master_data.destination_mappings |
| public.route_estimates | master_data.routes |
| public.purchase_orders | scm.purchase_orders |
| public.purchase_order_lines | scm.purchase_order_lines plus reservation and shipment facts |
| public.po_documents | documents files, versions and extraction tables |
| public.stock_reservations | inventory.reservations and reservation_lines |
| public.appointments | scm.appointments and appointment_documents |
| public.shipments | scm.shipments |
| public.shipment_lines | scm.shipment_lines |
| public.shipment_events | scm.shipment_events |
| public.pods | scm.pods |
| public.pod_lines | scm.pod_lines |
| public.invoices | scm.invoices |
| public.inventory_movements | inventory.stock_transactions and stock_ledger_entries |
| public.audit_events | platform.audit_events |
| public.notifications | platform.notifications and notification_attempts |

## 17. Source files

The executable schema is defined in:

- supabase/migrations/202610030001_scm_v2_foundation.sql
- supabase/migrations/202610030002_scm_v2_core.sql
- supabase/migrations/202610030003_scm_v2_bos_extensions.sql
- supabase/migrations/202610030004_scm_v2_workflows.sql
- supabase/migrations/202610030005_scm_v2_security_compat.sql


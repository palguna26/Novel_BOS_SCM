const integrationPrefix = '/api/v1/integration';

const queryParameters = [
  ['limit', 'integer', 'Maximum rows to return (1-500).', false],
  ['cursor', 'string', 'Opaque cursor returned by the previous response.', false],
  ['updatedAfter', 'string', 'Return records updated after this ISO timestamp.', false],
  ['active', 'boolean', 'Filter active or inactive master records.', false],
  ['status', 'string', 'Filter by domain status.', false],
  ['stockStatus', 'string', 'Filter by stock state.', false],
  ['channelId', 'string', 'Filter by channel UUID.', false],
  ['siteId', 'string', 'Filter by site UUID.', false],
  ['locationId', 'string', 'Filter by location UUID.', false],
  ['itemId', 'string', 'Filter by item UUID.', false],
  ['purchaseOrderId', 'string', 'Filter by purchase order UUID.', false],
  ['shipmentId', 'string', 'Filter by shipment UUID.', false],
  ['from', 'string', 'Inclusive ISO timestamp.', false],
  ['to', 'string', 'Exclusive ISO timestamp.', false],
].map(([name, type, description, required]) => ({
  name,
  in: 'query',
  required,
  description,
  schema: { type, ...(type === 'integer' ? { minimum: 1, maximum: 500, default: 100 } : {}), ...(type === 'string' && ['updatedAfter', 'from', 'to'].includes(String(name)) ? { format: 'date-time' } : {}) },
}));

const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });
const pageResponse = (schema: string, example: any = []) => ({
  description: 'Successful response.',
  content: { 'application/json': { schema: { type: 'object', required: ['data', 'page', 'meta'], properties: { data: { type: 'array', items: ref(schema) }, page: ref('PageInfo'), meta: ref('Meta') } }, example: { data: example, page: { limit: 100, hasMore: false, nextCursor: null }, meta: { requestId: '00000000-0000-0000-0000-000000000000', asOf: '2026-10-22T00:00:00Z' } } } },
});
const errors = {
  '401': { description: 'Missing or invalid integration credential.', content: { 'application/json': { schema: ref('Error'), example: { error: { code: 'UNAUTHORIZED', message: 'Integration credentials are required', requestId: '00000000-0000-0000-0000-000000000000' } } } } },
  '403': { description: 'Credential does not have the required scope.', content: { 'application/json': { schema: ref('Error'), example: { error: { code: 'FORBIDDEN', message: 'Integration scope inventory:read is required', requestId: '00000000-0000-0000-0000-000000000000' } } } } },
  '404': { description: 'Record not found in the authenticated tenant.', content: { 'application/json': { schema: ref('Error') } } },
  '429': { description: 'Rate limit exceeded.', content: { 'application/json': { schema: ref('Error') } } },
};

const list = (name: string, summary: string, example: any = []) => ({
  get: { tags: ['Sales Integration'], summary, security: [{ bearerAuth: [] }], parameters: queryParameters, responses: { '200': pageResponse(name, example), ...errors } },
});
const single = (name: string, summary: string) => ({
  get: { tags: ['Sales Integration'], summary, security: [{ bearerAuth: [] }], parameters: [{ $ref: '#/components/parameters/id' }], responses: { '200': { description: 'Successful response.', content: { 'application/json': { schema: { type: 'object', required: ['data', 'meta'], properties: { data: ref(name), meta: ref('Meta') } } } } }, ...errors } },
});

const schemas: Record<string, any> = {
  Page: { type: 'object', required: ['data', 'page', 'meta'], properties: { data: { type: 'array', items: {} }, page: { $ref: '#/components/schemas/PageInfo' }, meta: { $ref: '#/components/schemas/Meta' } } },
  PageInfo: { type: 'object', required: ['limit', 'hasMore', 'nextCursor'], properties: { limit: { type: 'integer', example: 100 }, hasMore: { type: 'boolean', example: false }, nextCursor: { type: 'string', nullable: true, example: null } } },
  Meta: { type: 'object', required: ['requestId', 'asOf'], properties: { requestId: { type: 'string', format: 'uuid' }, asOf: { type: 'string', format: 'date-time' } } },
  Error: { type: 'object', required: ['error'], properties: { error: { type: 'object', required: ['code', 'message', 'requestId'], properties: { code: { type: 'string' }, message: { type: 'string' }, requestId: { type: 'string', format: 'uuid' } } } } },
  Product: { type: 'object', properties: { id: { type: 'string', format: 'uuid' }, code: { type: 'string' }, name: { type: 'string' }, lifecycleStatus: { type: 'string' }, baseUom: { type: 'object', nullable: true }, identifiers: { type: 'array', items: { type: 'object' } }, uomConversions: { type: 'array', items: { type: 'object' } }, createdAt: { type: 'string', format: 'date-time' }, updatedAt: { type: 'string', format: 'date-time' } } },
  Identifier: { type: 'object', properties: { id: { type: 'string', format: 'uuid' }, itemId: { type: 'string', format: 'uuid' }, channelId: { type: 'string', format: 'uuid' }, identifierType: { type: 'string', enum: ['AMAZON_ASIN', 'AMAZON_SELLER_SKU', 'FLIPKART_PRODUCT_ID', 'FLIPKART_SKU', 'MEESHO_PRODUCT_ID', 'MEESHO_SKU', 'EAN', 'GTIN', 'UPC', 'BARCODE', 'CHANNEL_SKU', 'LEGACY'] }, value: { type: 'string' }, active: { type: 'boolean' } } },
  Channel: { type: 'object', properties: { id: { type: 'string', format: 'uuid' }, code: { type: 'string' }, name: { type: 'string' }, channel_type: { type: 'string' }, active: { type: 'boolean' } } },
  Site: { type: 'object', properties: { id: { type: 'string', format: 'uuid' }, code: { type: 'string' }, name: { type: 'string' }, city: { type: 'string', nullable: true }, state: { type: 'string', nullable: true }, active: { type: 'boolean' } } },
  Location: { type: 'object', properties: { id: { type: 'string', format: 'uuid' }, site_id: { type: 'string', format: 'uuid' }, code: { type: 'string' }, name: { type: 'string' }, location_type: { type: 'string' }, active: { type: 'boolean' } } },
  Destination: { type: 'object', properties: { id: { type: 'string', format: 'uuid' }, destination_key: { type: 'string' }, destination_name: { type: 'string', nullable: true }, fc_code: { type: 'string', nullable: true }, source_site_id: { type: 'string', format: 'uuid', nullable: true }, active: { type: 'boolean' } } },
  Inventory: { type: 'object', properties: { company_id: { type: 'string', format: 'uuid' }, site_id: { type: 'string', format: 'uuid' }, item_id: { type: 'string', format: 'uuid' }, uom_id: { type: 'string', format: 'uuid' }, physicalQuantity: { type: 'string', example: '100.000000' }, availableQuantity: { type: 'string', example: '80.000000' }, reservedQuantity: { type: 'string', example: '20.000000' }, thresholdQuantity: { type: 'string', example: '10.000000' }, allocatableQuantity: { type: 'string', example: '70.000000' }, inTransitQuantity: { type: 'string' }, snapshotAt: { type: 'string', format: 'date-time' } } },
  Balance: { type: 'object', properties: { site_id: { type: 'string', format: 'uuid' }, location_id: { type: 'string', format: 'uuid' }, item_id: { type: 'string', format: 'uuid' }, stock_state: { type: 'string' }, quantity: { type: 'string' }, value: { type: 'string' } } },
  PurchaseOrder: { type: 'object', properties: { id: { type: 'string', format: 'uuid' }, external_id: { type: 'string' }, company_id: { type: 'string', format: 'uuid' }, status: { type: 'string' }, po_date: { type: 'string', format: 'date' }, totalValue: { type: 'string' }, lines: { type: 'array', items: { type: 'object' } }, gate: { type: 'object', nullable: true } } },
  PurchaseOrderLine: { type: 'object', properties: { id: { type: 'string', format: 'uuid' }, purchase_order_id: { type: 'string', format: 'uuid' }, item_id: { type: 'string', format: 'uuid' }, orderedQuantity: { type: 'string' }, state: { type: 'object', nullable: true } } },
  Gate: { type: 'object', properties: { purchase_order_id: { type: 'string', format: 'uuid' }, acceptance_complete: { type: 'boolean' }, appointment_complete: { type: 'boolean' }, ready_for_reservation: { type: 'boolean' } } },
  Reservation: { type: 'object', properties: { id: { type: 'string', format: 'uuid' }, purchase_order_id: { type: 'string', format: 'uuid' }, status: { type: 'string' }, lines: { type: 'array', items: { type: 'object' } } } },
  Appointment: { type: 'object', properties: { id: { type: 'string', format: 'uuid' }, appointment_number: { type: 'string', nullable: true }, status: { type: 'string' }, purchaseOrderIds: { type: 'array', items: { type: 'string', format: 'uuid' } } } },
  Shipment: { type: 'object', properties: { id: { type: 'string', format: 'uuid' }, purchase_order_id: { type: 'string', format: 'uuid' }, status: { type: 'string' }, lines: { type: 'array', items: { type: 'object' } }, events: { type: 'array', items: { type: 'object' } } } },
  Pod: { type: 'object', properties: { id: { type: 'string', format: 'uuid' }, purchase_order_id: { type: 'string', format: 'uuid' }, status: { type: 'string' }, shipmentIds: { type: 'array', items: { type: 'string', format: 'uuid' } }, lines: { type: 'array', items: { type: 'object' } } } },
  DeliveryException: { type: 'object', properties: { id: { type: 'string', format: 'uuid' }, purchase_order_id: { type: 'string', format: 'uuid' }, shipment_id: { type: 'string', format: 'uuid', nullable: true }, status: { type: 'string' }, reason: { type: 'string', nullable: true } } },
  ShortClosure: { type: 'object', properties: { id: { type: 'string', format: 'uuid' }, purchase_order_id: { type: 'string', format: 'uuid' }, status: { type: 'string' }, remainingQuantity: { type: 'string' }, lines: { type: 'array', items: { type: 'object' } } } },
  Invoice: { type: 'object', properties: { id: { type: 'string', format: 'uuid' }, purchase_order_id: { type: 'string', format: 'uuid' }, invoice_number: { type: 'string', nullable: true }, amount: { type: 'string' }, currency: { type: 'string' }, status: { type: 'string' } } },
  Valuation: { type: 'object', properties: { id: { type: 'string', format: 'uuid' }, item_id: { type: 'string', format: 'uuid' }, quantityDelta: { type: 'string' }, unitCost: { type: 'string' }, valueDelta: { type: 'string' }, posting_at: { type: 'string', format: 'date-time' } } },
  Forecast: { type: 'object', properties: { id: { type: 'string', format: 'uuid' }, item_id: { type: 'string', format: 'uuid' }, period_start: { type: 'string', format: 'date' }, finalQuantity: { type: 'string' } } },
  InboundCommitment: { type: 'object', properties: { id: { type: 'string', format: 'uuid' }, po_number: { type: 'string' }, expected_date: { type: 'string', format: 'date', nullable: true }, status: { type: 'string' }, lines: { type: 'array', items: { type: 'object' } }, receipts: { type: 'array', items: { type: 'object' } } } },
  Movement: { type: 'object', properties: { id: { type: 'string', format: 'uuid' }, transaction_type: { type: 'string' }, status: { type: 'string' }, reason: { type: 'string', nullable: true }, entries: { type: 'array', items: { type: 'object' } } } },
  Change: { type: 'object', properties: { sequence_id: { type: 'integer' }, entity_type: { type: 'string' }, entity_id: { type: 'string', format: 'uuid' }, operation: { type: 'string', enum: ['CREATED', 'UPDATED', 'DEACTIVATED', 'CANCELLED', 'REVERSED', 'SUPERSEDED'] }, entity_version: { type: 'integer' }, changed_at: { type: 'string', format: 'date-time' }, data: { type: 'object' } } },
};

const paths: Record<string, any> = {
  [`${integrationPrefix}/health`]: { get: { tags: ['Sales Integration'], summary: 'Integration health', security: [{ bearerAuth: [] }], responses: { '200': { description: 'Healthy tenant-scoped API.', content: { 'application/json': { schema: { type: 'object', properties: { status: { type: 'string', example: 'ok' }, companyId: { type: 'string', format: 'uuid' }, apiVersion: { type: 'string', example: 'v1' }, asOf: { type: 'string', format: 'date-time' } } } } } }, ...errors } } },
  [`${integrationPrefix}/products`]: list('Product', 'Product master records.'),
  [`${integrationPrefix}/products/{id}`]: single('Product', 'Product by SCM UUID.'),
  [`${integrationPrefix}/product-identifiers`]: list('Identifier', 'Marketplace and barcode identifiers.'),
  [`${integrationPrefix}/product-identifiers/resolve`]: { get: { tags: ['Sales Integration'], summary: 'Resolve a marketplace identifier.', security: [{ bearerAuth: [] }], parameters: [...queryParameters, { name: 'identifierType', in: 'query', required: true, schema: { type: 'string' } }, { name: 'value', in: 'query', required: true, schema: { type: 'string' } }], responses: { '200': { description: 'Resolved product identifier.', content: { 'application/json': { schema: ref('Identifier') } } }, ...errors } } },
  [`${integrationPrefix}/channels`]: list('Channel', 'Channel master records.'),
  [`${integrationPrefix}/sites`]: list('Site', 'Warehouse and site master records.'),
  [`${integrationPrefix}/locations`]: list('Location', 'Physical and virtual locations.'),
  [`${integrationPrefix}/destinations`]: list('Destination', 'Destination and fulfilment mappings.'),
  [`${integrationPrefix}/inventory`]: list('Inventory', 'Authoritative inventory availability.'),
  [`${integrationPrefix}/inventory/balances`]: list('Balance', 'Location, batch, and stock-state balances.'),
  [`${integrationPrefix}/purchase-orders`]: list('PurchaseOrder', 'Purchase orders with authoritative lines and gates.'),
  [`${integrationPrefix}/purchase-orders/{id}`]: single('PurchaseOrder', 'Purchase order by SCM UUID.'),
  [`${integrationPrefix}/purchase-order-lines`]: list('PurchaseOrderLine', 'Authoritative purchase-order line quantities.'),
  [`${integrationPrefix}/po-gates`]: list('Gate', 'Acceptance and appointment gates.'),
  [`${integrationPrefix}/reservations`]: list('Reservation', 'Reservations and stock allocations.'),
  [`${integrationPrefix}/appointments`]: list('Appointment', 'Appointments and PO links.'),
  [`${integrationPrefix}/shipments`]: list('Shipment', 'Shipments, lines, and events.'),
  [`${integrationPrefix}/pods`]: list('Pod', 'Proofs of delivery and confirmed quantities.'),
  [`${integrationPrefix}/delivery-exceptions`]: list('DeliveryException', 'Delivery exceptions and resolutions.'),
  [`${integrationPrefix}/short-closures`]: list('ShortClosure', 'Approved short-closure decisions.'),
  [`${integrationPrefix}/invoices`]: list('Invoice', 'PO invoices.'),
  [`${integrationPrefix}/valuations`]: list('Valuation', 'Authorized valuation ledger records.'),
  [`${integrationPrefix}/forecasts`]: list('Forecast', 'SCM planning forecasts.'),
  [`${integrationPrefix}/inbound-commitments`]: list('InboundCommitment', 'Inbound procurement commitments.'),
  [`${integrationPrefix}/inventory-movements`]: list('Movement', 'Append-only inventory movements and reversals.'),
  [`${integrationPrefix}/ownership-transfers`]: list('Change', 'Ownership transfer events.'),
  [`${integrationPrefix}/changes`]: list('Change', 'Incremental change feed. Store the returned cursor exactly as received.'),
};

export const integrationOpenApi = {
  openapi: '3.0.3',
  info: { title: 'SCM Sales Integration API', version: '1.0.0', description: 'Read-only, tenant-scoped SCM v2 data for the Sales Module. All list responses use cursor pagination. Quantities and monetary values are decimal strings.' },
  tags: [{ name: 'Sales Integration', description: 'Read-only SCM data for approved internal Sales integration.' }],
  components: { securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'Sales integration token' } }, parameters: { id: { name: 'id', in: 'path', required: true, description: 'Stable SCM UUID.', schema: { type: 'string', format: 'uuid' } } }, schemas },
  paths,
  security: [{ bearerAuth: [] }],
};

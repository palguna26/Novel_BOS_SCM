import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { SupabaseService } from '../supabase.service';
import { IntegrationContext, IntegrationQuery, Page } from './integration.types';

type Row = Record<string, any>;

@Injectable()
export class IntegrationService {
  constructor(private readonly supabase: SupabaseService) {}

  private requestId() { return randomUUID(); }

  private limit(value?: string) {
    const parsed = Number(value || 100);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 500) throw new BadRequestException('limit must be an integer between 1 and 500');
    return parsed;
  }

  private cursor(value?: string) {
    if (!value) return 0;
    const decoded = Buffer.from(value, 'base64url').toString('utf8');
    const parsed = Number(decoded);
    if (!Number.isInteger(parsed) || parsed < 0) throw new BadRequestException('Invalid integration cursor');
    return parsed;
  }

  private encodeCursor(offset: number) { return Buffer.from(String(offset), 'utf8').toString('base64url'); }

  private page<T>(rows: T[], query: IntegrationQuery, requestId: string): Page<T> {
    const limit = this.limit(query.limit);
    const offset = this.cursor(query.cursor);
    const data = rows.slice(offset, offset + limit);
    const hasMore = offset + limit < rows.length;
    return {
      data,
      page: { limit, hasMore, nextCursor: hasMore ? this.encodeCursor(offset + limit) : null },
      meta: { requestId, asOf: new Date().toISOString() },
    };
  }

  private scope(context: IntegrationContext, required: string) {
    if (!context.scopes.has(required)) throw new ForbiddenException(`Integration scope ${required} is required`);
  }

  private async rows(context: IntegrationContext, schema: string, table: string, query: IntegrationQuery, order = 'id') {
    let request = this.supabase.schema(schema).from(table).select('*').eq('company_id', context.companyId).order(order, { ascending: true });
    const isScm = schema === 'scm';
    const hasStatus = ['appointments', 'reservations', 'shipments', 'pods', 'delivery_exceptions', 'invoices', 'stock_transactions', 'change_log'].includes(table) || (isScm && table === 'purchase_orders') || (schema === 'procurement' && table === 'purchase_orders');
    const hasActive = ['items', 'item_identifiers', 'channels', 'sites', 'locations', 'destination_mappings', 'appointments', 'acceptance_decisions'].includes(table);
    const hasStockStatus = ['stock_balance_v', 'stock_ledger_entries'].includes(table);
    const hasChannel = ['item_identifiers', 'channels', 'destination_mappings'].includes(table) || (isScm && table === 'purchase_orders');
    const hasSite = ['sites', 'locations', 'destination_mappings', 'inventory_summary_v', 'stock_balance_v', 'stock_ledger_entries', 'reservations', 'shipments', 'inventory_availability_v'].includes(table);
    const hasLocation = ['locations', 'stock_balance_v', 'stock_ledger_entries', 'reservations', 'reservation_allocations'].includes(table);
    const hasItem = ['item_identifiers', 'item_uom_conversions', 'items', 'inventory_summary_v', 'inventory_availability_v', 'stock_balance_v', 'stock_ledger_entries', 'reservation_lines', 'reservation_allocations', 'shipment_lines', 'pod_lines', 'po_line_state_v'].includes(table);
    const hasPo = ['purchase_order_lines', 'appointments', 'reservations', 'shipments', 'pods', 'delivery_exceptions', 'invoices', 'po_gate_state_v', 'po_line_state_v', 'ownership_transfer_events'].includes(table) || (isScm && table === 'purchase_orders');
    const hasShipment = ['shipments', 'shipment_lines', 'shipment_events', 'pods', 'pod_lines', 'delivery_exceptions'].includes(table);
    const hasUpdatedAt = ['items', 'item_identifiers', 'channels', 'sites', 'locations', 'destination_mappings', 'purchase_orders', 'appointments', 'shipments', 'pods', 'delivery_exceptions', 'invoices', 'reservations'].includes(table);
    if (query.status && hasStatus) request = request.eq('status', query.status);
    if (query.active !== undefined && hasActive) {
      if (!['true', 'false'].includes(query.active)) throw new BadRequestException('active must be true or false');
      request = request.eq('active', query.active === 'true');
    }
    if (query.stockStatus && hasStockStatus) request = request.eq('stock_state', query.stockStatus);
    if (query.channelId && hasChannel) request = request.eq('channel_id', query.channelId);
    if (query.siteId && hasSite) request = request.eq('site_id', query.siteId);
    if (query.locationId && hasLocation) request = request.eq('location_id', query.locationId);
    if (query.itemId && table === 'items') request = request.eq('id', query.itemId);
    else if (query.itemId && hasItem) request = request.eq('item_id', query.itemId);
    if (query.purchaseOrderId && hasPo) request = request.eq('purchase_order_id', query.purchaseOrderId);
    if (query.shipmentId && hasShipment) request = request.eq('shipment_id', query.shipmentId);
    if (query.identifierType && table === 'item_identifiers') request = request.eq('identifier_type', query.identifierType);
    if (query.value && table === 'item_identifiers') request = request.ilike('value', query.value);
    if (query.updatedAfter && hasUpdatedAt) request = request.gt('updated_at', query.updatedAfter);
    if (query.from && ['created_at', 'updated_at', 'posting_at', 'changed_at'].includes(order)) request = request.gte(order, query.from);
    if (query.to && ['created_at', 'updated_at', 'posting_at', 'changed_at'].includes(order)) request = request.lt(order, query.to);
    const { data, error } = await request;
    if (error) throw new BadRequestException(error.message);
    return (data || []) as Row[];
  }

  private async joinItems(context: IntegrationContext, rows: Row[]) {
    const items = await this.rows(context, 'master_data', 'items', {});
    const byId = new Map(items.map(item => [item.id, item]));
    return rows.map(row => ({ ...row, item: byId.get(row.item_id) || null }));
  }

  async health(context: IntegrationContext) {
    return { status: 'ok', companyId: context.companyId, apiVersion: 'v1', asOf: new Date().toISOString() };
  }

  async products(context: IntegrationContext, query: IntegrationQuery) {
    this.scope(context, 'master:read');
    const [items, identifiers, conversions, uoms] = await Promise.all([
      this.rows(context, 'master_data', 'items', query, 'id'),
      this.rows(context, 'master_data', 'item_identifiers', query, 'id'),
      this.rows(context, 'master_data', 'item_uom_conversions', query, 'id'),
      this.supabase.schema('master_data').from('uoms').select('*').eq('active', true),
    ]);
    const uomMap = new Map(((uoms.data || []) as Row[]).map(uom => [uom.id, uom]));
    const identifiersByItem = new Map<string, Row[]>();
    for (const identifier of identifiers) identifiersByItem.set(identifier.item_id, [...(identifiersByItem.get(identifier.item_id) || []), identifier]);
    const conversionsByItem = new Map<string, Row[]>();
    for (const conversion of conversions) conversionsByItem.set(conversion.item_id, [...(conversionsByItem.get(conversion.item_id) || []), conversion]);
    const result = items.map(item => ({
      id: item.id,
      code: item.code,
      legacyCode: item.legacy_code,
      name: item.name,
      description: item.description ?? null,
      brand: item.brand,
      category: item.category,
      subcategory: item.subcategory ?? null,
      variant: item.variant,
      itemClass: item.item_class,
      lifecycleStatus: item.lifecycle_status,
      baseUom: uomMap.get(item.base_uom_id) || { id: item.base_uom_id },
      leadTimeDays: String(item.lead_time_days ?? 0),
      minimumOrderQuantity: String(item.minimum_order_qty ?? 0),
      orderMultiple: String(item.order_multiple ?? 1),
      productionLeadTimeDays: item.production_lead_time_days == null ? null : String(item.production_lead_time_days),
      packQuantity: item.pack_quantity == null ? null : String(item.pack_quantity),
      cartonQuantity: item.carton_quantity == null ? null : String(item.carton_quantity),
      identifiers: identifiersByItem.get(item.id) || [],
      uomConversions: conversionsByItem.get(item.id) || [],
      createdAt: item.created_at,
      updatedAt: item.updated_at,
    }));
    return this.page(result, query, this.requestId());
  }

  async product(context: IntegrationContext, id: string) {
    this.scope(context, 'master:read');
    const result = await this.products(context, { itemId: id, limit: '1' });
    if (!result.data.length) throw new NotFoundException('Product not found');
    return { data: result.data[0], meta: result.meta };
  }

  async identifiers(context: IntegrationContext, query: IntegrationQuery) {
    this.scope(context, 'master:read');
    const data = await this.rows(context, 'master_data', 'item_identifiers', query);
    return this.page(await this.joinItems(context, data), query, this.requestId());
  }

  async resolveIdentifier(context: IntegrationContext, query: IntegrationQuery) {
    this.scope(context, 'master:read');
    if (!query.value?.trim() || !query.identifierType?.trim()) throw new BadRequestException('value and identifierType are required');
    const matches = await this.rows(context, 'master_data', 'item_identifiers', { ...query, limit: '500' });
    if (!matches.length) throw new NotFoundException('Product mapping not found');
    if (matches.length > 1) throw new BadRequestException({ code: 'PRODUCT_MAPPING_AMBIGUOUS', candidates: matches.map(x => x.item_id) });
    return { data: (await this.joinItems(context, matches))[0], meta: { requestId: this.requestId(), asOf: new Date().toISOString() } };
  }

  async masters(context: IntegrationContext, query: IntegrationQuery) {
    this.scope(context, 'master:read');
    const [channels, sites, locations, destinations] = await Promise.all([
      this.rows(context, 'master_data', 'channels', query),
      this.rows(context, 'master_data', 'sites', query),
      this.rows(context, 'master_data', 'locations', query),
      this.rows(context, 'master_data', 'destination_mappings', query),
    ]);
    return { data: { channels, sites, locations, destinations }, meta: { requestId: this.requestId(), asOf: new Date().toISOString() } };
  }

  async channels(context: IntegrationContext, query: IntegrationQuery) {
    this.scope(context, 'master:read');
    return this.page(await this.rows(context, 'master_data', 'channels', query), query, this.requestId());
  }

  async sites(context: IntegrationContext, query: IntegrationQuery) {
    this.scope(context, 'master:read');
    return this.page(await this.rows(context, 'master_data', 'sites', query), query, this.requestId());
  }

  async locations(context: IntegrationContext, query: IntegrationQuery) {
    this.scope(context, 'master:read');
    return this.page(await this.rows(context, 'master_data', 'locations', query), query, this.requestId());
  }

  async destinations(context: IntegrationContext, query: IntegrationQuery) {
    this.scope(context, 'master:read');
    return this.page(await this.rows(context, 'master_data', 'destination_mappings', query), query, this.requestId());
  }

  async inventory(context: IntegrationContext, query: IntegrationQuery) {
    this.scope(context, 'inventory:read');
    const rows = await this.rows(context, 'integration', 'inventory_availability_v', query, 'item_id');
    const data = rows.map(row => ({
      ...row,
      physicalQuantity: String(row.physical_quantity ?? 0),
      availableQuantity: String(row.available_quantity ?? 0),
      reservedQuantity: String(row.reserved_quantity ?? 0),
      thresholdQuantity: String(row.threshold_quantity ?? 0),
      allocatableQuantity: String(row.allocatable_quantity ?? 0),
      inTransitQuantity: String(row.in_transit_quantity ?? 0),
      quarantineQuantity: String(row.quarantine_quantity ?? 0),
      onHoldQuantity: String(row.on_hold_quantity ?? 0),
      rejectedQuantity: String(row.rejected_quantity ?? 0),
      scrapQuantity: String(row.scrap_quantity ?? 0),
      quantityDefinitionVersion: '1',
      definitions: {
        physical: 'warehouse-held non-scrap stock excluding transit and external locations',
        available: 'physical stock minus reserved/blocked stock',
        reserved: 'RESERVED stock',
        allocatable: 'max(physical - blocked - threshold, 0)',
      },
      snapshotAt: new Date().toISOString(),
    }));
    return this.page(data, query, this.requestId());
  }

  async inventoryBalances(context: IntegrationContext, query: IntegrationQuery) {
    this.scope(context, 'inventory:read');
    const rows = await this.rows(context, 'inventory', 'stock_balance_v', query, 'item_id');
    return this.page(rows.map(row => ({ ...row, quantity: String(row.quantity ?? 0), value: String(row.value ?? 0) })), query, this.requestId());
  }

  async purchaseOrders(context: IntegrationContext, query: IntegrationQuery) {
    this.scope(context, 'po:read');
    const [pos, lines, gates, states] = await Promise.all([
      this.rows(context, 'scm', 'purchase_orders', query, 'created_at'),
      this.rows(context, 'scm', 'purchase_order_lines', query, 'id'),
      this.rows(context, 'scm', 'po_gate_state_v', query, 'purchase_order_id'),
      this.rows(context, 'integration', 'po_line_state_v', query, 'purchase_order_line_id'),
    ]);
    const gateByPo = new Map(gates.map(gate => [gate.purchase_order_id, gate]));
    const linesByPo = new Map<string, Row[]>();
    for (const line of lines) linesByPo.set(line.purchase_order_id, [...(linesByPo.get(line.purchase_order_id) || []), { ...line, orderedQuantity: String(line.ordered_quantity), unitPrice: String(line.unit_price) }]);
    const stateByLine = new Map(states.map(state => [state.purchase_order_line_id, state]));
    const data = pos.map(po => ({ ...po, totalValue: String(po.total_value), lines: (linesByPo.get(po.id) || []).map(line => ({ ...line, state: stateByLine.get(line.id) || null })), gate: gateByPo.get(po.id) || null }));
    return this.page(data, query, this.requestId());
  }

  async purchaseOrder(context: IntegrationContext, id: string) {
    this.scope(context, 'po:read');
    const result = await this.purchaseOrders(context, { purchaseOrderId: id, limit: '1' });
    if (!result.data.length) throw new NotFoundException('Purchase order not found');
    return { data: result.data[0], meta: result.meta };
  }

  async gates(context: IntegrationContext, query: IntegrationQuery) {
    this.scope(context, 'po:read');
    const data = await this.rows(context, 'scm', 'po_gate_state_v', query, 'purchase_order_id');
    return this.page(data, query, this.requestId());
  }

  async purchaseOrderLines(context: IntegrationContext, query: IntegrationQuery) {
    this.scope(context, 'po:read');
    return this.page(await this.rows(context, 'integration', 'po_line_state_v', query, 'purchase_order_line_id'), query, this.requestId());
  }

  async reservations(context: IntegrationContext, query: IntegrationQuery) {
    this.scope(context, 'inventory:read');
    const [reservations, lines, allocations] = await Promise.all([
      this.rows(context, 'inventory', 'reservations', query, 'created_at'),
      this.rows(context, 'inventory', 'reservation_lines', query),
      this.rows(context, 'inventory', 'reservation_allocations', query),
    ]);
    const linesByReservation = new Map<string, Row[]>();
    for (const line of lines) linesByReservation.set(line.reservation_id, [...(linesByReservation.get(line.reservation_id) || []), { ...line, requiredQuantity: String(line.required_quantity), reservedQuantity: String(line.reserved_quantity), shortageQuantity: String(line.shortage_quantity), allocations: allocations.filter(a => a.reservation_line_id === line.id).map(a => ({ ...a, quantity: String(a.quantity), dispatchedQuantity: String(a.dispatched_quantity), releasedQuantity: String(a.released_quantity) })) }]);
    const data = reservations.map(reservation => ({ ...reservation, lines: linesByReservation.get(reservation.id) || [] }));
    return this.page(data, query, this.requestId());
  }

  async shipments(context: IntegrationContext, query: IntegrationQuery) {
    this.scope(context, 'fulfilment:read');
    const [shipments, lines, events] = await Promise.all([
      this.rows(context, 'scm', 'shipments', query, 'created_at'),
      this.rows(context, 'scm', 'shipment_lines', query),
      this.rows(context, 'scm', 'shipment_events', query, 'created_at'),
    ]);
    const data = shipments.map(shipment => ({
      ...shipment,
      estimatedCost: String(shipment.estimated_cost ?? 0),
      actualCost: shipment.actual_cost == null ? null : String(shipment.actual_cost),
      lines: lines.filter(line => line.shipment_id === shipment.id).map(line => ({ ...line, plannedQuantity: String(line.planned_quantity), dispatchedQuantity: String(line.dispatched_quantity), deliveredQuantity: String(line.delivered_quantity), damagedQuantity: String(line.damaged_quantity), rejectedQuantity: String(line.rejected_quantity) })),
      events: events.filter(event => event.shipment_id === shipment.id),
    }));
    return this.page(data, query, this.requestId());
  }

  async appointments(context: IntegrationContext, query: IntegrationQuery) {
    this.scope(context, 'fulfilment:read');
    const [appointments, documents, links] = await Promise.all([
      this.rows(context, 'scm', 'appointments', query, 'created_at'),
      this.rows(context, 'scm', 'appointment_documents', query, 'created_at'),
      this.rows(context, 'scm', 'appointment_purchase_orders', query, 'appointment_id'),
    ]);
    const data = appointments.map(appointment => ({ ...appointment, documentVersionIds: documents.filter(document => document.appointment_id === appointment.id).map(document => document.document_version_id), purchaseOrderIds: links.filter(link => link.appointment_id === appointment.id).map(link => link.purchase_order_id) }));
    return this.page(data, query, this.requestId());
  }

  async pods(context: IntegrationContext, query: IntegrationQuery) {
    this.scope(context, 'fulfilment:read');
    const [pods, lines, links] = await Promise.all([
      this.rows(context, 'scm', 'pods', query, 'created_at'),
      this.rows(context, 'scm', 'pod_lines', query),
      this.rows(context, 'scm', 'pod_shipment_links', query, 'pod_id'),
    ]);
    const data = pods.map(pod => ({ ...pod, approvalStatus: pod.status === 'CONFIRMED' || pod.status === 'APPROVED' ? 'APPROVED' : pod.status, lines: lines.filter(line => line.pod_id === pod.id).map(line => ({ ...line, confirmedQuantity: String(line.confirmed_quantity), shortQuantity: String(line.short_quantity), damagedQuantity: String(line.damaged_quantity), rejectedQuantity: String(line.rejected_quantity) })), shipmentIds: links.filter(link => link.pod_id === pod.id).map(link => link.shipment_id), deliveredDefinition: 'Only POD-confirmed quantities count as delivered.' }));
    return this.page(data, query, this.requestId());
  }

  async exceptions(context: IntegrationContext, query: IntegrationQuery) {
    this.scope(context, 'fulfilment:read');
    return this.page(await this.rows(context, 'scm', 'delivery_exceptions', query, 'created_at'), query, this.requestId());
  }

  async shortClosures(context: IntegrationContext, query: IntegrationQuery) {
    this.scope(context, 'po:read');
    const [decisions, lines] = await Promise.all([
      this.rows(context, 'scm', 'short_close_decisions', query, 'approved_at'),
      this.rows(context, 'scm', 'short_close_decision_lines', query, 'created_at'),
    ]);
    return this.page(decisions.map(decision => ({ ...decision, remainingQuantity: String(decision.remaining_quantity), lines: lines.filter(line => line.short_close_decision_id === decision.id).map(line => ({ ...line, approvedQuantity: String(line.approved_quantity) })) })), query, this.requestId());
  }

  async invoices(context: IntegrationContext, query: IntegrationQuery) {
    this.scope(context, 'po:read');
    const data = await this.rows(context, 'scm', 'invoices', query, 'uploaded_at');
    return this.page(data.map(invoice => ({ ...invoice, amount: String(invoice.amount ?? 0) })), query, this.requestId());
  }

  async valuations(context: IntegrationContext, query: IntegrationQuery) {
    this.scope(context, 'finance:read');
    const data = await this.rows(context, 'finance', 'valuation_ledger', query, 'posting_at');
    return this.page(data.map(row => ({ ...row, quantityDelta: String(row.quantity_delta), unitCost: String(row.unit_cost), valueDelta: String(row.value_delta), movingAverageAfter: String(row.moving_average_after) })), query, this.requestId());
  }

  async forecasts(context: IntegrationContext, query: IntegrationQuery) {
    this.scope(context, 'planning:read');
    const data = await this.rows(context, 'planning', 'forecasts', query, 'period_start');
    return this.page(data.map(row => ({ ...row, statisticalQuantity: String(row.statistical_quantity), overrideQuantity: row.override_quantity == null ? null : String(row.override_quantity), finalQuantity: String(row.final_quantity) })), query, this.requestId());
  }

  async inbound(context: IntegrationContext, query: IntegrationQuery) {
    this.scope(context, 'planning:read');
    const [orders, lines, receipts] = await Promise.all([
      this.rows(context, 'procurement', 'purchase_orders', query, 'created_at'),
      this.rows(context, 'procurement', 'purchase_order_lines', query),
      this.rows(context, 'procurement', 'goods_receipts', query, 'created_at'),
    ]);
    const data = orders.map(order => ({ ...order, lines: lines.filter(line => line.purchase_order_id === order.id), receipts: receipts.filter(receipt => receipt.purchase_order_id === order.id) }));
    return this.page(data, query, this.requestId());
  }

  async movements(context: IntegrationContext, query: IntegrationQuery) {
    this.scope(context, 'movement:read');
    const [transactions, entries] = await Promise.all([
      this.rows(context, 'inventory', 'stock_transactions', query, 'created_at'),
      this.rows(context, 'inventory', 'stock_ledger_entries', query, 'created_at'),
    ]);
    const data = transactions.map(transaction => ({ ...transaction, entries: entries.filter(entry => entry.stock_transaction_id === transaction.id).map(entry => ({ ...entry, quantityDelta: String(entry.quantity_delta), unitValue: String(entry.unit_value), valueDelta: String(entry.value_delta) })) }));
    return this.page(data, query, this.requestId());
  }

  async ownershipTransfers(context: IntegrationContext, query: IntegrationQuery) {
    this.scope(context, 'fulfilment:read');
    return this.page(await this.rows(context, 'scm', 'ownership_transfer_events', query, 'transferred_at'), query, this.requestId());
  }

  async changes(context: IntegrationContext, query: IntegrationQuery) {
    const hasRead = [...context.scopes].some(scope => scope.endsWith(':read'));
    if (!hasRead) throw new ForbiddenException('A read scope is required');
    const limit = this.limit(query.limit);
    const after = this.cursor(query.cursor);
    let request = this.supabase.schema('integration').from('change_log').select('*').eq('company_id', context.companyId).gt('sequence_id', after).order('sequence_id', { ascending: true }).limit(limit + 1);
    if (query.from) request = request.gte('changed_at', query.from);
    if (query.to) request = request.lt('changed_at', query.to);
    const { data, error } = await request;
    if (error) throw new BadRequestException(error.message);
    const rows = (data || []) as Row[];
    const hasMore = rows.length > limit;
    const pageRows = rows.slice(0, limit);
    const next = hasMore && pageRows.length ? this.encodeCursor(Number(pageRows[pageRows.length - 1].sequence_id)) : null;
    return { data: pageRows, page: { limit, hasMore, nextCursor: next }, meta: { requestId: this.requestId(), asOf: new Date().toISOString() } };
  }
}

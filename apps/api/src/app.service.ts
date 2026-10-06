import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { AuthenticatedUser, SupabaseService } from './supabase.service';

type Row = Record<string, any>;

@Injectable()
export class AppService {
  constructor(private readonly sb: SupabaseService) {}

  private key(value?: string) {
    return value?.trim() || randomUUID();
  }

  private write(user: AuthenticatedUser) {
    if (!user.canWrite) throw new ForbiddenException('Write access is required');
  }

  private approve(user: AuthenticatedUser) {
    if (!user.canApprove) throw new ForbiddenException('Approval access is required');
  }

  private result<T>(data: T | null, error: { message: string } | null): T {
    if (error) throw new BadRequestException(error.message);
    return data as T;
  }

  private async rpc<T>(schema: string, name: string, args: Row) {
    const { data, error } = await this.sb.rpc<T>(schema, name, args);
    return this.result(data, error);
  }

  private async rows(schema: string, table: string, companyId: string, order?: string) {
    let query = this.sb.schema(schema).from(table).select('*').eq('company_id', companyId);
    if (order) query = query.order(order, { ascending: false });
    const { data, error } = await query;
    return this.result<Row[]>(data, error) || [];
  }

  async listPos(user: AuthenticatedUser): Promise<Row[]> {
    const companyId = user.companyId;
    const [pos, lines, channels, sites, gates, appointments, reservations, reservationLines, shipments, shipmentLines, events, pods, podLines, invoices, exceptions] = await Promise.all([
      this.rows('scm', 'purchase_orders', companyId, 'created_at'),
      this.rows('scm', 'purchase_order_lines', companyId),
      this.rows('master_data', 'channels', companyId),
      this.rows('master_data', 'sites', companyId),
      this.rows('scm', 'po_gate_state_v', companyId),
      this.rows('scm', 'appointments', companyId),
      this.rows('inventory', 'reservations', companyId),
      this.rows('inventory', 'reservation_lines', companyId),
      this.rows('scm', 'shipments', companyId),
      this.rows('scm', 'shipment_lines', companyId),
      this.rows('scm', 'shipment_events', companyId),
      this.rows('scm', 'pods', companyId),
      this.rows('scm', 'pod_lines', companyId),
      this.rows('scm', 'invoices', companyId),
      this.rows('scm', 'delivery_exceptions', companyId),
    ]);
    const [items, documents] = await Promise.all([
      this.rows('master_data', 'items', companyId),
      this.rows('documents', 'document_versions', companyId),
    ]);
    const itemById = new Map(items.map(x => [x.id, x]));
    const shipmentById = new Map(shipments.map(x => [x.id, x]));

    return pos.map(po => {
      const poLines = lines.filter(x => x.purchase_order_id === po.id).map(line => {
        const relatedShipments = shipmentLines.filter(x => x.purchase_order_line_id === line.id);
        const reservationLine = reservationLines.find(x => x.purchase_order_line_id === line.id);
        return {
          ...line,
          poId: po.id,
          skuId: line.item_id,
          ordered: Number(line.ordered_quantity),
          allocated: Number(reservationLine?.reserved_quantity || 0),
          dispatched: relatedShipments.reduce((sum, x) => sum + Number(x.dispatched_quantity || 0), 0),
          delivered: relatedShipments.reduce((sum, x) => sum + Number(x.delivered_quantity || 0), 0),
          unitPrice: Number(line.unit_price),
          sku: itemById.get(line.item_id),
        };
      });
      const poShipments = shipments.filter(x => x.purchase_order_id === po.id).map(shipment => ({
        ...shipment,
        number: shipment.shipment_number,
        truckNumber: shipment.truck_number,
        driverName: shipment.driver_name,
        driverPhone: shipment.driver_phone,
        actualDispatch: shipment.actual_dispatch_at,
        expectedArrival: shipment.expected_arrival_at,
        lines: shipmentLines.filter(x => x.shipment_id === shipment.id),
        events: events.filter(x => x.shipment_id === shipment.id),
      }));
      const poPods = pods.filter(x => x.purchase_order_id === po.id).map(pod => ({
        ...pod,
        receiver: pod.receiver_name,
        lines: podLines.filter(x => x.pod_id === pod.id),
      }));
      const activeReservation = reservations.find(x => x.purchase_order_id === po.id && ['ACTIVE', 'PARTIALLY_DISPATCHED'].includes(x.status));
      const activeAppointment = appointments.find(x => x.purchase_order_id === po.id && x.active);
      return {
        ...po,
        externalId: po.external_id,
        poDate: po.po_date,
        totalValue: Number(po.total_value),
        destination: po.destination_name,
        warehouseId: po.source_site_id,
        createdAt: po.created_at,
        platform: channels.find(x => x.id === po.channel_id),
        warehouse: sites.find(x => x.id === po.source_site_id),
        document: documents.find(x => x.id === po.source_document_version_id) || null,
        gate: gates.find(x => x.purchase_order_id === po.id),
        appointment: activeAppointment ? { ...activeAppointment, appointmentId: activeAppointment.appointment_number, location: activeAppointment.location_name } : null,
        reservation: activeReservation || null,
        lines: poLines,
        shipments: poShipments,
        pods: poPods,
        invoice: invoices.find(x => x.purchase_order_id === po.id) || null,
        exceptions: exceptions.filter(x => x.purchase_order_id === po.id),
      } as Row;
    });
  }

  async dashboard(user: AuthenticatedUser) {
    const [pos, inventory] = await Promise.all([this.listPos(user), this.inventory(user)]);
    const counts = pos.reduce<Row>((result, po) => {
      result[po.status] = (result[po.status] || 0) + 1;
      return result;
    }, {});
    return { counts, recent: pos.slice(0, 8), inventory };
  }

  async masters(user: AuthenticatedUser) {
    const companyId = user.companyId;
    const [platforms, warehouses, skus, mappings, itemIdentifiers, routes, locations, uoms] = await Promise.all([
      this.rows('master_data', 'channels', companyId),
      this.rows('master_data', 'sites', companyId),
      this.rows('master_data', 'items', companyId),
      this.rows('master_data', 'destination_mappings', companyId),
      this.rows('master_data', 'item_identifiers', companyId),
      this.rows('master_data', 'routes', companyId),
      this.rows('master_data', 'locations', companyId),
      this.sb.schema('master_data').from('uoms').select('*').eq('active', true),
    ]);
    return { platforms, warehouses, skus, mappings, itemIdentifiers, routes, locations, uoms: this.result(uoms.data, uoms.error) || [] };
  }

  async inventory(user: AuthenticatedUser) {
    const [rows, items, sites] = await Promise.all([
      this.rows('inventory', 'inventory_summary_v', user.companyId),
      this.rows('master_data', 'items', user.companyId),
      this.rows('master_data', 'sites', user.companyId),
    ]);
    return rows.map(row => ({
      ...row,
      skuId: row.item_id,
      warehouseId: row.site_id,
      inTransit: Number(row.in_transit),
      physical: Number(row.physical),
      blocked: Number(row.blocked),
      released: Number(row.released),
      threshold: Number(row.threshold),
      allocatable: Number(row.allocatable),
      sku: items.find(x => x.id === row.item_id),
      warehouse: sites.find(x => x.id === row.site_id),
    }));
  }

  async inventoryTransactions(user: AuthenticatedUser) {
    const [transactions, entries] = await Promise.all([
      this.rows('inventory', 'stock_transactions', user.companyId, 'created_at'),
      this.rows('inventory', 'stock_ledger_entries', user.companyId),
    ]);
    return transactions.slice(0, 200).map(transaction => ({
      ...transaction,
      entries: entries.filter(entry => entry.stock_transaction_id === transaction.id),
    }));
  }

  private async updateCompanyRow(user: AuthenticatedUser, schema: string, table: string, id: string, body: Row, fields: string[]) {
    this.approve(user);
    const payload = Object.fromEntries(fields.filter(field => body[field] !== undefined).map(field => [field, body[field]]));
    if (!Object.keys(payload).length) throw new BadRequestException('No changes supplied');
    const { data, error } = await this.sb.schema(schema).from(table).update(payload).eq('id', id).eq('company_id', user.companyId).select().single();
    return this.result(data, error);
  }

  async auditLog(user: AuthenticatedUser) {
    const [events, users] = await Promise.all([
      this.rows('platform', 'audit_events', user.companyId, 'occurred_at'),
      this.sb.schema('iam').from('users').select('id,email,display_name,role'),
    ]);
    return events.slice(0, 100).map(event => ({
      ...event,
      user: users.data?.find(x => x.id === event.actor_id),
      recordType: event.entity_type,
      recordId: event.entity_id,
      createdAt: event.occurred_at,
      oldValue: event.old_value,
      newValue: event.new_value,
    }));
  }

  async createSku(user: AuthenticatedUser, body: Row) {
    this.approve(user);
    const uomId = body.uomId || (await this.sb.schema('master_data').from('uoms').select('id').eq('active', true).limit(1).single()).data?.id;
    if (!body.code || !body.name || !uomId) throw new BadRequestException('Code, name and a UOM are required');
    const { data, error } = await this.sb.schema('master_data').from('items').insert({ company_id: user.companyId, code: body.code, name: body.name, item_class: body.itemClass || 'FG', base_uom_id: uomId, lifecycle_status: 'DRAFT' }).select().single();
    return this.result(data, error);
  }

  async createWarehouse(user: AuthenticatedUser, body: Row) {
    this.approve(user);
    const { data, error } = await this.sb.schema('master_data').from('sites').insert({ company_id: user.companyId, code: body.code, name: body.name, city: body.city, state: body.state, site_type: 'WAREHOUSE' }).select().single();
    return this.result(data, error);
  }

  async updateSku(user: AuthenticatedUser, id: string, body: Row) {
    return this.updateCompanyRow(user, 'master_data', 'items', id, body, ['code', 'name', 'item_class', 'brand', 'category', 'variant', 'base_uom_id', 'lifecycle_status', 'active_from', 'active_to']);
  }

  async updateWarehouse(user: AuthenticatedUser, id: string, body: Row) {
    return this.updateCompanyRow(user, 'master_data', 'sites', id, body, ['code', 'name', 'city', 'state', 'active']);
  }

  async createLocation(user: AuthenticatedUser, body: Row) {
    this.approve(user);
    if (!body.warehouseId || !body.code || !body.name || !body.locationType) throw new BadRequestException('Warehouse, code, name and location type are required');
    const { data, error } = await this.sb.schema('master_data').from('locations').insert({ company_id: user.companyId, site_id: body.warehouseId, code: body.code, name: body.name, location_type: body.locationType, barcode: body.barcode || null, virtual: Boolean(body.virtual) }).select().single();
    return this.result(data, error);
  }

  async updateLocation(user: AuthenticatedUser, id: string, body: Row) {
    return this.updateCompanyRow(user, 'master_data', 'locations', id, body, ['code', 'name', 'location_type', 'barcode', 'active']);
  }

  async createMapping(user: AuthenticatedUser, body: Row) {
    this.approve(user);
    if (body.mappingType === 'CHANNEL_SKU') {
      if (!body.skuId || !body.channelId || !body.value) throw new BadRequestException('Channel, SKU and external code are required');
      const { data, error } = await this.sb.schema('master_data').from('item_identifiers').insert({ company_id: user.companyId, item_id: body.skuId, channel_id: body.channelId, identifier_type: 'CHANNEL_SKU', value: body.value }).select().single();
      return this.result(data, error);
    }
    if (!body.channelId || !body.destinationKey || !body.destinationName || !body.warehouseId || !body.locationId) throw new BadRequestException('Channel, destination, warehouse and location are required');
    const { data, error } = await this.sb.schema('master_data').from('destination_mappings').insert({ company_id: user.companyId, channel_id: body.channelId, destination_key: body.destinationKey, destination_name: body.destinationName, fc_code: body.fcCode || null, source_site_id: body.warehouseId, source_location_id: body.locationId }).select().single();
    return this.result(data, error);
  }

  async updateMapping(user: AuthenticatedUser, id: string, body: Row) {
    const table = body.mappingType === 'CHANNEL_SKU' ? 'item_identifiers' : 'destination_mappings';
    const fields = body.mappingType === 'CHANNEL_SKU' ? ['value', 'active'] : ['destination_key', 'destination_name', 'fc_code', 'source_site_id', 'source_location_id', 'active'];
    return this.updateCompanyRow(user, 'master_data', table, id, body, fields);
  }

  async createRoute(user: AuthenticatedUser, body: Row) {
    this.approve(user);
    if (!body.warehouseId || !body.destinationKey || Number(body.transitHours) <= 0) throw new BadRequestException('Warehouse, destination and transit hours are required');
    const { data, error } = await this.sb.schema('master_data').from('routes').insert({ company_id: user.companyId, source_site_id: body.warehouseId, destination_key: body.destinationKey, transit_hours: Number(body.transitHours), estimated_cost: Number(body.estimatedCost || 0), currency: body.currency || 'INR' }).select().single();
    return this.result(data, error);
  }

  async updateRoute(user: AuthenticatedUser, id: string, body: Row) {
    return this.updateCompanyRow(user, 'master_data', 'routes', id, body, ['destination_key', 'transit_hours', 'estimated_cost', 'currency', 'active']);
  }

  async createUom(user: AuthenticatedUser, body: Row) {
    this.approve(user);
    if (!body.code || !body.name || !body.dimension) throw new BadRequestException('Code, name and dimension are required');
    const { data, error } = await this.sb.schema('master_data').from('uoms').insert({ code: body.code, name: body.name, dimension: body.dimension, decimal_places: Number(body.decimalPlaces || 3) }).select().single();
    return this.result(data, error);
  }

  async updateUom(user: AuthenticatedUser, id: string, body: Row) {
    this.approve(user);
    const payload = Object.fromEntries(['code', 'name', 'dimension', 'decimal_places', 'active'].filter(field => body[field] !== undefined).map(field => [field, body[field]]));
    const { data, error } = await this.sb.schema('master_data').from('uoms').update(payload).eq('id', id).select().single();
    return this.result(data, error);
  }

  async addStock(user: AuthenticatedUser, body: Row, idempotencyKey?: string) {
    this.write(user);
    return this.rpc('inventory', 'add_stock', { p_company_id: user.companyId, p_site_id: body.warehouseId, p_location_id: body.locationId, p_item_id: body.skuId, p_uom_id: body.uomId, p_quantity: Number(body.quantity), p_reason: body.reason || null, p_actor_id: user.id, p_idempotency_key: this.key(idempotencyKey) });
  }

  async createPo(user: AuthenticatedUser, body: Row, idempotencyKey?: string) {
    this.write(user);
    let documentVersionId = body.documentVersionId;
    if (!documentVersionId && body.document?.sha256) {
      const { data } = await this.sb.schema('documents').from('document_versions').select('id').eq('company_id', user.companyId).eq('sha256', body.document.sha256).order('uploaded_at', { ascending: false }).limit(1).maybeSingle();
      documentVersionId = data?.id;
    }
    const payload = { ...body, documentVersionId, companyId: user.companyId, channelId: body.channelId || body.platformId, lines: (body.lines || []).map((line: Row, index: number) => ({ ...line, lineNumber: line.lineNumber || index + 1, itemId: line.itemId || line.skuId })) };
    return this.rpc('scm', 'create_purchase_order', { p_payload: payload, p_actor_id: user.id, p_idempotency_key: this.key(idempotencyKey) });
  }

  async acceptPo(user: AuthenticatedUser, id: string, idempotencyKey?: string) {
    this.write(user);
    return this.rpc('scm', 'record_acceptance', { p_purchase_order_id: id, p_decision: 'ACCEPTED', p_reason: null, p_actor_id: user.id, p_idempotency_key: this.key(idempotencyKey) });
  }

  async rejectPo(user: AuthenticatedUser, id: string, reason: string, idempotencyKey?: string) {
    this.write(user);
    if (!reason?.trim()) throw new BadRequestException('Reason is required');
    return this.rpc('scm', 'record_acceptance', { p_purchase_order_id: id, p_decision: 'REJECTED', p_reason: reason, p_actor_id: user.id, p_idempotency_key: this.key(idempotencyKey) });
  }

  async appointment(user: AuthenticatedUser, id: string, body: Row, idempotencyKey?: string) {
    this.write(user);
    if (!body.documentVersionId) throw new BadRequestException('Appointment document version is required');
    return this.rpc('scm', 'record_appointment', { p_purchase_order_id: id, p_appointment_number: body.appointmentId, p_appointment_at: body.appointmentAt, p_location_name: body.location, p_match_status: body.matchStatus || 'MATCHED', p_document_version_id: body.documentVersionId, p_actor_id: user.id, p_idempotency_key: this.key(idempotencyKey), p_match_details: body.matchDetails || {} });
  }

  async shipment(user: AuthenticatedUser, id: string, body: Row, idempotencyKey?: string) {
    this.write(user);
    return this.rpc('scm', 'create_shipment', { p_purchase_order_id: id, p_lines: body.lines || [], p_vehicle: body, p_actor_id: user.id, p_idempotency_key: this.key(idempotencyKey) });
  }

  async dispatch(user: AuthenticatedUser, id: string, idempotencyKey?: string) {
    this.write(user);
    return this.rpc('scm', 'dispatch_shipment', { p_shipment_id: id, p_actor_id: user.id, p_idempotency_key: this.key(idempotencyKey) });
  }

  async shipmentEvent(user: AuthenticatedUser, id: string, body: Row, idempotencyKey?: string) {
    this.write(user);
    return this.rpc('scm', 'record_shipment_event', { p_shipment_id: id, p_status: body.status, p_event_at: body.eventAt || new Date().toISOString(), p_location_name: body.location || null, p_notes: body.notes || null, p_actor_id: user.id, p_idempotency_key: this.key(idempotencyKey) });
  }

  async reverseStock(user: AuthenticatedUser, id: string, body: Row, idempotencyKey?: string) {
    this.approve(user);
    if (!body.reason?.trim()) throw new BadRequestException('Reason is required');
    return this.rpc('inventory', 'reverse_stock_transaction', { p_transaction_id: id, p_reason: body.reason, p_actor_id: user.id, p_idempotency_key: this.key(idempotencyKey) });
  }

  async pod(user: AuthenticatedUser, id: string, body: Row, idempotencyKey?: string) {
    this.write(user);
    if (!body.documentVersionId) throw new BadRequestException('POD document version is required');
    return this.rpc('scm', 'record_pod', { p_purchase_order_id: id, p_document_version_id: body.documentVersionId, p_delivery_at: body.deliveryAt || new Date().toISOString(), p_receiver_name: body.receiver, p_lines: body.lines || [], p_actor_id: user.id, p_idempotency_key: this.key(idempotencyKey) });
  }

  async shortClose(user: AuthenticatedUser, id: string, body: Row, idempotencyKey?: string) {
    this.approve(user);
    if (!body.reason?.trim() || Number(body.remainingQuantity) <= 0) throw new BadRequestException('Reason and remaining quantity are required');
    return this.rpc('scm', 'short_close_purchase_order', { p_purchase_order_id: id, p_reason: body.reason, p_remaining_quantity: Number(body.remainingQuantity), p_actor_id: user.id, p_idempotency_key: this.key(idempotencyKey) });
  }

  async invoice(user: AuthenticatedUser, id: string, body: Row, idempotencyKey?: string) {
    this.write(user);
    if (!body.documentVersionId) throw new BadRequestException('Invoice document version is required');
    return this.rpc('scm', 'upload_invoice', { p_purchase_order_id: id, p_invoice_number: body.number, p_invoice_date: body.invoiceDate, p_amount: Number(body.amount), p_currency: body.currency || 'INR', p_document_version_id: body.documentVersionId, p_recipients: body.recipients || [], p_actor_id: user.id, p_idempotency_key: this.key(idempotencyKey) });
  }
}

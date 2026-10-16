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

  private superAdmin(user: AuthenticatedUser) {
    if (user.role !== 'SUPER_ADMIN') throw new ForbiddenException('System-admin access is required');
  }

  private scoped(user: AuthenticatedUser) {
    return typeof (this.sb as any).userClient === 'function' ? this.sb.userClient(user) : ((this.sb as any).client || (this.sb as any));
  }

  private result<T>(data: T | null, error: { message: string } | null): T {
    if (error) throw new BadRequestException(error.message);
    return data as T;
  }

  private async rpc<T>(schema: string, name: string, args: Row) {
    const { data, error } = await this.sb.rpc<T>(schema, name, args);
    return this.result(data, error);
  }

  private async auditMutation(user: AuthenticatedUser, action: string, entityType: string, entityId: string, oldValue: any, newValue: any, reason?: string) {
    const { error } = await this.sb.rpc('platform', 'write_audit', {
      p_company_id: user.companyId,
      p_actor_id: user.id,
      p_action: action,
      p_entity_type: entityType,
      p_entity_id: entityId,
      p_old_value: oldValue || null,
      p_new_value: newValue || null,
      p_reason: reason || null,
      p_source: 'API',
    });
    if (error) throw new BadRequestException(`Audit logging failed: ${error.message}`);
  }

  async auditRead(user: AuthenticatedUser, action: string, entityType: string, entityId: string, newValue: any) {
    await this.auditMutation(user, action, entityType, entityId, null, newValue);
  }

  private async rows(schema: string, table: string, companyId: string, order?: string, client = this.sb.client) {
    const result: Row[] = [];
    const pageSize = 500;
    for (let offset = 0; ; offset += pageSize) {
      let query = client.schema(schema).from(table).select('*').eq('company_id', companyId);
      if (order) query = query.order(order, { ascending: false });
      if (table === 'po_gate_state_v') query = query.order('purchase_order_id');
      else if (table === 'inventory_summary_v') query = query.order('item_id').order('site_id').order('uom_id');
      else query = query.order('id');
      const { data, error } = await query.range(offset, offset + pageSize - 1);
      const page = this.result<Row[]>(data, error) || [];
      result.push(...page);
      if (page.length < pageSize) return result;
    }
  }

  private async ownedRow(user: AuthenticatedUser, schema: string, table: string, id: string, columns = 'id', client = this.scoped(user)): Promise<Row> {
    const { data, error } = await client.schema(schema).from(table).select(columns).eq('id', id).eq('company_id', user.companyId).maybeSingle();
    if (error) throw new BadRequestException(error.message);
    if (!data) throw new BadRequestException(`${table} record does not belong to this company`);
    return data as Row;
  }

  async listPos(user: AuthenticatedUser): Promise<Row[]> {
    const companyId = user.companyId;
    const scoped = this.scoped(user);
    const [pos, lines, channels, sites, routes, gates, appointments, appointmentDocuments, reservations, reservationLines, shipments, shipmentLines, events, pods, podLines, invoices, exceptions, consignments] = await Promise.all([
      this.rows('scm', 'purchase_orders', companyId, 'created_at', scoped),
      this.rows('scm', 'purchase_order_lines', companyId, undefined, scoped),
      this.rows('master_data', 'channels', companyId, undefined, scoped),
      this.rows('master_data', 'sites', companyId, undefined, scoped),
      this.rows('master_data', 'routes', companyId, undefined, scoped),
      this.rows('scm', 'po_gate_state_v', companyId, undefined, scoped),
      this.rows('scm', 'appointments', companyId, undefined, scoped),
      this.rows('scm', 'appointment_documents', companyId, undefined, scoped),
      this.rows('inventory', 'reservations', companyId, undefined, scoped),
      this.rows('inventory', 'reservation_lines', companyId, undefined, scoped),
      this.rows('scm', 'shipments', companyId, undefined, scoped),
      this.rows('scm', 'shipment_lines', companyId, undefined, scoped),
      this.rows('scm', 'shipment_events', companyId, undefined, scoped),
      this.rows('scm', 'pods', companyId, undefined, scoped),
      this.rows('scm', 'pod_lines', companyId, undefined, scoped),
      this.rows('scm', 'invoices', companyId, undefined, scoped),
      this.rows('scm', 'delivery_exceptions', companyId, undefined, scoped),
      this.rows('scm', 'consignments', companyId, undefined, scoped),
    ]);
    const [items, documents, extractionRuns, destinationFacilities] = await Promise.all([
      this.rows('master_data', 'items', companyId, undefined, scoped),
      this.rows('documents', 'document_versions', companyId, undefined, scoped),
      this.rows('documents', 'extraction_runs', companyId, 'created_at', scoped),
      this.rows('master_data', 'destination_facilities', companyId, undefined, scoped),
    ]);
    const itemById = new Map(items.map(x => [x.id, x]));
    const documentById = new Map(documents.map(x => [x.id, x]));
    const extractionRunByDocumentId = new Map<string, Row>();
    for (const run of extractionRuns) {
      if (!extractionRunByDocumentId.has(run.document_version_id)) extractionRunByDocumentId.set(run.document_version_id, run);
    }
    const destinationFacilityById = new Map(destinationFacilities.map(facility => [facility.id, facility]));
    const shipmentById = new Map(shipments.map(x => [x.id, x]));

    return pos.map(po => {
      const poLines = lines.filter(x => x.purchase_order_id === po.id && x.active !== false).map(line => {
        const relatedShipments = shipmentLines.filter(x => x.purchase_order_line_id === line.id);
        const activeReservationForLine = reservations.find(x => x.purchase_order_id === po.id && ['ACTIVE', 'PARTIALLY_DISPATCHED'].includes(x.status));
        const reservationLine = reservationLines.find(x => x.purchase_order_line_id === line.id && x.reservation_id === activeReservationForLine?.id);
        const ordered = Number(line.ordered_quantity);
        const allocated = Number(reservationLine?.reserved_quantity || 0);
        const planned = relatedShipments
          .filter(x => shipmentById.get(x.shipment_id)?.status !== 'CANCELLED')
          .reduce((sum, x) => sum + Number(x.planned_quantity || 0), 0);
        const dispatched = relatedShipments.reduce((sum, x) => sum + Number(x.dispatched_quantity || 0), 0);
        const delivered = relatedShipments.reduce((sum, x) => sum + Number(x.delivered_quantity || 0), 0);
        return {
          ...line,
          poId: po.id,
          skuId: line.item_id,
          ordered,
          allocated,
          planned,
          dispatched,
          delivered,
          availableToPlan: Math.max(0, allocated - planned),
          availableToReceive: Math.max(0, dispatched - delivered),
          fillRate: ordered > 0 ? Math.round((delivered / ordered) * 10000) / 100 : 0,
          unitPrice: Number(line.unit_price),
          sku: itemById.get(line.item_id),
        };
      });
      const poShipments = shipments.filter(x => x.purchase_order_id === po.id).map(shipment => ({
        ...shipment,
        number: shipment.shipment_number,
        sourceAddress: shipment.source_address || po.source_address || null,
        sourceCity: shipment.source_city || po.source_city || sites.find(x => x.id === shipment.source_site_id)?.city || null,
        destinationAddress: shipment.destination_address || po.destination_address || po.destination_name || null,
        destinationCity: shipment.destination_city || po.destination_city || null,
        destinationState: shipment.destination_state || po.destination_state || null,
        destinationPostalCode: shipment.destination_postal_code || po.destination_postal_code || null,
        destinationCode: shipment.destination_code || po.destination_key || null,
        truckNumber: shipment.truck_number,
        driverName: shipment.driver_name,
        driverPhone: shipment.driver_phone,
        lrFilename: documentById.get(shipment.lr_document_version_id)?.filename || null,
        actualDispatch: shipment.actual_dispatch_at,
        expectedArrival: shipment.expected_arrival_at,
        lines: shipmentLines.filter(x => x.shipment_id === shipment.id),
        events: events.filter(x => x.shipment_id === shipment.id),
      }));
      const poPods = pods.filter(x => x.purchase_order_id === po.id).map(pod => ({
        ...pod,
        filename: documentById.get(pod.document_version_id)?.filename || null,
        receiver: pod.receiver_name,
        lines: podLines.filter(x => x.pod_id === pod.id),
        shipmentIds: [...new Set(podLines.filter(x => x.pod_id === pod.id).map(x => shipmentLines.find(line => line.id === x.shipment_line_id)?.shipment_id).filter(Boolean))],
      }));
      const activeReservation = reservations.find(x => x.purchase_order_id === po.id && ['ACTIVE', 'PARTIALLY_DISPATCHED'].includes(x.status));
      const poAppointments: Row[] = appointments.filter(x => x.purchase_order_id === po.id).map(appointment => ({
        ...appointment,
        files: appointmentDocuments.filter(x => x.appointment_id === appointment.id).map(x => ({ documentVersionId: x.document_version_id, filename: documentById.get(x.document_version_id)?.filename || null })),
      }));
      const activeAppointment = poAppointments.find(x => x.active);
      const appointmentFiles = activeAppointment?.files || [];
      return {
        ...po,
        externalId: po.external_id,
        poDate: po.po_date,
        totalValue: Number(po.total_value),
        customer: po.customer_name,
        acceptedAt: gates.find(x => x.purchase_order_id === po.id)?.accepted_at || null,
        destination: po.destination_name,
        destinationAddress: po.destination_address || po.destination_name,
        destinationCity: po.destination_city || null,
        destinationState: po.destination_state || null,
        destinationPostalCode: po.destination_postal_code || null,
        sourceAddress: po.source_address || null,
        sourceCity: po.source_city || sites.find(x => x.id === po.source_site_id)?.city || null,
        sourceState: po.source_state || sites.find(x => x.id === po.source_site_id)?.state || null,
        sourcePostalCode: po.source_postal_code || null,
        warehouseId: po.source_site_id,
        createdAt: po.created_at,
        platform: channels.find(x => x.id === po.channel_id),
        warehouse: sites.find(x => x.id === po.source_site_id),
         route: routes.find(route => route.active !== false && route.source_site_id === po.source_site_id && (route.destination_facility_id === po.destination_facility_id || String(route.destination_key || '').toLowerCase() === String(po.destination_key || '').toLowerCase() || String(route.destination_city || '').toLowerCase() === String(po.destination_city || '').toLowerCase())) || null,
         destinationFacility: destinationFacilityById.get(po.destination_facility_id) || null,
        document: documentById.get(po.source_document_version_id) || null,
         extraction: extractionRunByDocumentId.get(po.source_document_version_id) || null,
        gate: gates.find(x => x.purchase_order_id === po.id),
        appointment: activeAppointment ? { ...activeAppointment, files: appointmentFiles, filename: appointmentFiles[0]?.filename || null, documentVersionId: appointmentFiles[0]?.documentVersionId || null, appointmentId: activeAppointment.appointment_number, appointmentAt: activeAppointment.appointment_at, location: activeAppointment.location_name, sourceAddress: activeAppointment.source_address, sourceCity: activeAppointment.source_city, sourceState: activeAppointment.source_state, sourcePostalCode: activeAppointment.source_postal_code, destinationAddress: activeAppointment.destination_address, destinationCity: activeAppointment.destination_city, destinationState: activeAppointment.destination_state, destinationPostalCode: activeAppointment.destination_postal_code, facilityName: activeAppointment.facility_name, resolutionStatus: activeAppointment.resolution_status, matchDetails: activeAppointment.match_details } : null,
        appointmentHistory: poAppointments.filter(x => !x.active),
        reservation: activeReservation || null,
        lines: poLines,
        shipments: poShipments,
        consignments: consignments.filter(x => x.purchase_order_id === po.id).map(consignment => ({ ...consignment, filename: documentById.get(consignment.document_version_id)?.filename || null })),
        pods: poPods,
        invoice: (() => { const invoice = invoices.find(x => x.purchase_order_id === po.id); return invoice ? { ...invoice, filename: documentById.get(invoice.document_version_id)?.filename || null } : null; })(),
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
    const scoped = this.scoped(user);
    const [platforms, sites, skus, mappings, itemIdentifiers, routes, locations, uoms, destinationFacilities] = await Promise.all([
      this.rows('master_data', 'channels', companyId, undefined, scoped),
      this.rows('master_data', 'sites', companyId, undefined, scoped),
      this.rows('master_data', 'items', companyId, undefined, scoped),
      this.rows('master_data', 'destination_mappings', companyId, undefined, scoped),
      this.rows('master_data', 'item_identifiers', companyId, undefined, scoped),
      this.rows('master_data', 'routes', companyId, undefined, scoped),
      this.rows('master_data', 'locations', companyId, undefined, scoped),
      scoped.schema('master_data').from('uoms').select('*').eq('active', true),
      this.rows('master_data', 'destination_facilities', companyId, undefined, scoped),
    ]);
    const warehouses = (sites || []).filter((site: Row) => site.site_type === 'WAREHOUSE');
    return { platforms, warehouses, skus, mappings, itemIdentifiers, routes, locations, destinationFacilities, uoms: this.result(uoms.data, uoms.error) || [] };
  }

  async inventory(user: AuthenticatedUser) {
    const scoped = this.scoped(user);
    const [rows, items, sites, shipments, shipmentLines, poLines] = await Promise.all([
      this.rows('inventory', 'inventory_summary_v', user.companyId, undefined, scoped),
      this.rows('master_data', 'items', user.companyId, undefined, scoped),
      this.rows('master_data', 'sites', user.companyId, undefined, scoped),
      this.rows('scm', 'shipments', user.companyId, undefined, scoped),
      this.rows('scm', 'shipment_lines', user.companyId, undefined, scoped),
      this.rows('scm', 'purchase_order_lines', user.companyId, undefined, scoped),
    ]);
    const shipmentsById = new Map(shipments.map(shipment => [shipment.id, shipment]));
    const poLinesById = new Map(poLines.map(line => [line.id, line]));
    const transitBySiteItem = new Map<string, number>();
    for (const line of shipmentLines) {
      const shipment = shipmentsById.get(line.shipment_id);
      const poLine = poLinesById.get(line.purchase_order_line_id);
      if (!shipment || !poLine || shipment.status === 'CANCELLED') continue;
      const quantity = Math.max(0, Number(line.dispatched_quantity || 0) - Number(line.delivered_quantity || 0) - Number(line.damaged_quantity || 0) - Number(line.rejected_quantity || 0));
      const key = `${shipment.source_site_id}:${poLine.item_id}`;
      transitBySiteItem.set(key, (transitBySiteItem.get(key) || 0) + quantity);
    }
    return rows
      .filter(row => sites.find(site => site.id === row.site_id && site.site_type === 'WAREHOUSE' && site.active !== false))
      .map(row => ({
      ...row,
      skuId: row.item_id,
      warehouseId: row.site_id,
      inTransit: transitBySiteItem.get(`${row.site_id}:${row.item_id}`) || 0,
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
    const scoped = this.scoped(user);
    const [transactions, entries] = await Promise.all([
      this.rows('inventory', 'stock_transactions', user.companyId, 'created_at', scoped),
      this.rows('inventory', 'stock_ledger_entries', user.companyId, undefined, scoped),
    ]);
    return transactions.slice(0, 200).map(transaction => ({
      ...transaction,
      entries: entries.filter(entry => entry.stock_transaction_id === transaction.id),
    }));
  }

  private async updateCompanyRow(user: AuthenticatedUser, schema: string, table: string, id: string, body: Row, fields: string[]) {
    this.approve(user);
    const scoped = this.scoped(user);
    const payload = Object.fromEntries(fields.filter(field => body[field] !== undefined).map(field => [field, body[field]]));
    if (!Object.keys(payload).length) throw new BadRequestException('No changes supplied');
    const { data: oldValue, error: oldError } = await scoped.schema(schema).from(table).select('*').eq('id', id).eq('company_id', user.companyId).maybeSingle();
    if (oldError) throw new BadRequestException(oldError.message);
    if (!oldValue) throw new BadRequestException('Record not found');
    const { data, error } = await scoped.schema(schema).from(table).update(payload).eq('id', id).eq('company_id', user.companyId).select().single();
    const result = this.result(data, error);
    await this.auditMutation(user, 'MASTER_DATA_UPDATED', `${schema}.${table}`, id, oldValue, result);
    return result;
  }

  async auditLog(user: AuthenticatedUser) {
    const scoped = this.scoped(user);
    const [events, users] = await Promise.all([
      this.rows('platform', 'audit_events', user.companyId, 'occurred_at', scoped),
      scoped.schema('iam').from('users').select('id,email,display_name,role'),
    ]);
    return events.slice(0, 100).map(event => ({
      ...event,
      user: (() => { const actor = users.data?.find((x: any) => x.id === event.actor_id); return actor ? { ...actor, name: actor.display_name || actor.email } : null; })(),
      recordType: event.entity_type,
      recordId: event.entity_id,
      createdAt: event.occurred_at,
      oldValue: event.old_value,
      newValue: event.new_value,
    }));
  }

  async createSku(user: AuthenticatedUser, body: Row) {
    this.approve(user);
    const scoped = this.scoped(user);
    const uomId = body.uomId || (await scoped.schema('master_data').from('uoms').select('id').eq('active', true).limit(1).single()).data?.id;
    if (!body.code || !body.name || !uomId) throw new BadRequestException('Code, name and a UOM are required');
    const { data, error } = await scoped.schema('master_data').from('items').insert({ company_id: user.companyId, code: body.code, name: body.name, item_class: body.itemClass || 'FG', base_uom_id: uomId, lifecycle_status: 'ACTIVE' }).select().single();
    const result = this.result(data, error);
    await this.auditMutation(user, 'SKU_CREATED', 'MASTER_DATA_ITEM', result.id, null, result);
    return result;
  }

  async createWarehouse(user: AuthenticatedUser, body: Row) {
    this.approve(user);
    if (!body.code?.trim() || !body.name?.trim() || !body.city?.trim()) throw new BadRequestException('Warehouse code, name and city are required');
    return this.rpc('master_data', 'create_warehouse_with_stock_location', { p_payload: { ...body, companyId: user.companyId }, p_actor_id: user.id });
  }

  async updateSku(user: AuthenticatedUser, id: string, body: Row) {
    const normalized = { ...body, item_class: body.itemClass ?? body.item_class, base_uom_id: body.uomId ?? body.base_uom_id };
    return this.updateCompanyRow(user, 'master_data', 'items', id, normalized, ['code', 'name', 'item_class', 'brand', 'category', 'variant', 'base_uom_id', 'lifecycle_status', 'active_from', 'active_to']);
  }

  async createPlatform(user: AuthenticatedUser, body: Row) {
    this.approve(user);
    const scoped = this.scoped(user);
    if (!body.code?.trim() || !body.name?.trim()) throw new BadRequestException('Platform code and name are required');
    const { data, error } = await scoped.schema('master_data').from('channels').insert({ company_id: user.companyId, code: body.code.trim(), name: body.name.trim(), channel_type: body.channelType || 'MARKETPLACE', ingestion_method: body.ingestionMethod || 'FILE', active: body.active !== false }).select().single();
    const result = this.result(data, error);
    await this.auditMutation(user, 'PLATFORM_CREATED', 'MASTER_DATA_CHANNEL', result.id, null, result);
    return result;
  }

  async updatePlatform(user: AuthenticatedUser, id: string, body: Row) {
    const normalized = { ...body, channel_type: body.channel_type || body.channelType, ingestion_method: body.ingestion_method || body.ingestionMethod };
    const result = await this.updateCompanyRow(user, 'master_data', 'channels', id, normalized, ['code', 'name', 'channel_type', 'ingestion_method', 'active']);
    await this.auditMutation(user, body.active === false ? 'PLATFORM_DEACTIVATED' : 'PLATFORM_UPDATED', 'MASTER_DATA_CHANNEL', id, null, result);
    return result;
  }

  async deletePlatform(user: AuthenticatedUser, id: string) {
    this.approve(user);
    return this.rpc('master_data', 'delete_channel', {
      p_company_id: user.companyId,
      p_channel_id: id,
      p_actor_id: user.id,
    });
  }

  async updateWarehouse(user: AuthenticatedUser, id: string, body: Row) {
    const normalized = { ...body, address_line1: body.address_line1 || body.addressLine1, address_line2: body.address_line2 || body.addressLine2, postal_code: body.postal_code || body.postalCode };
    const result = await this.updateCompanyRow(user, 'master_data', 'sites', id, normalized, ['code', 'name', 'city', 'state', 'address_line1', 'address_line2', 'postal_code', 'active']);
    await this.auditMutation(user, body.active === false ? 'WAREHOUSE_DEACTIVATED' : 'WAREHOUSE_UPDATED', 'MASTER_DATA_SITE', id, null, result);
    return result;
  }

  async deleteWarehouse(user: AuthenticatedUser, id: string) {
    this.approve(user);
    return this.rpc('master_data', 'delete_warehouse', {
      p_company_id: user.companyId,
      p_site_id: id,
      p_actor_id: user.id,
    });
  }

  async createLocation(user: AuthenticatedUser, body: Row) {
    this.approve(user);
    const scoped = this.scoped(user);
    if (!body.warehouseId || !body.code || !body.name || !body.locationType) throw new BadRequestException('Warehouse, code, name and location type are required');
    const site = await this.ownedRow(user, 'master_data', 'sites', body.warehouseId, 'id,site_type');
    if (site.site_type !== 'WAREHOUSE') throw new BadRequestException('Stock locations require a warehouse site');
    const { data, error } = await scoped.schema('master_data').from('locations').insert({ company_id: user.companyId, site_id: body.warehouseId, code: body.code, name: body.name, location_type: body.locationType, barcode: body.barcode || null, virtual: Boolean(body.virtual) }).select().single();
    const result = this.result(data, error);
    await this.auditMutation(user, 'LOCATION_CREATED', 'MASTER_DATA_LOCATION', result.id, null, result);
    return result;
  }

  async updateLocation(user: AuthenticatedUser, id: string, body: Row) {
    return this.updateCompanyRow(user, 'master_data', 'locations', id, body, ['code', 'name', 'location_type', 'barcode', 'active']);
  }

  async createMapping(user: AuthenticatedUser, body: Row) {
    this.approve(user);
    const scoped = this.scoped(user);
    if (body.mappingType === 'CHANNEL_SKU') {
      if (!body.skuId || !body.channelId || !body.value) throw new BadRequestException('Channel, SKU and external code are required');
      await Promise.all([this.ownedRow(user, 'master_data', 'items', body.skuId), this.ownedRow(user, 'master_data', 'channels', body.channelId)]);
      const { data, error } = await scoped.schema('master_data').from('item_identifiers').insert({ company_id: user.companyId, item_id: body.skuId, channel_id: body.channelId, identifier_type: 'CHANNEL_SKU', value: body.value }).select().single();
      const result = this.result(data, error);
      await this.auditMutation(user, 'CHANNEL_SKU_MAPPING_CREATED', 'MASTER_DATA_ITEM_IDENTIFIER', result.id, null, result);
      return result;
    }
    if (!body.channelId || !body.destinationKey || !body.destinationName || !body.warehouseId || !body.locationId) throw new BadRequestException('Channel, destination, warehouse and location are required');
    const [site, location] = await Promise.all([
      this.ownedRow(user, 'master_data', 'sites', body.warehouseId, 'id,site_type'),
      this.ownedRow(user, 'master_data', 'locations', body.locationId, 'id,site_id'),
      this.ownedRow(user, 'master_data', 'channels', body.channelId),
    ]);
    if (site.site_type !== 'WAREHOUSE' || location.site_id !== site.id) throw new BadRequestException('Stock location must belong to the selected warehouse');
    const destinationFacilityId = await this.ensureDestinationFacility(user, body, scoped);
    const { data, error } = await scoped.schema('master_data').from('destination_mappings').insert({ company_id: user.companyId, channel_id: body.channelId, destination_key: body.destinationKey, destination_name: body.destinationName, fc_code: body.fcCode || null, destination_facility_id: destinationFacilityId, source_site_id: body.warehouseId, source_location_id: body.locationId }).select().single();
    const result = this.result(data, error);
    await this.auditMutation(user, 'DESTINATION_MAPPING_CREATED', 'MASTER_DATA_DESTINATION_MAPPING', result.id, null, result);
    return result;
  }

  async updateMapping(user: AuthenticatedUser, id: string, body: Row) {
    const table = body.mappingType === 'CHANNEL_SKU' ? 'item_identifiers' : 'destination_mappings';
    const fields = body.mappingType === 'CHANNEL_SKU' ? ['value', 'active'] : ['destination_key', 'destination_name', 'fc_code', 'source_site_id', 'source_location_id', 'active'];
    return this.updateCompanyRow(user, 'master_data', table, id, body, fields);
  }

  async createRoute(user: AuthenticatedUser, body: Row) {
    this.approve(user);
    const scoped = this.scoped(user);
    const destinationCity = body.destinationCity || body.destinationKey;
    if (!body.warehouseId || !destinationCity || Number(body.transitHours) <= 0) throw new BadRequestException('Warehouse, destination city and transit hours are required');
    const site = await this.ownedRow(user, 'master_data', 'sites', body.warehouseId, 'id,site_type');
    if (site.site_type !== 'WAREHOUSE') throw new BadRequestException('Route source must be a warehouse');
    const destinationFacilityId = await this.ensureDestinationFacility(user, { destinationKey: destinationCity, destinationName: body.destinationName || destinationCity, fcCode: body.fcCode }, scoped);
    const { data, error } = await scoped.schema('master_data').from('routes').insert({ company_id: user.companyId, source_site_id: body.warehouseId, destination_key: destinationCity, destination_city: destinationCity, destination_facility_id: destinationFacilityId, transit_hours: Number(body.transitHours), estimated_cost: Number(body.estimatedCost || 0), currency: body.currency || 'INR' }).select().single();
    const result = this.result(data, error);
    await this.auditMutation(user, 'ROUTE_CREATED', 'MASTER_DATA_ROUTE', result.id, null, result);
    return result;
  }

  private async ensureDestinationFacility(user: AuthenticatedUser, body: Row, scoped: any): Promise<string> {
    const code = String(body.destinationKey || '').trim();
    if (!code) throw new BadRequestException('Destination facility code is required');
    const facilities = scoped.schema('master_data').from('destination_facilities');
    const existing = await facilities.select('id').eq('company_id', user.companyId).eq('code', code).maybeSingle();
    if (existing.error) throw new BadRequestException(existing.error.message);
    if (existing.data?.id) return existing.data.id;
    const { data, error } = await facilities.insert({
      company_id: user.companyId,
      code,
      name: body.destinationName || code,
      fc_code: body.fcCode || null,
    }).select('id').single();
    if (!error && data?.id) return data.id;
    if (error?.code === '23505') {
      const retry = await facilities.select('id').eq('company_id', user.companyId).eq('code', code).maybeSingle();
      if (retry.data?.id) return retry.data.id;
    }
    throw new BadRequestException(error?.message || 'Destination facility could not be created');
  }

  async updateRoute(user: AuthenticatedUser, id: string, body: Row) {
    return this.updateCompanyRow(user, 'master_data', 'routes', id, body, ['destination_key', 'destination_city', 'transit_hours', 'estimated_cost', 'currency', 'active']);
  }

  async createUom(user: AuthenticatedUser, body: Row) {
    this.superAdmin(user);
    if (!body.code || !body.name || !body.dimension) throw new BadRequestException('Code, name and dimension are required');
    const { data, error } = await this.sb.schema('master_data').from('uoms').insert({ code: body.code, name: body.name, dimension: body.dimension, decimal_places: Number(body.decimalPlaces || 3) }).select().single();
    const result = this.result(data, error);
    await this.auditMutation(user, 'UOM_CREATED', 'MASTER_DATA_UOM', result.id, null, result);
    return result;
  }

  async updateUom(user: AuthenticatedUser, id: string, body: Row) {
    this.superAdmin(user);
    const payload = Object.fromEntries(['code', 'name', 'dimension', 'decimal_places', 'active'].filter(field => body[field] !== undefined).map(field => [field, body[field]]));
    const { data: oldValue, error: oldError } = await this.sb.schema('master_data').from('uoms').select('*').eq('id', id).maybeSingle();
    if (oldError) throw new BadRequestException(oldError.message);
    if (!oldValue) throw new BadRequestException('UOM not found');
    const { data, error } = await this.sb.schema('master_data').from('uoms').update(payload).eq('id', id).select().single();
    const result = this.result(data, error);
    await this.auditMutation(user, 'UOM_UPDATED', 'MASTER_DATA_UOM', id, oldValue, result);
    return result;
  }

  async addStock(user: AuthenticatedUser, body: Row, idempotencyKey?: string) {
    this.write(user);
    return this.rpc('inventory', 'add_stock', { p_company_id: user.companyId, p_site_id: body.warehouseId, p_location_id: body.locationId, p_item_id: body.skuId, p_uom_id: body.uomId, p_quantity: Number(body.quantity), p_reason: body.reason || null, p_actor_id: user.id, p_idempotency_key: this.key(idempotencyKey) });
  }

  async adjustStock(user: AuthenticatedUser, body: Row, idempotencyKey?: string) {
    this.write(user);
    const quantity = Number(body.quantity);
    const direction = body.direction === 'DECREASE' ? -1 : 1;
    if (!body.warehouseId || !body.skuId || !Number.isFinite(quantity) || quantity <= 0 || !body.reason?.trim()) {
      throw new BadRequestException('Warehouse, SKU, positive quantity, and reason are required');
    }
    return this.rpc('inventory', 'adjust_stock', {
      p_company_id: user.companyId,
      p_site_id: body.warehouseId,
      p_location_id: body.locationId || null,
      p_item_id: body.skuId,
      p_uom_id: body.uomId || null,
      p_delta: direction * quantity,
      p_reason: body.reason.trim(),
      p_actor_id: user.id,
      p_idempotency_key: this.key(idempotencyKey),
    });
  }

  async updateInventoryPolicy(user: AuthenticatedUser, body: Row) {
    this.approve(user);
    const siteId = body.warehouseId || body.siteId;
    const itemId = body.skuId || body.itemId;
    const threshold = Number(body.threshold);
    if (!siteId || !itemId || !Number.isFinite(threshold) || threshold < 0) {
      throw new BadRequestException('Warehouse, SKU and a non-negative threshold are required');
    }
    const effectiveFrom = body.effectiveFrom || new Date().toISOString().slice(0, 10);
    const { data: oldValue } = await this.sb.schema('inventory').from('inventory_policies').select('*').eq('company_id', user.companyId).eq('site_id', siteId).eq('item_id', itemId).eq('effective_from', effectiveFrom).maybeSingle();
    const { data, error } = await this.sb.schema('inventory').from('inventory_policies').upsert({
      company_id: user.companyId,
      site_id: siteId,
      item_id: itemId,
      threshold_quantity: threshold,
      safety_stock: Number(body.safetyStock || 0),
      reorder_point: Number(body.reorderPoint || threshold),
      eoq: Number(body.eoq || 0),
      maximum_stock: body.maximumStock === '' || body.maximumStock == null ? null : Number(body.maximumStock),
      service_level: body.serviceLevel == null || body.serviceLevel === '' ? null : Number(body.serviceLevel),
      effective_from: effectiveFrom,
      approved_by: user.id,
    }, { onConflict: 'site_id,item_id,effective_from' }).select().single();
    const result = this.result(data, error);
    await this.auditMutation(user, 'INVENTORY_POLICY_UPDATED', 'INVENTORY_POLICY', result.id, oldValue, result);
    return result;
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

  async updatePo(user: AuthenticatedUser, id: string, body: Row, idempotencyKey?: string) {
    this.write(user);
    if (body.lines !== undefined && (!Array.isArray(body.lines) || body.lines.length === 0)) {
      throw new BadRequestException('A PO needs at least one SKU line');
    }
    const payload = {
      ...body,
      ...(body.lines === undefined ? {} : {
        lines: body.lines.map((line: Row) => ({
          itemId: line.itemId || line.skuId,
          ordered: Number(line.ordered),
          unitPrice: Number(line.unitPrice || 0),
          channelItemCode: line.channelItemCode || null,
          description: line.description || null,
          taxRate: Number(line.taxRate || 0),
          uomId: line.uomId || null,
          deliveryWindowStart: line.deliveryWindowStart || null,
          deliveryWindowEnd: line.deliveryWindowEnd || null,
          minimumResidualShelfLifeDays: Number(line.minimumResidualShelfLifeDays || 0),
        })),
      }),
    };
    return this.rpc('scm', 'update_purchase_order', {
      p_purchase_order_id: id, p_payload: payload, p_actor_id: user.id,
      p_idempotency_key: this.key(idempotencyKey),
    });
  }

  async acceptPo(user: AuthenticatedUser, id: string, idempotencyKey?: string) {
    this.approve(user);
    return this.rpc('scm', 'record_acceptance', { p_purchase_order_id: id, p_decision: 'ACCEPTED', p_reason: null, p_actor_id: user.id, p_idempotency_key: this.key(idempotencyKey) });
  }

  async rejectPo(user: AuthenticatedUser, id: string, reason: string, idempotencyKey?: string) {
    this.approve(user);
    if (!reason?.trim()) throw new BadRequestException('Reason is required');
    return this.rpc('scm', 'record_acceptance', { p_purchase_order_id: id, p_decision: 'REJECTED', p_reason: reason, p_actor_id: user.id, p_idempotency_key: this.key(idempotencyKey) });
  }

  async appointment(user: AuthenticatedUser, id: string, body: Row, idempotencyKey?: string) {
    this.write(user);
    if (!body.documentVersionId) throw new BadRequestException('Appointment document version is required');
    const { data: po, error: poError } = await this.sb.schema('scm').from('purchase_orders').select('external_id,destination_key').eq('id', id).eq('company_id', user.companyId).maybeSingle();
    if (poError) throw new BadRequestException(poError.message);
    if (!po) throw new BadRequestException('Purchase order not found');
    const { data: run, error: runError } = await this.sb.schema('documents').from('extraction_runs').select('raw_output').eq('company_id', user.companyId).eq('document_version_id', body.documentVersionId).order('created_at', { ascending: false }).limit(1).maybeSingle();
    if (runError) throw new BadRequestException(runError.message);
    if (!run) throw new BadRequestException('Appointment extraction was not found');
    const extracted = run.raw_output || {};
    const linkedPoIds = Array.isArray(extracted.linkedPoIds) ? extracted.linkedPoIds.map((value: unknown) => String(value).trim().toUpperCase()) : [];
    const poId = String(po.external_id).trim().toUpperCase();
    const correctedPoId = String(body.linkedPoId || '').trim().toUpperCase();
    const sourcePoIds = String(extracted.text || '').toUpperCase().split(/[^A-Z0-9-]+/);
    if ((body.matchStatus || 'MATCHED') === 'MATCHED') {
      if (correctedPoId && correctedPoId !== poId) throw new BadRequestException('The PO number on the letter must match this PO');
      if (correctedPoId && !sourcePoIds.includes(correctedPoId)) throw new BadRequestException('The corrected PO number was not found in the appointment PDF text');
      if (!correctedPoId && !linkedPoIds.includes(poId)) throw new BadRequestException('Appointment letter does not list this PO number');
    }
    const documentFc = String(extracted.fcCode || '').trim().toUpperCase();
    const poFc = String(po.destination_key || '').trim().toUpperCase();
    if (documentFc && /^[A-Z]{3,4}\d/.test(poFc) && documentFc !== poFc) throw new BadRequestException('Appointment FC does not match the PO destination');
    const matchDetails = { ...(body.matchDetails || {}) };
    if (correctedPoId) matchDetails.linkedPoId = correctedPoId;
    else delete matchDetails.linkedPoId;
    for (const field of ['sourceAddress', 'destinationAddress']) {
      if (matchDetails[field] && (String(matchDetails[field]).length > 300 || /Vendor Central|All Rights Reserved|https?:\/\//i.test(String(matchDetails[field])))) delete matchDetails[field];
    }
    return this.rpc('scm', 'record_appointment', { p_purchase_order_id: id, p_appointment_number: body.appointmentId, p_appointment_at: body.appointmentAt, p_location_name: body.location, p_match_status: body.matchStatus || 'MATCHED', p_document_version_id: body.documentVersionId, p_actor_id: user.id, p_idempotency_key: this.key(idempotencyKey), p_match_details: matchDetails });
  }

  async shipment(user: AuthenticatedUser, id: string, body: Row, idempotencyKey?: string) {
    this.write(user);
    const { data: po, error: poError } = await this.sb.schema('scm').from('purchase_orders').select('source_site_id,destination_key,destination_city').eq('id', id).eq('company_id', user.companyId).maybeSingle();
    if (poError) throw new BadRequestException(poError.message);
    if (!po) throw new BadRequestException('Purchase order not found');
    let routeQuery = this.sb.schema('master_data').from('routes').select('id').eq('company_id', user.companyId).eq('source_site_id', po.source_site_id).eq('active', true);
    if (po.destination_key) routeQuery = routeQuery.eq('destination_key', po.destination_key);
    let { data: route, error: routeError } = await routeQuery.maybeSingle();
    if (routeError && routeError.code !== 'PGRST116') throw new BadRequestException(routeError.message);
    if (!route && po.destination_city) {
      const fallback = await this.sb.schema('master_data').from('routes').select('id').eq('company_id', user.companyId).eq('source_site_id', po.source_site_id).eq('destination_city', po.destination_city).eq('active', true).maybeSingle();
      route = fallback.data;
      routeError = fallback.error;
    }
    if (routeError) throw new BadRequestException(routeError.message);
    if (!route) throw new BadRequestException('No active route is configured for this source warehouse and destination');
    return this.rpc('scm', 'create_shipment', { p_purchase_order_id: id, p_lines: body.lines || [], p_vehicle: body, p_actor_id: user.id, p_idempotency_key: this.key(idempotencyKey) });
  }

  async consignment(user: AuthenticatedUser, id: string, body: Row) {
    this.write(user);
    if (!body.documentVersionId) throw new BadRequestException('Consignment document version is required');
    if (!body.consignmentNumber?.trim()) throw new BadRequestException('Consignment number is required');
    if (!body.shipmentId) throw new BadRequestException('Select a shipment for this consignment');
    const { data: po, error: poError } = await this.sb.schema('scm').from('purchase_orders').select('id').eq('id', id).eq('company_id', user.companyId).maybeSingle();
    if (poError) throw new BadRequestException(poError.message);
    if (!po) throw new BadRequestException('Purchase order not found');
    const { data: document, error: documentError } = await this.sb.schema('documents').from('document_versions').select('id').eq('id', body.documentVersionId).eq('company_id', user.companyId).maybeSingle();
    if (documentError) throw new BadRequestException(documentError.message);
    if (!document) throw new BadRequestException('Consignment document does not belong to this company');
    if (body.shipmentId) {
      const { data: shipment, error: shipmentError } = await this.sb.schema('scm').from('shipments').select('id').eq('id', body.shipmentId).eq('purchase_order_id', id).eq('company_id', user.companyId).maybeSingle();
      if (shipmentError) throw new BadRequestException(shipmentError.message);
      if (!shipment) throw new BadRequestException('Shipment does not belong to this PO');
    }
    const extracted = body.extracted || {};
    const { data, error } = await this.sb.schema('scm').from('consignments').insert({
      company_id: user.companyId,
      purchase_order_id: id,
      shipment_id: body.shipmentId || null,
      document_version_id: body.documentVersionId,
      consignment_number: body.consignmentNumber.trim(),
      source_name: body.sourceName || extracted.sourceAddress || null,
      destination_name: body.destinationName || extracted.destination || extracted.destinationAddress || null,
      delivery_at: body.deliveryAt || null,
      total_quantity: body.totalQuantity == null ? extracted.totalQuantity || null : Number(body.totalQuantity),
      total_value: body.totalValue == null ? extracted.totalValue || null : Number(body.totalValue),
      currency: body.currency || extracted.currency || 'INR',
      status: 'RECEIVED',
      extracted,
      created_by: user.id,
    }).select().single();
    const result = this.result(data, error);
    await this.auditMutation(user, 'CONSIGNMENT_RECORDED', 'SCM_CONSIGNMENT', result.id, null, result);
    return result;
  }

  async dispatch(user: AuthenticatedUser, id: string, idempotencyKey?: string) {
    this.write(user);
    return this.rpc('scm', 'dispatch_shipment', { p_shipment_id: id, p_actor_id: user.id, p_idempotency_key: this.key(idempotencyKey) });
  }

  async shipmentEvent(user: AuthenticatedUser, id: string, body: Row, idempotencyKey?: string) {
    this.write(user);
    if (['DELIVERED', 'CANCELLED', 'PARTIALLY_DELIVERED', 'RETURNED'].includes(body.status)) throw new BadRequestException('Use POD or the stock reversal workflow to change delivery or cancellation status');
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
    if (!body.shipmentId) throw new BadRequestException('Select a shipment for the POD');
    const shipment = await this.ownedRow(user, 'scm', 'shipments', body.shipmentId, 'id,purchase_order_id,status');
    if (shipment.purchase_order_id !== id || !['DISPATCHED', 'IN_TRANSIT', 'ARRIVED', 'UNLOADING', 'PARTIALLY_DELIVERED', 'DELIVERY_ISSUE'].includes(shipment.status)) {
      throw new BadRequestException('POD requires a dispatched shipment for this PO');
    }
    const { data: existingPod, error: existingError } = await this.sb.schema('scm').from('pods')
      .select('id').eq('company_id', user.companyId).eq('document_version_id', body.documentVersionId).maybeSingle();
    if (existingError) throw new BadRequestException(existingError.message);
    if (existingPod) throw new BadRequestException('This POD file is already attached to a shipment');
    const { data, error } = await this.sb.schema('scm').from('shipment_lines')
      .select('id,dispatched_quantity,delivered_quantity,damaged_quantity,rejected_quantity')
      .eq('company_id', user.companyId).eq('shipment_id', shipment.id);
    const lines = this.result<Row[]>(data, error).map(line => ({
      shipmentLineId: line.id,
      confirmed: Math.max(0, Number(line.dispatched_quantity || 0) - Number(line.delivered_quantity || 0) - Number(line.damaged_quantity || 0) - Number(line.rejected_quantity || 0)),
    })).filter(line => line.confirmed > 0);
    if (!lines.length) throw new BadRequestException('This shipment has no remaining dispatched units to deliver');
    return this.rpc('scm', 'record_pod', { p_purchase_order_id: id, p_document_version_id: body.documentVersionId, p_delivery_at: new Date().toISOString(), p_receiver_name: null, p_lines: lines, p_actor_id: user.id, p_idempotency_key: this.key(idempotencyKey) });
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

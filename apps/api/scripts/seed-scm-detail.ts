import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';

for (const file of [path.resolve(process.cwd(), '.env'), path.resolve(process.cwd(), 'apps/api/.env')]) {
  if (fs.existsSync(file)) dotenv.config({ path: file, override: false });
}

if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');
}

type Row = Record<string, any>;
const client = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

function loadData(): Row {
  const candidates = [
    path.resolve(process.cwd(), 'data/scm-detail-seed.json'),
    path.resolve(process.cwd(), '../../data/scm-detail-seed.json'),
  ];
  const file = candidates.find(candidate => fs.existsSync(candidate));
  if (!file) throw new Error(`Could not find scm-detail-seed.json. Checked: ${candidates.join(', ')}`);
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

async function upsert(schema: string, table: string, values: Row, onConflict: string) {
  const { data, error } = await client.schema(schema).from(table).upsert(values, { onConflict }).select().single();
  if (error) throw new Error(`${schema}.${table}: ${error.message}`);
  return data as Row;
}

async function findOne(schema: string, table: string, filters: Row) {
  let query = client.schema(schema).from(table).select('*');
  for (const [field, value] of Object.entries(filters)) query = query.eq(field, value);
  const { data, error } = await query.maybeSingle();
  if (error) throw new Error(`${schema}.${table}: ${error.message}`);
  return data as Row | null;
}

async function authUser(email: string, displayName: string, role: string) {
  const list = await client.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (list.error) throw list.error;
  let user = list.data.users.find(item => item.email === email);
  if (!user) {
    const created = await client.auth.admin.createUser({ email, password: 'demo123', email_confirm: true, user_metadata: { name: displayName } });
    if (created.error) throw created.error;
    user = created.data.user;
  }
  await upsert('iam', 'users', { id: user.id, email, display_name: displayName, role, active: true }, 'id');
  return user;
}

async function main() {
  const data = loadData();
  const company = await upsert('master_data', 'companies', { code: 'NOVEL', legal_name: 'Novel Tissues Private Limited', base_currency: 'INR', active: true }, 'code');
  const admin = await authUser('admin@scm.local', 'SCM Admin', 'ADMIN');
  const manager = await authUser('manager@scm.local', 'SCM Manager', 'MANAGER');
  const team = await authUser('team@scm.local', 'SCM Team', 'TEAM_MEMBER');
  const qc = await authUser('qc@scm.local', 'QC Viewer', 'QC');

  for (const [user, write, approve] of [[admin, true, true], [manager, true, true], [team, true, false], [qc, false, false]] as const) {
    await upsert('iam', 'user_company_access', { user_id: user.id, company_id: company.id, can_read: true, can_write: write, can_approve: approve }, 'user_id,company_id');
  }

  const uoms = new Map<string, Row>();
  for (const item of data.uoms) uoms.set(item.code, await upsert('master_data', 'uoms', { ...item, active: true }, 'code'));

  const warehouses = new Map<string, Row>();
  for (const item of data.warehouses) {
    warehouses.set(item.code, await upsert('master_data', 'sites', {
      company_id: company.id,
      code: item.code,
      name: item.name,
      site_type: item.site_type,
      city: item.city,
      state: item.state,
      active: true,
    }, 'company_id,code'));
  }

  const locations = new Map<string, Row>();
  for (const item of data.locations) {
    const warehouse = warehouses.get(item.warehouseCode);
    if (!warehouse) throw new Error(`Unknown warehouse for location ${item.code}: ${item.warehouseCode}`);
    locations.set(item.code, await upsert('master_data', 'locations', {
      company_id: company.id,
      site_id: warehouse.id,
      code: item.code,
      name: item.name,
      location_type: item.location_type,
      active: true,
    }, 'site_id,code'));
  }

  const transitSite = await upsert('master_data', 'sites', {
    company_id: company.id,
    code: 'TRANSIT-01',
    name: 'Goods In Transit',
    site_type: 'TRANSIT',
    city: 'India',
    state: 'NA',
    active: true,
  }, 'company_id,code');
  await upsert('master_data', 'locations', {
    company_id: company.id,
    site_id: transitSite.id,
    code: 'TRANSIT',
    name: 'Goods In Transit',
    location_type: 'TRANSIT',
    virtual: true,
    active: true,
  }, 'site_id,code');
  const externalSite = await upsert('master_data', 'sites', {
    company_id: company.id,
    code: 'EXT-01',
    name: 'External Source',
    site_type: 'VENDOR',
    city: 'India',
    state: 'NA',
    active: true,
  }, 'company_id,code');
  await upsert('master_data', 'locations', {
    company_id: company.id,
    site_id: externalSite.id,
    code: 'SOURCE',
    name: 'External Source',
    location_type: 'EXTERNAL_SOURCE',
    virtual: true,
    active: true,
  }, 'site_id,code');

  const channels = new Map<string, Row>();
  for (const item of data.channels) {
    channels.set(item.code, await upsert('master_data', 'channels', { company_id: company.id, ...item, active: true }, 'company_id,code'));
  }

  const items = new Map<string, Row>();
  for (const item of data.items) {
    const row = await upsert('master_data', 'items', {
      company_id: company.id,
      code: item.code,
      name: item.name,
      item_class: item.item_class,
      base_uom_id: uoms.get('EA')!.id,
      lifecycle_status: 'DRAFT',
      inspection_plan_required: false,
      active_from: '2026-01-01',
    }, 'company_id,code');
    items.set(item.code, row);
    for (const approvalArea of ['CATEGORY_NPD', 'COSTING', 'QA', 'FINANCE']) {
      await upsert('master_data', 'item_approvals', {
        company_id: company.id,
        item_id: row.id,
        approval_area: approvalArea,
        decision: 'APPROVED',
        decided_by: admin.id,
        reason: 'SCM Detail test-data approval',
      }, 'item_id,approval_area');
    }
    const { error: activationError } = await client.schema('master_data').from('items').update({ lifecycle_status: 'ACTIVE' }).eq('id', row.id).eq('company_id', company.id);
    if (activationError) throw new Error(`master_data.items activation: ${activationError.message}`);
    await upsert('inventory', 'inventory_policies', {
      company_id: company.id,
      site_id: warehouses.get('Mysore')!.id,
      item_id: row.id,
      threshold_quantity: 10,
      safety_stock: 10,
      reorder_point: 20,
      eoq: 50,
      effective_from: '2026-01-01',
      approved_by: admin.id,
    }, 'site_id,item_id,effective_from');
    await upsert('inventory', 'inventory_policies', {
      company_id: company.id,
      site_id: warehouses.get('Manesar')!.id,
      item_id: row.id,
      threshold_quantity: 10,
      safety_stock: 10,
      reorder_point: 20,
      eoq: 50,
      effective_from: '2026-01-01',
      approved_by: admin.id,
    }, 'site_id,item_id,effective_from');
  }

  for (const identifier of data.identifiers) {
    const item = items.get(identifier.itemCode);
    const channel = identifier.channelCode ? channels.get(identifier.channelCode) : null;
    if (!item) throw new Error(`Unknown item for identifier ${identifier.value}`);
    await upsert('master_data', 'item_identifiers', {
      company_id: company.id,
      item_id: item.id,
      identifier_type: identifier.identifier_type,
      value: identifier.value,
      channel_id: channel?.id || null,
      active: true,
    }, 'company_id,identifier_type,value');
  }

  for (const mapping of data.destinationMappings) {
    const channel = channels.get(mapping.channelCode);
    const warehouse = warehouses.get(mapping.warehouseCode);
    const location = locations.get(mapping.locationCode);
    if (!channel || !warehouse || !location) throw new Error(`Invalid destination mapping: ${JSON.stringify(mapping)}`);
    await upsert('master_data', 'destination_mappings', {
      company_id: company.id,
      channel_id: channel.id,
      destination_key: mapping.destinationKey,
      destination_name: mapping.destinationName,
      fc_code: mapping.fcCode,
      source_site_id: warehouse.id,
      source_location_id: location.id,
      active: true,
    }, 'company_id,channel_id,destination_key');
  }

  for (const route of data.routes) {
    const warehouse = warehouses.get(route.warehouseCode);
    if (!warehouse) throw new Error(`Unknown route warehouse: ${route.warehouseCode}`);
    await upsert('master_data', 'routes', {
      company_id: company.id,
      source_site_id: warehouse.id,
      destination_key: route.destinationKey,
      transit_hours: route.transitHours,
      estimated_cost: route.estimatedCost,
      currency: 'INR',
      active: true,
    }, 'company_id,source_site_id,destination_key');
  }

  for (const stock of data.openingStock) {
    const warehouse = warehouses.get(stock.warehouseCode)!;
    const location = locations.get(stock.warehouseCode === 'Mysore' ? 'MYS-STOCK' : 'MAN-STOCK')!;
    for (const item of items.values()) {
      const key = `scm-detail-opening-${stock.warehouseCode}-${item.code}`;
      const { error } = await client.schema('inventory').rpc('add_stock', {
        p_company_id: company.id,
        p_site_id: warehouse.id,
        p_location_id: location.id,
        p_item_id: item.id,
        p_uom_id: uoms.get('EA')!.id,
        p_quantity: stock.quantity,
        p_reason: `SCM Detail opening stock (${key})`,
        p_actor_id: admin.id,
        p_idempotency_key: key,
      });
      if (error && !error.message.toLowerCase().includes('idempotency')) throw new Error(`inventory.add_stock: ${error.message}`);
    }
  }

  let poCount = 0;
  for (const sourcePo of data.purchaseOrders) {
    const channel = channels.get(sourcePo.channelCode)!;
    const existing = await findOne('scm', 'purchase_orders', { company_id: company.id, channel_id: channel.id, external_id: sourcePo.externalId });
    if (existing) continue;
    const lines = sourcePo.lines.map((line: Row, index: number) => ({
      lineNumber: index + 1,
      itemId: items.get(line.itemCode)!.id,
      channelItemCode: line.channelItemCode,
      description: line.description,
      ordered: line.ordered,
      uomId: uoms.get('EA')!.id,
      unitPrice: line.unitPrice,
      taxRate: line.taxRate || 0,
      deliveryWindowEnd: sourcePo.deadline,
    }));
    const { error } = await client.schema('scm').rpc('create_purchase_order', {
      p_payload: {
        companyId: company.id,
        channelId: channel.id,
        externalId: sourcePo.externalId,
        poDate: sourcePo.poDate,
        deadline: sourcePo.deadline,
        destination: sourcePo.destinationKey,
        destinationName: sourcePo.destinationName,
        customer: sourcePo.customer,
        totalValue: sourcePo.totalValue,
        currency: 'INR',
        lines,
      },
      p_actor_id: admin.id,
      p_idempotency_key: `scm-detail-po-${sourcePo.channelCode}-${sourcePo.externalId}`,
    });
    if (error) throw new Error(`scm.create_purchase_order ${sourcePo.externalId}: ${error.message}`);
    poCount += 1;
  }

  console.log(JSON.stringify({
    ok: true,
    sourceFiles: data.sourceFiles.length,
    warehouses: warehouses.size,
    locations: locations.size,
    channels: channels.size,
    items: items.size,
    identifiers: data.identifiers.length,
    destinationMappings: data.destinationMappings.length,
    routes: data.routes.length,
    purchaseOrdersCreated: poCount,
    login: 'admin@scm.local / demo123',
  }, null, 2));
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});

import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as fs from 'node:fs';
import * as path from 'node:path';

for (const file of [path.resolve(process.cwd(), '.env'), path.resolve(process.cwd(), 'apps/api/.env')]) {
  if (fs.existsSync(file)) dotenv.config({ path: file, override: false });
}
if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');
}

const client = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function upsert(schema: string, table: string, values: any, onConflict: string) {
  const { data, error } = await client.schema(schema).from(table).upsert(values, { onConflict }).select().single();
  if (error) throw new Error(`${schema}.${table}: ${error.message}`);
  return data;
}

async function authUser(email: string, displayName: string, role: string) {
  const list = await client.auth.admin.listUsers({ page: 1, perPage: 1000 });
  let user = list.data.users.find(x => x.email === email);
  if (!user) {
    const created = await client.auth.admin.createUser({ email, password: 'demo123', email_confirm: true, user_metadata: { name: displayName } });
    if (created.error) throw created.error;
    user = created.data.user;
  }
  await upsert('iam', 'users', { id: user.id, email, display_name: displayName, role, active: true }, 'id');
  return user;
}

async function main() {
  const company = await upsert('master_data', 'companies', { code: 'NOVEL', legal_name: 'Novel SCM Demo Private Limited', base_currency: 'INR', active: true }, 'code');
  const admin = await authUser('admin@scm.local', 'SCM Admin', 'ADMIN');
  const manager = await authUser('manager@scm.local', 'SCM Manager', 'MANAGER');
  const team = await authUser('team@scm.local', 'SCM Team', 'TEAM_MEMBER');
  const qc = await authUser('qc@scm.local', 'QC Viewer', 'QC');
  for (const [user, write, approve] of [[admin, true, true], [manager, true, true], [team, true, false], [qc, false, false]] as const) {
    await upsert('iam', 'user_company_access', { user_id: user.id, company_id: company.id, can_read: true, can_write: write, can_approve: approve }, 'user_id,company_id');
  }

  const each = await upsert('master_data', 'uoms', { code: 'EA', name: 'Each', dimension: 'COUNT', decimal_places: 0, active: true }, 'code');
  const warehouse = await upsert('master_data', 'sites', { company_id: company.id, code: 'BLR-01', name: 'Bengaluru Central', site_type: 'WAREHOUSE', city: 'Bengaluru', state: 'KA' }, 'company_id,code');
  const externalSite = await upsert('master_data', 'sites', { company_id: company.id, code: 'EXT-01', name: 'External Supply', site_type: 'VENDOR', city: 'Bengaluru', state: 'KA' }, 'company_id,code');
  const customerSite = await upsert('master_data', 'sites', { company_id: company.id, code: 'CUST-01', name: 'Marketplace Customer', site_type: 'CUSTOMER', city: 'Bengaluru', state: 'KA' }, 'company_id,code');
  const transitSite = await upsert('master_data', 'sites', { company_id: company.id, code: 'TRANSIT-01', name: 'Goods In Transit', site_type: 'TRANSIT', city: 'Bengaluru', state: 'KA' }, 'company_id,code');
  const stock = await upsert('master_data', 'locations', { company_id: company.id, site_id: warehouse.id, code: 'FG-01', name: 'Released Finished Goods', location_type: 'WAREHOUSE' }, 'site_id,code');
  await upsert('master_data', 'locations', { company_id: company.id, site_id: externalSite.id, code: 'SOURCE', name: 'External Source', location_type: 'EXTERNAL_SOURCE', virtual: true }, 'site_id,code');
  await upsert('master_data', 'locations', { company_id: company.id, site_id: customerSite.id, code: 'RECEIVED', name: 'Customer Received', location_type: 'CUSTOMER', virtual: true }, 'site_id,code');
  await upsert('master_data', 'locations', { company_id: company.id, site_id: transitSite.id, code: 'TRANSIT', name: 'In Transit', location_type: 'TRANSIT', virtual: true }, 'site_id,code');

  const amazon = await upsert('master_data', 'channels', { company_id: company.id, code: 'AMZ', name: 'Amazon / RK World', channel_type: 'MARKETPLACE', ingestion_method: 'FILE' }, 'company_id,code');
  const flipkart = await upsert('master_data', 'channels', { company_id: company.id, code: 'FLIP', name: 'Flipkart', channel_type: 'MARKETPLACE', ingestion_method: 'FILE' }, 'company_id,code');
  const blinkit = await upsert('master_data', 'channels', { company_id: company.id, code: 'BLINK', name: 'Blinkit', channel_type: 'QUICK_COMMERCE', ingestion_method: 'FILE' }, 'company_id,code');
  for (const channel of [amazon, flipkart, blinkit]) {
    await upsert('master_data', 'destination_mappings', { company_id: company.id, channel_id: channel.id, destination_key: 'Bengaluru FC', destination_name: 'Bengaluru FC', fc_code: 'BLR-FC', source_site_id: warehouse.id, source_location_id: stock.id }, 'company_id,channel_id,destination_key');
  }
  await upsert('master_data', 'routes', { company_id: company.id, source_site_id: warehouse.id, destination_key: 'Bengaluru FC', transit_hours: 6, estimated_cost: 450, currency: 'INR' }, 'company_id,source_site_id,destination_key');

  const itemSpecs = [
    ['SKU-1001', 'Wireless Keyboard'],
    ['SKU-1002', 'Ergonomic Mouse'],
    ['SKU-1003', 'Laptop Stand'],
  ];
  for (const [code, name] of itemSpecs) {
    const item = await upsert('master_data', 'items', { company_id: company.id, code, name, item_class: 'FG', base_uom_id: each.id, lifecycle_status: 'DRAFT', inspection_plan_required: false }, 'company_id,code');
    for (const area of ['CATEGORY_NPD', 'COSTING', 'QA', 'FINANCE']) {
      await upsert('master_data', 'item_approvals', { company_id: company.id, item_id: item.id, approval_area: area, decision: 'APPROVED', decided_by: admin.id, reason: 'Demo master approval' }, 'item_id,approval_area');
    }
    const { error: activateError } = await client.schema('master_data').from('items').update({ lifecycle_status: 'ACTIVE' }).eq('id', item.id);
    if (activateError) throw activateError;
    await upsert('inventory', 'inventory_policies', { company_id: company.id, site_id: warehouse.id, item_id: item.id, threshold_quantity: 10, safety_stock: 10, reorder_point: 20, eoq: 50, effective_from: '2026-04-01', approved_by: admin.id }, 'site_id,item_id,effective_from');
    const { error: stockError } = await client.schema('inventory').rpc('add_stock', { p_company_id: company.id, p_site_id: warehouse.id, p_location_id: stock.id, p_item_id: item.id, p_uom_id: each.id, p_quantity: 100, p_reason: 'Demo opening stock', p_actor_id: admin.id, p_idempotency_key: `seed-opening-${code}` });
    if (stockError && !stockError.message.includes('idempotency')) throw stockError;
  }
  console.log('SCM v2 seed complete. Login: admin@scm.local / demo123');
}

main().catch(error => { console.error(error); process.exit(1); });

-- Sales integration foundation. All objects are additive and tenant-scoped.

create schema if not exists integration;

alter table master_data.items
  add column if not exists description text,
  add column if not exists subcategory text,
  add column if not exists production_lead_time_days numeric(10,2),
  add column if not exists pack_quantity numeric(18,6),
  add column if not exists carton_quantity numeric(18,6);

alter table master_data.item_identifiers
  drop constraint if exists item_identifiers_identifier_type_check;

alter table master_data.item_identifiers
  add constraint item_identifiers_identifier_type_check check (identifier_type in (
    'EAN','GTIN','UPC','BARCODE','LEGACY','CHANNEL_SKU',
    'AMAZON_ASIN','AMAZON_SELLER_SKU',
    'FLIPKART_PRODUCT_ID','FLIPKART_SKU',
    'MEESHO_PRODUCT_ID','MEESHO_SKU'
  ));

alter table master_data.item_identifiers
  add column if not exists mapping_status text not null default 'ACTIVE',
  add column if not exists valid_from timestamptz not null default statement_timestamp(),
  add column if not exists valid_to timestamptz,
  add column if not exists updated_at timestamptz not null default statement_timestamp();

alter table master_data.sites
  add column if not exists address_line_1 text,
  add column if not exists address_line_2 text,
  add column if not exists locality text,
  add column if not exists postal_code text,
  add column if not exists latitude numeric(10,7),
  add column if not exists longitude numeric(10,7);

alter table master_data.destination_mappings
  add column if not exists address_line_1 text,
  add column if not exists address_line_2 text,
  add column if not exists locality text,
  add column if not exists postal_code text,
  add column if not exists timezone text;

alter table inventory.reservations
  add column if not exists cancelled_at timestamptz,
  add column if not exists cancellation_reason text,
  add column if not exists superseded_at timestamptz,
  add column if not exists updated_at timestamptz not null default statement_timestamp();

alter table scm.shipments
  add column if not exists tracking_reference text,
  add column if not exists lr_number text,
  add column if not exists cancelled_at timestamptz,
  add column if not exists cancellation_reason text;

alter table scm.delivery_exceptions
  add column if not exists purchase_order_line_id uuid references scm.purchase_order_lines(id) on delete restrict,
  add column if not exists item_id uuid references master_data.items(id) on delete restrict,
  add column if not exists updated_at timestamptz not null default statement_timestamp();

alter table scm.pods
  add column if not exists submitted_by uuid references iam.users(id) on delete restrict,
  add column if not exists submitted_at timestamptz,
  add column if not exists approved_by uuid references iam.users(id) on delete restrict,
  add column if not exists approved_at timestamptz,
  add column if not exists rejected_by uuid references iam.users(id) on delete restrict,
  add column if not exists rejected_at timestamptz,
  add column if not exists rejection_reason text,
  add column if not exists updated_at timestamptz not null default statement_timestamp();

alter table scm.invoices
  add column if not exists updated_at timestamptz not null default statement_timestamp();

create table if not exists integration.clients (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references master_data.companies(id) on delete restrict,
  name text not null,
  credential_prefix text not null unique,
  credential_hash text not null,
  scopes text[] not null default ARRAY['master:read','inventory:read','po:read','fulfilment:read','movement:read'],
  active boolean not null default true,
  expires_at timestamptz,
  last_used_at timestamptz,
  created_by uuid references iam.users(id) on delete restrict,
  created_at timestamptz not null default statement_timestamp(),
  revoked_at timestamptz,
  unique (company_id, name)
);

create table if not exists integration.change_log (
  sequence_id bigint generated always as identity primary key,
  company_id uuid not null references master_data.companies(id) on delete restrict,
  entity_type text not null,
  entity_id uuid not null,
  operation text not null check (operation in ('CREATED','UPDATED','DEACTIVATED','CANCELLED','REVERSED','SUPERSEDED')),
  entity_version bigint not null default 1,
  changed_at timestamptz not null default statement_timestamp(),
  data jsonb not null default '{}'::jsonb,
  unique (company_id, entity_type, entity_id, changed_at, sequence_id)
);

create table if not exists integration.request_audit (
  id bigint generated always as identity primary key,
  request_id uuid not null,
  client_id text not null,
  company_id uuid not null references master_data.companies(id) on delete restrict,
  route text not null,
  status_code integer not null,
  duration_ms integer,
  record_count integer,
  created_at timestamptz not null default statement_timestamp()
);

create or replace function integration.record_change()
returns trigger
language plpgsql
security definer
set search_path = public, integration
as $$
declare
  v_row jsonb;
  v_company uuid;
  v_id uuid;
  v_operation text;
  v_type text;
begin
  v_row := case when TG_OP = 'DELETE' then to_jsonb(OLD) else to_jsonb(NEW) end;
  v_company := (v_row->>'company_id')::uuid;
  v_id := (v_row->>'id')::uuid;
  v_operation := case
    when TG_OP = 'INSERT' then 'CREATED'
    when TG_OP = 'DELETE' then 'CANCELLED'
    when coalesce(v_row->>'active', 'true') = 'false' then 'DEACTIVATED'
    when coalesce(v_row->>'status', '') in ('CANCELLED','REVERSED','SUPERSEDED') then upper(v_row->>'status')
    else 'UPDATED'
  end;
  v_type := replace(TG_TABLE_SCHEMA || '.' || TG_TABLE_NAME, '_', '-');
  if v_company is null or v_id is null then
    if TG_OP = 'DELETE' then return OLD; else return NEW; end if;
  end if;
  insert into integration.change_log(company_id, entity_type, entity_id, operation, entity_version, data)
  values (v_company, v_type, v_id, v_operation,
    coalesce((select max(entity_version) + 1 from integration.change_log c where c.company_id = v_company and c.entity_type = v_type and c.entity_id = v_id), 1),
    jsonb_build_object('id', v_id, 'entityType', v_type, 'operation', v_operation));
  if TG_OP = 'DELETE' then return OLD; else return NEW; end if;
end;
$$;

create or replace view integration.inventory_availability_v with (security_invoker = true) as
select
  b.company_id,
  b.site_id,
  b.item_id,
  b.uom_id,
  coalesce(sum(b.quantity) filter (where l.location_type not in ('TRANSIT','CUSTOMER','EXTERNAL_SOURCE','EXTERNAL_SINK') and b.stock_state <> 'SCRAP'), 0)::numeric(18,6) as physical_quantity,
  greatest(
    coalesce(sum(b.quantity) filter (where l.location_type not in ('TRANSIT','CUSTOMER','EXTERNAL_SOURCE','EXTERNAL_SINK') and b.stock_state <> 'SCRAP'), 0)
    - coalesce(sum(b.quantity) filter (where b.stock_state = 'RESERVED'), 0),
    0
  )::numeric(18,6) as available_quantity,
  coalesce(sum(b.quantity) filter (where b.stock_state = 'RESERVED'), 0)::numeric(18,6) as reserved_quantity,
  coalesce(sum(b.quantity) filter (where l.location_type = 'TRANSIT' or b.stock_state = 'IN_TRANSIT'), 0)::numeric(18,6) as in_transit_quantity,
  coalesce(sum(b.quantity) filter (where b.stock_state = 'QUARANTINE'), 0)::numeric(18,6) as quarantine_quantity,
  coalesce(sum(b.quantity) filter (where b.stock_state = 'ON_HOLD'), 0)::numeric(18,6) as on_hold_quantity,
  coalesce(sum(b.quantity) filter (where b.stock_state = 'REJECTED'), 0)::numeric(18,6) as rejected_quantity,
  coalesce(sum(b.quantity) filter (where b.stock_state = 'SCRAP'), 0)::numeric(18,6) as scrap_quantity,
  coalesce(p.threshold_quantity, 0)::numeric(18,6) as threshold_quantity,
  greatest(
    coalesce(sum(b.quantity) filter (where l.location_type not in ('TRANSIT','CUSTOMER','EXTERNAL_SOURCE','EXTERNAL_SINK') and b.stock_state <> 'SCRAP'), 0)
    - coalesce(sum(b.quantity) filter (where b.stock_state = 'RESERVED'), 0)
    - coalesce(p.threshold_quantity, 0),
    0
  )::numeric(18,6) as allocatable_quantity,
  (select max(t.posting_at)
   from inventory.stock_ledger_entries le
   join inventory.stock_transactions t on t.id = le.stock_transaction_id
   where le.company_id = b.company_id and le.site_id = b.site_id and le.item_id = b.item_id and t.status = 'POSTED') as last_movement_at,
  statement_timestamp() as snapshot_at
from inventory.stock_balance_v b
join master_data.locations l on l.id = b.location_id
left join lateral (
  select ip.threshold_quantity from inventory.inventory_policies ip
  where ip.site_id = b.site_id and ip.item_id = b.item_id and ip.effective_from <= current_date and (ip.effective_to is null or ip.effective_to >= current_date)
  order by ip.effective_from desc limit 1
) p on true
group by b.company_id, b.site_id, b.item_id, b.uom_id, p.threshold_quantity;

create index if not exists item_identifiers_resolution_idx on master_data.item_identifiers(company_id, channel_id, identifier_type, lower(value));
create index if not exists integration_change_company_sequence_idx on integration.change_log(company_id, sequence_id);
create index if not exists integration_change_entity_idx on integration.change_log(company_id, entity_type, entity_id, sequence_id);

do $$
declare
  r record;
begin
  for r in select * from (values
    ('master_data','items'),('master_data','item_identifiers'),('master_data','channels'),('master_data','sites'),('master_data','locations'),('master_data','destination_mappings'),
    ('scm','purchase_orders'),('scm','purchase_order_lines'),('scm','appointments'),('scm','shipments'),('scm','shipment_lines'),('scm','pods'),('scm','pod_lines'),('scm','delivery_exceptions'),('scm','invoices'),
    ('inventory','reservations'),('inventory','reservation_lines'),('inventory','reservation_allocations'),('inventory','stock_transactions'),('inventory','stock_ledger_entries')
  ) as x(schema_name, table_name) loop
    execute format('drop trigger if exists integration_change_%s_%s on %I.%I', r.schema_name, r.table_name, r.schema_name, r.table_name);
    execute format('create trigger integration_change_%s_%s after insert or update or delete on %I.%I for each row execute function integration.record_change()', r.schema_name, r.table_name, r.schema_name, r.table_name);
  end loop;
end;
$$;

grant usage on schema integration to anon, authenticated, service_role;
grant select on all tables in schema integration to service_role;
grant select on integration.inventory_availability_v to service_role;

-- Keep the integration API's service-role access and tenant-safe user reads
-- intact after a fresh migration or a new UAT environment.
grant select on scm.acceptance_decision_lines,
  scm.appointment_purchase_orders,
  scm.short_close_decision_lines,
  scm.ownership_transfer_events
to service_role;

grant select, insert on integration.request_audit to service_role;

alter table integration.clients
  alter column scopes set default ARRAY[
    'master:read',
    'inventory:read',
    'po:read',
    'fulfilment:read',
    'movement:read',
    'changes:read'
  ];

alter table scm.acceptance_decision_lines enable row level security;
alter table scm.appointment_purchase_orders enable row level security;
alter table scm.short_close_decision_lines enable row level security;
alter table scm.ownership_transfer_events enable row level security;
alter table integration.clients enable row level security;
alter table integration.change_log enable row level security;
alter table integration.request_audit enable row level security;

grant select on scm.acceptance_decision_lines,
  scm.appointment_purchase_orders,
  scm.short_close_decision_lines,
  scm.ownership_transfer_events
to authenticated;

drop policy if exists company_read on scm.acceptance_decision_lines;
create policy company_read on scm.acceptance_decision_lines
  for select to authenticated using (iam.can_access_company(company_id));

drop policy if exists company_read on scm.appointment_purchase_orders;
create policy company_read on scm.appointment_purchase_orders
  for select to authenticated using (iam.can_access_company(company_id));

drop policy if exists company_read on scm.short_close_decision_lines;
create policy company_read on scm.short_close_decision_lines
  for select to authenticated using (iam.can_access_company(company_id));

drop policy if exists company_read on scm.ownership_transfer_events;
create policy company_read on scm.ownership_transfer_events
  for select to authenticated using (iam.can_access_company(company_id));

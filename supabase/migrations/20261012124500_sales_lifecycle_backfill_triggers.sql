-- Keep the new integration relationship tables populated by existing SCM workflows.

create or replace function scm.populate_acceptance_line_state()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, scm
as $$
begin
  insert into scm.acceptance_decision_lines(company_id, acceptance_decision_id, purchase_order_line_id, accepted_quantity, rejected_quantity, reason)
  select NEW.company_id, NEW.id, pol.id,
    case when NEW.decision = 'ACCEPTED' then pol.ordered_quantity else 0 end,
    case when NEW.decision = 'REJECTED' then pol.ordered_quantity else 0 end,
    NEW.reason
  from scm.purchase_order_lines pol
  where pol.purchase_order_id = NEW.purchase_order_id
  on conflict (acceptance_decision_id, purchase_order_line_id) do nothing;
  return NEW;
end;
$$;

drop trigger if exists populate_acceptance_line_state on scm.acceptance_decisions;
create trigger populate_acceptance_line_state after insert on scm.acceptance_decisions
for each row execute function scm.populate_acceptance_line_state();

create or replace function scm.populate_short_close_lines()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, scm
as $$
declare
  v_remaining numeric(18,6) := NEW.remaining_quantity;
  v_available numeric(18,6);
  v_take numeric(18,6);
  v_line record;
begin
  if NEW.status <> 'APPROVED' then return NEW; end if;
  for v_line in
    select pol.id,
      greatest(pol.ordered_quantity - coalesce((select sum(sl.delivered_quantity + sl.damaged_quantity + sl.rejected_quantity) from scm.shipment_lines sl where sl.purchase_order_line_id = pol.id), 0), 0) as open_quantity
    from scm.purchase_order_lines pol
    where pol.purchase_order_id = NEW.purchase_order_id
    order by pol.line_number, pol.id
  loop
    exit when v_remaining <= 0;
    v_available := greatest(v_line.open_quantity, 0);
    v_take := least(v_remaining, v_available);
    if v_take > 0 then
      insert into scm.short_close_decision_lines(company_id, short_close_decision_id, purchase_order_line_id, approved_quantity, reason)
      values (NEW.company_id, NEW.id, v_line.id, v_take, NEW.reason)
      on conflict (short_close_decision_id, purchase_order_line_id) do nothing;
      v_remaining := v_remaining - v_take;
    end if;
  end loop;
  return NEW;
end;
$$;

drop trigger if exists populate_short_close_lines on scm.short_close_decisions;
create trigger populate_short_close_lines after insert on scm.short_close_decisions
for each row execute function scm.populate_short_close_lines();

create or replace function scm.link_new_appointment_to_po()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, scm
as $$
begin
  insert into scm.appointment_purchase_orders(company_id, appointment_id, purchase_order_id)
  values (NEW.company_id, NEW.id, NEW.purchase_order_id)
  on conflict do nothing;
  return NEW;
end;
$$;

drop trigger if exists link_new_appointment_to_po on scm.appointments;
create trigger link_new_appointment_to_po after insert on scm.appointments
for each row execute function scm.link_new_appointment_to_po();

create or replace function scm.record_pod_ownership_transfer()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, scm
as $$
begin
  if NEW.status in ('CONFIRMED','APPROVED') then
    insert into scm.ownership_transfer_events(company_id, purchase_order_id, pod_id, event_type, transferred_at, basis, recorded_by)
    values (NEW.company_id, NEW.purchase_order_id, NEW.id, 'TRANSFERRED', coalesce(NEW.approved_at, NEW.confirmed_at, NEW.confirmed_at), 'POD_APPROVAL', coalesce(NEW.approved_by, NEW.confirmed_by))
    on conflict do nothing;
  end if;
  return NEW;
end;
$$;

drop trigger if exists record_pod_ownership_transfer on scm.pods;
create trigger record_pod_ownership_transfer after insert or update on scm.pods
for each row execute function scm.record_pod_ownership_transfer();

-- Existing decisions are backfilled idempotently for historical Sales synchronization.
insert into scm.acceptance_decision_lines(company_id, acceptance_decision_id, purchase_order_line_id, accepted_quantity, rejected_quantity, reason)
select ad.company_id, ad.id, pol.id,
  case when ad.decision = 'ACCEPTED' then pol.ordered_quantity else 0 end,
  case when ad.decision = 'REJECTED' then pol.ordered_quantity else 0 end,
  ad.reason
from scm.acceptance_decisions ad
join scm.purchase_order_lines pol on pol.purchase_order_id = ad.purchase_order_id
on conflict (acceptance_decision_id, purchase_order_line_id) do nothing;

insert into scm.appointment_purchase_orders(company_id, appointment_id, purchase_order_id)
select company_id, id, purchase_order_id from scm.appointments
on conflict do nothing;

create unique index if not exists ownership_transfer_pod_event_uq on scm.ownership_transfer_events(pod_id, event_type) where pod_id is not null;

insert into scm.ownership_transfer_events(company_id, purchase_order_id, pod_id, event_type, transferred_at, basis, recorded_by)
select company_id, purchase_order_id, id, 'TRANSFERRED', coalesce(approved_at, confirmed_at), 'POD_APPROVAL', coalesce(approved_by, confirmed_by)
from scm.pods
where status in ('CONFIRMED','APPROVED')
on conflict (pod_id, event_type) where pod_id is not null do nothing;

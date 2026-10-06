-- Durable private document storage and Super Admin enforcement.

insert into storage.buckets (id, name, public)
values ('scm-documents', 'scm-documents', false)
on conflict (id) do update set public = false;

create or replace function iam.actor_can_write(p_actor_id uuid, p_company_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, iam
as $$
  select exists (
    select 1
    from iam.users u
    join iam.user_company_access a on a.user_id = u.id
    where u.id = p_actor_id
      and a.company_id = p_company_id
      and (auth.uid() is null or auth.uid() = p_actor_id)
      and u.active
      and (a.can_write or u.role = 'SUPER_ADMIN')
  );
$$;

create or replace function iam.actor_can_approve(p_actor_id uuid, p_company_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, iam
as $$
  select exists (
    select 1
    from iam.users u
    join iam.user_company_access a on a.user_id = u.id
    where u.id = p_actor_id
      and a.company_id = p_company_id
      and (auth.uid() is null or auth.uid() = p_actor_id)
      and u.active
      and (a.can_approve or u.role = 'SUPER_ADMIN')
  );
$$;

-- Audit rows are append-only. Database functions remain responsible for inserts.
revoke update, delete on platform.audit_events from authenticated, service_role;


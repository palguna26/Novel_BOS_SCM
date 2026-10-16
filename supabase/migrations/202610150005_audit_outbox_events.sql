-- Make audit events available for durable downstream delivery.
-- The audit row and its outbox event are written in the same transaction.

create or replace function platform.write_audit(
  p_company_id uuid,
  p_actor_id uuid,
  p_action text,
  p_entity_type text,
  p_entity_id uuid,
  p_old_value jsonb default null,
  p_new_value jsonb default null,
  p_reason text default null,
  p_source text default 'DATABASE'
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, platform, iam
as $$
declare
  v_id uuid;
  v_role text;
begin
  select role into v_role from iam.users where id = p_actor_id;
  insert into platform.audit_events(
    company_id, actor_id, actor_role, action, entity_type, entity_id,
    old_value, new_value, reason, source
  ) values (
    p_company_id, p_actor_id, v_role, p_action, p_entity_type, p_entity_id,
    p_old_value, p_new_value, p_reason, p_source
  ) returning id into v_id;

  insert into platform.outbox_events(
    company_id, aggregate_type, aggregate_id, event_type, payload
  ) values (
    p_company_id, p_entity_type, p_entity_id, 'AUDIT_' || p_action,
    jsonb_build_object(
      'auditEventId', v_id, 'companyId', p_company_id, 'actorId', p_actor_id,
      'actorRole', v_role, 'action', p_action, 'entityType', p_entity_type,
      'entityId', p_entity_id, 'oldValue', p_old_value, 'newValue', p_new_value,
      'reason', p_reason, 'source', p_source
    )
  );
  return v_id;
end;
$$;

create index if not exists outbox_unpublished_retry_idx
  on platform.outbox_events(created_at, attempts)
  where published_at is null;

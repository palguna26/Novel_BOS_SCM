-- Shared rate-limit windows for integration clients.
-- The API uses this function so limits remain consistent across instances.
create table if not exists integration.rate_limit_windows (
  client_id text primary key,
  window_started_at timestamptz not null,
  request_count integer not null check (request_count >= 0),
  updated_at timestamptz not null default statement_timestamp()
);

create or replace function integration.consume_rate_limit(
  p_client_id text,
  p_limit integer,
  p_window_seconds integer default 60
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, integration
as $$
declare
  v_window timestamptz := statement_timestamp();
  v_count integer;
begin
  if nullif(trim(p_client_id), '') is null or p_limit < 1 or p_window_seconds < 1 then
    raise exception 'Invalid rate-limit arguments';
  end if;

  delete from integration.rate_limit_windows
  where updated_at < v_window - interval '1 day';

  insert into integration.rate_limit_windows(client_id, window_started_at, request_count, updated_at)
  values (p_client_id, v_window, 1, v_window)
  on conflict (client_id) do update
  set window_started_at = case
        when integration.rate_limit_windows.window_started_at + make_interval(secs => p_window_seconds) <= v_window
          then v_window
        else integration.rate_limit_windows.window_started_at
      end,
      request_count = case
        when integration.rate_limit_windows.window_started_at + make_interval(secs => p_window_seconds) <= v_window
          then 1
        else integration.rate_limit_windows.request_count + 1
      end,
      updated_at = v_window
  returning request_count into v_count;

  return v_count <= p_limit;
end;
$$;

revoke all on function integration.consume_rate_limit(text, integer, integer) from public;
grant execute on function integration.consume_rate_limit(text, integer, integer) to service_role;

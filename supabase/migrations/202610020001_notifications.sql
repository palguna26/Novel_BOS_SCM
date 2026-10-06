create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  po_id uuid references public.purchase_orders(id),
  type text not null,
  recipient text,
  subject text,
  status text not null default 'PENDING',
  error text,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);

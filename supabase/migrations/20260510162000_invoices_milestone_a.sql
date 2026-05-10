create table if not exists public.invoices (
  id bigserial primary key,
  invoice_number text not null unique,
  customer_id uuid not null references public.customers(id) on delete restrict,
  status text not null default 'draft' check (status in ('draft', 'generated', 'sent', 'paid', 'cancelled')),
  currency text not null default 'INR',
  invoice_date date not null,
  due_date date not null,
  payment_terms_days integer not null check (payment_terms_days in (7, 15, 30)),
  subtotal numeric(14,2) not null default 0,
  grand_total numeric(14,2) not null default 0,
  notes text null,
  created_by uuid null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.invoice_line_items (
  id bigserial primary key,
  invoice_id bigint not null references public.invoices(id) on delete cascade,
  source_transaction_id bigint null references public.financial_reconciliation_transactions(id) on delete set null,
  description text not null,
  quantity numeric(12,2) not null default 1,
  unit_price numeric(14,2) not null default 0,
  line_total numeric(14,2) not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.invoice_transaction_links (
  id bigserial primary key,
  invoice_id bigint not null references public.invoices(id) on delete cascade,
  transaction_id bigint not null references public.financial_reconciliation_transactions(id) on delete cascade,
  allocated_amount numeric(14,2) not null default 0,
  created_at timestamptz not null default now(),
  unique(invoice_id, transaction_id)
);

create table if not exists public.invoice_sequences (
  fy_start_year integer primary key,
  last_number integer not null default 0,
  updated_at timestamptz not null default now()
);

alter table public.financial_reconciliation_transactions
  add column if not exists customer_id uuid null references public.customers(id) on delete set null;

create index if not exists invoices_customer_id_idx on public.invoices(customer_id);
create index if not exists invoices_invoice_date_idx on public.invoices(invoice_date desc);
create index if not exists invoice_line_items_invoice_id_idx on public.invoice_line_items(invoice_id);
create index if not exists invoice_tx_links_tx_id_idx on public.invoice_transaction_links(transaction_id);
create index if not exists frt_customer_id_idx on public.financial_reconciliation_transactions(customer_id);

create or replace function public.next_invoice_number(
  p_invoice_date date default current_date,
  p_prefix text default 'RB'
) returns text
language plpgsql
security definer
as $$
declare
  fy_start integer;
  next_no integer;
  fy_label text;
begin
  if extract(month from p_invoice_date) >= 4 then
    fy_start := extract(year from p_invoice_date)::int;
  else
    fy_start := (extract(year from p_invoice_date)::int - 1);
  end if;

  insert into public.invoice_sequences (fy_start_year, last_number)
  values (fy_start, 1)
  on conflict (fy_start_year)
  do update set
    last_number = public.invoice_sequences.last_number + 1,
    updated_at = now()
  returning last_number into next_no;

  fy_label := fy_start::text || '-' || lpad(((fy_start + 1) % 100)::text, 2, '0');
  return coalesce(nullif(trim(p_prefix), ''), 'RB') || '/' || fy_label || '/' || lpad(next_no::text, 6, '0');
end;
$$;

alter table public.invoices enable row level security;
alter table public.invoice_line_items enable row level security;
alter table public.invoice_transaction_links enable row level security;
alter table public.invoice_sequences enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'invoices' and policyname = 'invoices_admin_all'
  ) then
    create policy invoices_admin_all
      on public.invoices
      for all
      to authenticated
      using (exists (select 1 from public.profiles p where p.user_id = auth.uid() and p.role = 'admin'))
      with check (exists (select 1 from public.profiles p where p.user_id = auth.uid() and p.role = 'admin'));
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'invoice_line_items' and policyname = 'invoice_line_items_admin_all'
  ) then
    create policy invoice_line_items_admin_all
      on public.invoice_line_items
      for all
      to authenticated
      using (exists (select 1 from public.profiles p where p.user_id = auth.uid() and p.role = 'admin'))
      with check (exists (select 1 from public.profiles p where p.user_id = auth.uid() and p.role = 'admin'));
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'invoice_transaction_links' and policyname = 'invoice_transaction_links_admin_all'
  ) then
    create policy invoice_transaction_links_admin_all
      on public.invoice_transaction_links
      for all
      to authenticated
      using (exists (select 1 from public.profiles p where p.user_id = auth.uid() and p.role = 'admin'))
      with check (exists (select 1 from public.profiles p where p.user_id = auth.uid() and p.role = 'admin'));
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'invoice_sequences' and policyname = 'invoice_sequences_admin_all'
  ) then
    create policy invoice_sequences_admin_all
      on public.invoice_sequences
      for all
      to authenticated
      using (exists (select 1 from public.profiles p where p.user_id = auth.uid() and p.role = 'admin'))
      with check (exists (select 1 from public.profiles p where p.user_id = auth.uid() and p.role = 'admin'));
  end if;
end $$;

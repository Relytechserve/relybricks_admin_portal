-- Per-property subscription renewal year paid status (renewal transactions only).
-- Transactions store which subscription year (1-based from property subscription_date) they cover.

alter table public.transactions
  add column if not exists subscription_renewal_year integer null;

comment on column public.transactions.subscription_renewal_year is
  'Subscription year index (1 = first year from property subscription_date); set for renewal type with customer_property_id';

create index if not exists idx_transactions_property_renewal_year
  on public.transactions using btree (customer_property_id, subscription_renewal_year);

create table if not exists public.property_renewal_year_status (
  id uuid not null default gen_random_uuid(),
  customer_property_id uuid not null
    references public.customer_properties (id) on delete cascade,
  subscription_year integer not null check (subscription_year >= 1),
  is_paid boolean not null default false,
  paid_source text not null default 'auto' check (paid_source in ('auto', 'admin_override')),
  updated_at timestamptz not null default now(),
  constraint property_renewal_year_status_pkey primary key (id),
  constraint property_renewal_year_status_property_year_unique unique (customer_property_id, subscription_year)
);

create index if not exists idx_property_renewal_year_status_property
  on public.property_renewal_year_status using btree (customer_property_id);

comment on table public.property_renewal_year_status is
  'Paid/unpaid for subscription revenue per property per subscription year; renewal txns drive auto; admins can override';

alter table public.property_renewal_year_status enable row level security;

create policy "Authenticated users can manage property_renewal_year_status"
  on public.property_renewal_year_status
  for all
  to authenticated
  using (true)
  with check (true);

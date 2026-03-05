-- Subscription tiers and per-city pricing

create table if not exists public.subscription_tiers (
  id uuid not null default gen_random_uuid(),
  name text not null,
  description text null,
  is_custom boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz null default now(),
  updated_at timestamptz null default now(),
  constraint subscription_tiers_pkey primary key (id),
  constraint subscription_tiers_name_unique unique (name)
);

create table if not exists public.subscription_tier_prices (
  id uuid not null default gen_random_uuid(),
  tier_id uuid not null,
  city text not null,
  amount numeric(12,2) not null,
  currency text null default 'INR',
  valid_from date null,
  valid_to date null,
  is_active boolean not null default true,
  created_at timestamptz null default now(),
  updated_at timestamptz null default now(),
  constraint subscription_tier_prices_pkey primary key (id),
  constraint subscription_tier_prices_tier_id_fkey foreign key (tier_id) references public.subscription_tiers (id) on delete cascade
);

create index if not exists idx_subscription_tier_prices_tier_city
  on public.subscription_tier_prices using btree (tier_id, city);

alter table public.subscription_tiers enable row level security;
alter table public.subscription_tier_prices enable row level security;

create policy "Authenticated users can manage subscription_tiers"
  on public.subscription_tiers
  for all
  to authenticated
  using (true)
  with check (true);

create policy "Authenticated users can manage subscription_tier_prices"
  on public.subscription_tier_prices
  for all
  to authenticated
  using (true)
  with check (true);

comment on table public.subscription_tiers is 'Reusable subscription tiers for RelyBricks plans.';
comment on table public.subscription_tier_prices is 'Per-city pricing for each subscription tier.';

-- Link customers to subscription tiers (optional for existing rows)
alter table public.customers
  add column if not exists subscription_tier_id uuid null
  references public.subscription_tiers (id);

create index if not exists idx_customers_subscription_tier_id
  on public.customers using btree (subscription_tier_id);


-- Subscription plan and renewal dates per property (not only per customer)

alter table public.customer_properties
  add column if not exists subscription_tier_id uuid null
    references public.subscription_tiers (id) on delete set null,
  add column if not exists plan_type text null,
  add column if not exists subscription_date date null,
  add column if not exists next_renewal_date date null,
  add column if not exists package_revenue numeric null;

create index if not exists idx_customer_properties_subscription_tier_id
  on public.customer_properties using btree (subscription_tier_id);

comment on column public.customer_properties.subscription_tier_id is 'Subscription tier for this property.';
comment on column public.customer_properties.plan_type is 'Denormalized tier name for display.';
comment on column public.customer_properties.next_renewal_date is 'Next renewal for this property subscription.';

-- Optional link from transaction to property (renewal dates update this property when set)
alter table public.transactions
  add column if not exists customer_property_id uuid null
    references public.customer_properties (id) on delete set null;

create index if not exists idx_transactions_customer_property_id
  on public.transactions using btree (customer_property_id);

comment on column public.transactions.customer_property_id is 'When set, renewal updates this property next_renewal_date; otherwise legacy customer-level update.';

-- Backfill from customer onto existing property rows
update public.customer_properties cp
set
  subscription_tier_id = coalesce(cp.subscription_tier_id, c.subscription_tier_id),
  plan_type = coalesce(cp.plan_type, c.plan_type),
  subscription_date = coalesce(cp.subscription_date, c.subscription_date),
  next_renewal_date = coalesce(cp.next_renewal_date, c.next_renewal_date),
  package_revenue = coalesce(cp.package_revenue, c.package_revenue)
from public.customers c
where cp.customer_id = c.id
  and (
    c.subscription_tier_id is not null
    or c.plan_type is not null
    or c.subscription_date is not null
    or c.next_renewal_date is not null
    or c.package_revenue is not null
  );

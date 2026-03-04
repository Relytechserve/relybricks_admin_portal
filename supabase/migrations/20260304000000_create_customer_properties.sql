-- Multiple properties per customer (RelyBricks subscriptions)
create table if not exists public.customer_properties (
  id uuid not null default gen_random_uuid(),
  customer_id uuid not null,
  full_address text null,
  city text null,
  area text null,
  property_type text null,
  property_status text null,
  property_sqft integer null,
  property_bhk text null,
  property_furnishing text null,
  created_at timestamptz null default now(),
  updated_at timestamptz null default now(),
  constraint customer_properties_pkey primary key (id),
  constraint customer_properties_customer_id_fkey foreign key (customer_id) references public.customers (id) on delete cascade,
  constraint customer_properties_property_type_check check (
    property_type is null or property_type = any (array['apartment'::text, 'villa'::text, 'bungalow'::text, 'land'::text])
  ),
  constraint customer_properties_property_status_check check (
    property_status is null or property_status = any (array['Occupied'::text, 'Vacant'::text])
  )
);

create index if not exists idx_customer_properties_customer_id on public.customer_properties using btree (customer_id);

alter table public.customer_properties enable row level security;

create policy "Authenticated users can manage customer_properties"
  on public.customer_properties
  for all
  to authenticated
  using (true)
  with check (true);

comment on table public.customer_properties is 'Properties subscribed to RelyBricks per customer; one customer can have many properties.';

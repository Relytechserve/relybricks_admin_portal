-- Single field for where the customer is based (e.g. country). Separate from Indian property rows in customer_properties.

alter table public.customers
  add column if not exists customer_location text null;

comment on column public.customers.customer_location is
  'Customer location (typically country / region where they live). Not the Indian property address.';

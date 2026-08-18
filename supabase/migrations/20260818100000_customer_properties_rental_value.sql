-- Monthly/annual rental value for a property (admin-entered).
alter table public.customer_properties
  add column if not exists rental_value numeric null;

comment on column public.customer_properties.rental_value is 'Rental value of the property (currency amount).';

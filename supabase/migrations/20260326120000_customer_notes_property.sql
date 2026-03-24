-- Optional link from a note to a specific property (null = account-wide)
alter table public.customer_notes
  add column if not exists customer_property_id uuid null
    references public.customer_properties (id) on delete set null;

create index if not exists idx_customer_notes_customer_property_id
  on public.customer_notes using btree (customer_property_id);

comment on column public.customer_notes.customer_property_id is
  'When set, note is scoped to this property; null means account-wide.';

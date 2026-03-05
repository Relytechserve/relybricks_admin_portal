-- Notes/timeline per customer
create table if not exists public.customer_notes (
  id uuid not null default gen_random_uuid(),
  customer_id uuid not null,
  body text not null,
  is_customer_visible boolean not null default false,
  author_email text null,
  created_at timestamptz null default now(),
  constraint customer_notes_pkey primary key (id),
  constraint customer_notes_customer_id_fkey foreign key (customer_id) references public.customers (id) on delete cascade
);

create index if not exists idx_customer_notes_customer_id_created_at
  on public.customer_notes using btree (customer_id, created_at desc);

alter table public.customer_notes enable row level security;

create policy "Authenticated users can manage customer_notes"
  on public.customer_notes
  for all
  to authenticated
  using (true)
  with check (true);

comment on table public.customer_notes is 'Per-customer notes, with internal vs customer-visible flag and author email.';


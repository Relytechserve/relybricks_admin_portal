-- Documents/files per property
create table if not exists public.property_documents (
  id uuid not null default gen_random_uuid(),
  customer_property_id uuid not null,
  file_name text not null,
  storage_path text not null,
  file_size bigint null,
  content_type text null,
  created_at timestamptz null default now(),
  constraint property_documents_pkey primary key (id),
  constraint property_documents_customer_property_id_fkey foreign key (customer_property_id) references public.customer_properties (id) on delete cascade
);

create index if not exists idx_property_documents_customer_property_id on public.property_documents using btree (customer_property_id);

alter table public.property_documents enable row level security;

create policy "Authenticated users can manage property_documents"
  on public.property_documents
  for all
  to authenticated
  using (true)
  with check (true);

comment on table public.property_documents is 'Files and documents uploaded for a customer property.';

-- Storage bucket (run in SQL editor if needed; bucket may need to be created in Dashboard > Storage)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'property-documents',
  'property-documents',
  false,
  10485760,
  array['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'text/plain', 'text/csv']
)
on conflict (id) do nothing;

create policy "Authenticated users can upload property documents"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'property-documents');

create policy "Authenticated users can read property documents"
  on storage.objects for select to authenticated
  using (bucket_id = 'property-documents');

create policy "Authenticated users can delete property documents"
  on storage.objects for delete to authenticated
  using (bucket_id = 'property-documents');

create policy "Authenticated users can update property documents"
  on storage.objects for update to authenticated
  using (bucket_id = 'property-documents');

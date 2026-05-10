create table if not exists public.invoice_email_logs (
  id bigserial primary key,
  invoice_id bigint not null references public.invoices(id) on delete cascade,
  recipient_email text not null,
  subject text not null,
  status text not null check (status in ('queued', 'sent', 'failed')),
  provider_message_id text null,
  error_message text null,
  sent_at timestamptz null,
  created_by uuid null references auth.users(id),
  created_at timestamptz not null default now()
);

create index if not exists invoice_email_logs_invoice_id_idx on public.invoice_email_logs(invoice_id, created_at desc);

alter table public.invoice_email_logs enable row level security;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public' and tablename = 'invoice_email_logs' and policyname = 'invoice_email_logs_admin_all'
  ) then
    create policy invoice_email_logs_admin_all
      on public.invoice_email_logs
      for all
      to authenticated
      using (exists (select 1 from public.profiles p where p.user_id = auth.uid() and p.role = 'admin'))
      with check (exists (select 1 from public.profiles p where p.user_id = auth.uid() and p.role = 'admin'));
  end if;
end $$;

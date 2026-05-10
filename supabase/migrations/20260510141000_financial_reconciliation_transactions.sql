create table if not exists public.financial_reconciliation_transactions (
  id bigserial primary key,
  fingerprint text not null unique,
  source_file text not null,
  source_page integer null,
  source_line integer null,
  statement_period text null,
  tx_date date not null,
  particulars text not null,
  chq_ref_no text null,
  withdrawal numeric(14,2) null,
  deposit numeric(14,2) null,
  balance numeric(14,2) null,
  flow text not null check (flow in ('deposit', 'withdrawal', 'unknown')),
  ingested_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

create index if not exists frt_tx_date_idx
  on public.financial_reconciliation_transactions (tx_date desc);

create index if not exists frt_flow_tx_date_idx
  on public.financial_reconciliation_transactions (flow, tx_date desc);

create index if not exists frt_source_file_idx
  on public.financial_reconciliation_transactions (source_file);

alter table public.financial_reconciliation_transactions enable row level security;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'financial_reconciliation_transactions'
      and policyname = 'financial_reconciliation_transactions_admin_all'
  ) then
    create policy financial_reconciliation_transactions_admin_all
      on public.financial_reconciliation_transactions
      for all
      to authenticated
      using (
        exists (
          select 1
          from public.profiles p
          where p.user_id = auth.uid()
            and p.role = 'admin'
        )
      )
      with check (
        exists (
          select 1
          from public.profiles p
          where p.user_id = auth.uid()
            and p.role = 'admin'
        )
      );
  end if;
end $$;

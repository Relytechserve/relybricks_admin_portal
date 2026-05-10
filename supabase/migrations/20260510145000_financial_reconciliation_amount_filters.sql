alter table public.financial_reconciliation_transactions
  add column if not exists transaction_amount numeric(14,2) null;

update public.financial_reconciliation_transactions
set transaction_amount = coalesce(deposit, withdrawal)
where transaction_amount is null;

create index if not exists frt_transaction_amount_idx
  on public.financial_reconciliation_transactions (transaction_amount);

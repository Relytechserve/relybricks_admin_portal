-- Atomic reset before a full statement re-ingest: clears FK-dependent rows first, then truncates reconciliation data.

create or replace function public.reset_financial_reconciliation_transactions()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.invoice_transaction_links;
  update public.invoice_line_items
  set source_transaction_id = null
  where source_transaction_id is not null;
  truncate table public.financial_reconciliation_transactions restart identity;
end;
$$;

revoke all on function public.reset_financial_reconciliation_transactions() from public;
grant execute on function public.reset_financial_reconciliation_transactions() to service_role;

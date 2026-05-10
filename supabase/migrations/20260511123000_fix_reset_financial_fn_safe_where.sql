-- Supabase enables safe-delete guards so bare `DELETE FROM t` fails even inside SECURITY DEFINER
-- RPCs (“DELETE requires a WHERE clause”). Use an explicit predicate.
create or replace function public.reset_financial_reconciliation_transactions()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.invoice_transaction_links where id is not null;
  update public.invoice_line_items
  set source_transaction_id = null
  where source_transaction_id is not null;
  truncate table public.financial_reconciliation_transactions restart identity;
end;
$$;

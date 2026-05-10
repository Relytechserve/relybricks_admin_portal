-- TRUNCATE financial_reconciliation_transactions fails while invoice_* tables still
-- define FK references to it ("cannot truncate a table referenced in a foreign key constraint").
-- After clearing links and nulling line-item FKs, DELETE all rows and reset the id sequence.
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
  delete from public.financial_reconciliation_transactions where id is not null;
  perform setval(
    pg_get_serial_sequence('public.financial_reconciliation_transactions', 'id'),
    1,
    false
  );
end;
$$;

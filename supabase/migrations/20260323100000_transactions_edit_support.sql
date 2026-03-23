-- Add edit support to transactions: track updates and require reason when editing

alter table public.transactions
  add column if not exists updated_at timestamptz null default null,
  add column if not exists last_edit_reason text null;

comment on column public.transactions.updated_at is 'Set when the transaction is edited';
comment on column public.transactions.last_edit_reason is 'Required reason provided when an admin edits the transaction';

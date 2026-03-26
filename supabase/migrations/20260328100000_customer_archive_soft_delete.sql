-- Soft-delete (archive) customers: hide from app, allow email reuse for new accounts.

alter table public.customers
  add column if not exists archived_at timestamptz null;

alter table public.customers
  add column if not exists archived_reason text null;

comment on column public.customers.archived_at is 'When set, customer is archived: hidden from lists, login disabled, email may be reused.';
comment on column public.customers.archived_reason is 'Optional note recorded when archiving (e.g. admin reason).';

create index if not exists idx_customers_archived_at
  on public.customers using btree (archived_at);

-- Replace global email uniqueness with "one active row per email" so archived rows can share email with a new customer.
do $$
declare
  r record;
begin
  for r in
    select c.conname, c.oid
    from pg_constraint c
    join pg_class rel on rel.oid = c.conrelid
    join pg_namespace n on n.oid = rel.relnamespace
    where n.nspname = 'public'
      and rel.relname = 'customers'
      and c.contype = 'u'
      and pg_get_constraintdef(c.oid) ilike '%email%'
  loop
    execute format('alter table public.customers drop constraint %I', r.conname);
  end loop;
end $$;

-- In case email was enforced via a unique index only
drop index if exists public.customers_email_unique;
drop index if exists public.customers_email_key;

-- Before the partial unique index, resolve duplicate emails among active rows.
-- Keeps one row per lower(trim(email)) (deterministic: smallest id wins).
with ranked as (
  select
    id,
    row_number() over (
      partition by lower(trim(email))
      order by id asc
    ) as rn
  from public.customers
  where email is not null
    and trim(email) <> ''
    and archived_at is null
)
update public.customers c
set
  archived_at = now(),
  archived_reason = coalesce(
    c.archived_reason,
    'Migration: duplicate email (auto-archived). One row kept per email; review in admin if needed.'
  )
from ranked r
where c.id = r.id
  and r.rn > 1;

create unique index if not exists customers_email_active_unique
  on public.customers (lower(trim(email)))
  where archived_at is null
    and email is not null
    and trim(email) <> '';

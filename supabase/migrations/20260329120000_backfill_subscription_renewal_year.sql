-- Backfill subscription year + paid status from existing renewal rows (matches app subscription_year_index logic).
-- Safe to run after 20260329100000_property_renewal_year_paid_status.sql.
-- Does not invent renewal rows; only customers with property-linked renewal transactions are updated.

create or replace function public.subscription_year_index(anchor date, payment date)
returns integer
language plpgsql
immutable
as $$
declare
  k int := 1;
  period_end date;
begin
  if anchor is null or payment is null then
    return null;
  end if;
  if payment < anchor then
    return 1;
  end if;
  loop
    period_end := (anchor + (interval '1 year' * k))::date;
    if payment < period_end then
      return k;
    end if;
    k := k + 1;
    if k > 500 then
      return null;
    end if;
  end loop;
end;
$$;

comment on function public.subscription_year_index(date, date) is
  '1-based subscription year from property subscription_date and payment date (same rules as app).';

-- Fill subscription_renewal_year on existing property renewals where property has subscription_date.
update public.transactions t
set subscription_renewal_year = public.subscription_year_index(
  cp.subscription_date::date,
  t.date::date
)
from public.customer_properties cp
where t.customer_property_id = cp.id
  and t.type = 'renewal'
  and t.subscription_renewal_year is null
  and cp.subscription_date is not null;

-- One paid row per (property, subscription_year) when at least one renewal txn exists; preserve admin overrides.
insert into public.property_renewal_year_status (
  customer_property_id,
  subscription_year,
  is_paid,
  paid_source,
  updated_at
)
select distinct
  t.customer_property_id,
  t.subscription_renewal_year,
  true,
  'auto',
  now()
from public.transactions t
where t.type = 'renewal'
  and t.customer_property_id is not null
  and t.subscription_renewal_year is not null
on conflict (customer_property_id, subscription_year) do update
set
  is_paid = case
    when public.property_renewal_year_status.paid_source = 'admin_override'::text
    then public.property_renewal_year_status.is_paid
    else true
  end,
  paid_source = case
    when public.property_renewal_year_status.paid_source = 'admin_override'::text
    then public.property_renewal_year_status.paid_source
    else 'auto'::text
  end,
  updated_at = case
    when public.property_renewal_year_status.paid_source = 'admin_override'::text
    then public.property_renewal_year_status.updated_at
    else now()
  end;

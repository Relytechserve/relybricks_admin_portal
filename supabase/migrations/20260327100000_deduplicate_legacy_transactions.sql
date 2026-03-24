-- Remove legacy transaction rows (customer_property_id is null) that duplicate a
-- property-linked row for the same customer: same date, type, and amount.
-- Only runs for customers who have at least one customer_properties row, so we do not
-- touch accounts that still rely entirely on account-wide transactions.
--
-- Typical case: renewal logged twice after property-level migration (e.g. "All properties"
-- plus the same payment on Chennai).

delete from public.transactions t_legacy
where t_legacy.customer_property_id is null
  and exists (
    select 1
    from public.customer_properties cp
    where cp.customer_id = t_legacy.customer_id
  )
  and exists (
    select 1
    from public.transactions t_prop
    where t_prop.customer_id = t_legacy.customer_id
      and t_prop.customer_property_id is not null
      and (t_prop.date)::date = (t_legacy.date)::date
      and t_prop.type = t_legacy.type
      and (
        (t_prop.amount is null and t_legacy.amount is null)
        or (
          t_prop.amount is not null
          and t_legacy.amount is not null
          and t_prop.amount = t_legacy.amount
        )
      )
  );

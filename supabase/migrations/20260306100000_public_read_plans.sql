-- Allow public (anon) read access to active subscription tiers and prices
-- so the RelyBricks marketing website can display plans without logging in.

create policy "Public can read active subscription_tiers"
  on public.subscription_tiers
  for select
  to anon
  using (is_active = true);

create policy "Public can read active subscription_tier_prices"
  on public.subscription_tier_prices
  for select
  to anon
  using (is_active = true);

-- Shared audit trail for admin actions (visible to all admins on the dashboard)

create table if not exists public.admin_activity_log (
  id uuid not null default gen_random_uuid(),
  created_at timestamptz not null default now(),
  actor_user_id uuid not null,
  actor_email text null,
  action text not null,
  resource_type text null,
  resource_id text null,
  summary text not null,
  constraint admin_activity_log_pkey primary key (id)
);

create index if not exists idx_admin_activity_log_created_at
  on public.admin_activity_log using btree (created_at desc);

comment on table public.admin_activity_log is 'Append-only admin audit trail for dashboard Recent Activity.';

alter table public.admin_activity_log enable row level security;

create policy "Admins can read admin activity log"
  on public.admin_activity_log
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.profiles p
      where p.user_id = auth.uid()
        and p.role = 'admin'
    )
  );

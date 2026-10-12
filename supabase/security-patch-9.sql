-- Patch 9: the super admin confirms sign-in with an emailed link instead of an authenticator app,
-- and today's signup and sign-in counters are cleared.
-- Run after security-patch-8.sql. Safe to run twice.

-- 1. Sign-ins waiting for, or approved by, the emailed link. Server only: no browser access.
create table if not exists admin_steps (
  session_id uuid primary key,                 -- the session_id inside the Supabase sign-in token
  user_id uuid not null references auth.users(id) on delete cascade,
  sent_at timestamptz not null default now(),
  approved_at timestamptz,
  ip text,
  user_agent text
);
create index if not exists admin_steps_user on admin_steps(user_id, sent_at desc);
alter table admin_steps enable row level security;
revoke all on admin_steps from anon, authenticated;

-- 2. The database accepts the super admin when the session passed the app code (aal2) OR the emailed
--    link approved this exact session in the last 12 hours. Everyone else is unchanged.
create or replace function auth_ok() returns boolean language sql stable security definer set search_path = public, auth as $$
  select case
    when auth.uid() is null then false
    when (select role from public.profiles where id = auth.uid()) = 'super_admin' then
      coalesce(auth.jwt() ->> 'aal', '') = 'aal2'
      or exists (select 1 from public.admin_steps s
                 where s.user_id = auth.uid()
                   and s.session_id::text = coalesce(auth.jwt() ->> 'session_id', '')
                   and s.approved_at is not null
                   and s.approved_at > now() - interval '12 hours')
    when exists (select 1 from auth.mfa_factors f where f.user_id = auth.uid() and f.status = 'verified') then coalesce(auth.jwt() ->> 'aal', '') = 'aal2'
    else true
  end $$;
revoke execute on function auth_ok() from public, anon;
grant execute on function auth_ok() to authenticated;

-- 3. Clear the counters that locked people out while sign-in was sending owners to "create business".
delete from rate_limits where key like 'signup:%';
delete from login_attempts;

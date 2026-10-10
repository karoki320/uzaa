-- UZAA security patch 2: rate limiting, lockout, auth log, 2FA enforcement, backup codes, speed.
-- Safe to run more than once. Run security-patch.sql first, then this file, in the Supabase SQL Editor.

-- 1. Tables the server uses to slow down and log attackers (service role only, no browser access)
create table if not exists rate_limits (
  key text primary key,
  count int not null default 0,
  window_start timestamptz not null default now()
);
create table if not exists login_attempts (
  key text primary key,
  failures int not null default 0,
  last_failure_at timestamptz,
  locked_until timestamptz
);
create table if not exists auth_events (
  id bigserial primary key,
  created_at timestamptz not null default now(),
  event text not null,
  email text,
  ip text,
  success boolean,
  detail text
);
create index if not exists auth_events_time on auth_events(created_at desc);
create index if not exists auth_events_email_time on auth_events(email, created_at desc);
create table if not exists mfa_backup_codes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  code_hash text not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists mfa_backup_user on mfa_backup_codes(user_id);

alter table rate_limits enable row level security;
alter table login_attempts enable row level security;
alter table auth_events enable row level security;
alter table mfa_backup_codes enable row level security;
revoke all on rate_limits, login_attempts, auth_events, mfa_backup_codes from anon, authenticated;
revoke all on sequence auth_events_id_seq from anon, authenticated;

-- 2. Fixed-window counter: "5 tries per 15 minutes" style limits
create or replace function rl_hit(p_key text, p_limit int, p_window int)
returns table(allowed boolean, remaining int, retry_after int)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare r rate_limits;
begin
  insert into rate_limits(key, count, window_start) values (p_key, 1, now())
  on conflict (key) do update set
    count = case when rate_limits.window_start < now() - make_interval(secs => p_window) then 1 else rate_limits.count + 1 end,
    window_start = case when rate_limits.window_start < now() - make_interval(secs => p_window) then now() else rate_limits.window_start end
  returning * into r;
  allowed := r.count <= p_limit;
  remaining := greatest(p_limit - r.count, 0);
  retry_after := greatest(0, ceil(extract(epoch from (r.window_start + make_interval(secs => p_window) - now())))::int);
  return next;
end $$;

-- 3. Failed-login tracking with exponential backoff and lockout
create or replace function la_status(p_key text)
returns table(failures int, locked_until timestamptz)
language sql security definer set search_path = public as $$
  select failures, locked_until from login_attempts where key = p_key $$;

create or replace function la_fail(p_key text, p_free int default 3, p_lock_at int default 10)
returns table(failures int, locked_until timestamptz)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare f int; lock_until timestamptz; secs int;
begin
  insert into login_attempts(key, failures, last_failure_at) values (p_key, 1, now())
  on conflict (key) do update set
    failures = case when login_attempts.last_failure_at < now() - interval '1 hour' then 1 else login_attempts.failures + 1 end,
    last_failure_at = now()
  returning login_attempts.failures into f;
  if f > p_free then
    secs := case when f >= p_lock_at then 900 else least(5 * (2 ^ (f - p_free - 1))::int, 900) end;
    lock_until := now() + make_interval(secs => secs);
    update login_attempts set locked_until = lock_until where key = p_key;
  end if;
  return query select f, lock_until;
end $$;

create or replace function la_reset(p_key text)
returns void language sql security definer set search_path = public as $$
  delete from login_attempts where key = p_key $$;

create or replace function purge_auth_noise()
returns void language sql security definer set search_path = public as $$
  delete from rate_limits where window_start < now() - interval '1 day';
  delete from login_attempts where last_failure_at < now() - interval '1 day';
  delete from auth_events where created_at < now() - interval '180 days';
$$;

revoke execute on function rl_hit(text, int, int), la_status(text), la_fail(text, int, int), la_reset(text), purge_auth_noise() from public, anon, authenticated;
grant execute on function rl_hit(text, int, int), la_status(text), la_fail(text, int, int), la_reset(text), purge_auth_noise() to service_role;

-- 4. Two-step verification is enforced in the database, not just on the screen.
--    The super admin always needs it. Anyone who turned it on needs it on every sign-in.
create or replace function auth_ok() returns boolean language sql stable security definer set search_path = public, auth as $$
  select case
    when auth.uid() is null then false
    when (select role from public.profiles where id = auth.uid()) = 'super_admin' then coalesce(auth.jwt() ->> 'aal', '') = 'aal2'
    when exists (select 1 from auth.mfa_factors f where f.user_id = auth.uid() and f.status = 'verified') then coalesce(auth.jwt() ->> 'aal', '') = 'aal2'
    else true
  end $$;

create or replace function my_business() returns uuid language sql stable security definer set search_path = public as $$
  select p.business_id from profiles p left join businesses b on b.id = p.business_id
  where p.id = auth.uid() and p.active and auth_ok() and (p.role = 'super_admin' or b.status = 'active') $$;
create or replace function my_role() returns text language sql stable security definer set search_path = public as $$
  select p.role from profiles p left join businesses b on b.id = p.business_id
  where p.id = auth.uid() and p.active and auth_ok() and (p.role = 'super_admin' or b.status = 'active') $$;
create or replace function my_branch() returns uuid language sql stable security definer set search_path = public as $$
  select p.branch_id from profiles p left join businesses b on b.id = p.business_id
  where p.id = auth.uid() and p.active and auth_ok() and (p.role = 'super_admin' or b.status = 'active') $$;
create or replace function my_business_any() returns uuid language sql stable security definer set search_path = public as $$
  select business_id from profiles where id = auth.uid() and auth_ok() $$;

revoke execute on function auth_ok() from public, anon;
grant execute on function auth_ok() to authenticated;

-- 5. Speed: policies call the helper once per query instead of once per row
drop policy if exists biz_select on businesses;
create policy biz_select on businesses for select using ((select my_role()) = 'super_admin' or id = (select my_business()) or id = (select my_business_any()));
drop policy if exists biz_update on businesses;
create policy biz_update on businesses for update
  using ((select my_role()) = 'super_admin' or (id = (select my_business()) and (select my_role()) = 'owner'));

drop policy if exists br_select on branches;
create policy br_select on branches for select using ((select my_role()) = 'super_admin' or business_id = (select my_business()));
drop policy if exists br_insert on branches;
create policy br_insert on branches for insert with check ((select my_role()) = 'owner' and business_id = (select my_business()));
drop policy if exists br_update on branches;
create policy br_update on branches for update using ((select my_role()) = 'owner' and business_id = (select my_business()))
  with check ((select my_role()) = 'owner' and business_id = (select my_business()));

drop policy if exists pr_select on profiles;
create policy pr_select on profiles for select using (
  id = auth.uid() or (select my_role()) = 'super_admin' or (business_id = (select my_business()) and (select my_role()) in ('owner','manager')));

drop policy if exists prod_select on products;
create policy prod_select on products for select using ((select my_role()) = 'super_admin' or business_id = (select my_business()));
drop policy if exists prod_write on products;
create policy prod_write on products for all using ((select my_role()) in ('owner','manager') and business_id = (select my_business()))
  with check ((select my_role()) in ('owner','manager') and business_id = (select my_business()));

drop policy if exists stock_select on stock;
create policy stock_select on stock for select using (
  (select my_role()) = 'super_admin' or (business_id = (select my_business()) and ((select my_role()) in ('owner','manager') or branch_id = (select my_branch()))));

drop policy if exists mov_select on stock_movements;
create policy mov_select on stock_movements for select using (
  (select my_role()) = 'super_admin' or (business_id = (select my_business()) and (select my_role()) in ('owner','manager')));

drop policy if exists sales_select on sales;
create policy sales_select on sales for select using (
  (select my_role()) = 'super_admin' or (business_id = (select my_business()) and ((select my_role()) in ('owner','manager') or cashier_id = auth.uid())));

-- 6. Speed: indexes on the columns the screens filter and sort by
create index if not exists products_biz_active_name on products(business_id, active, name);
create index if not exists stock_biz_branch on stock(business_id, branch_id);
create index if not exists stock_movements_biz_time on stock_movements(business_id, created_at desc);
create index if not exists stock_movements_branch_time on stock_movements(branch_id, created_at desc);
create index if not exists stock_movements_product on stock_movements(product_id);
create index if not exists sales_branch_time on sales(branch_id, created_at desc);
create index if not exists sales_cashier_time on sales(cashier_id, created_at desc);
create index if not exists sale_items_product on sale_items(product_id);
create index if not exists profiles_business on profiles(business_id);
create index if not exists branches_business on branches(business_id);

-- 7. When someone confirms a new email address, keep their profile in step
create or replace function sync_profile_email() returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.profiles set email = new.email where id = new.id;
  return new;
end $$;
drop trigger if exists on_auth_email_change on auth.users;
create trigger on_auth_email_change after update of email on auth.users
  for each row when (old.email is distinct from new.email) execute function sync_profile_email();

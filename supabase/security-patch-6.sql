-- Patch 6: a sales team, and terms every user must accept.
-- Run after security-patch-5.sql. Safe to run twice.
--  * a new role, sales: belongs to Uzaa rather than to a shop. A sales agent sets a business up,
--    invites the owner by email, and afterwards only sees the name, the owner and the status.
--  * a business a sales agent creates starts pending; the super admin activates it once it is paid.
--  * every user ticks the terms once; the date and version are kept on their profile.

-- 1. the new role ------------------------------------------------------
alter table profiles drop constraint if exists profiles_role_check;
alter table profiles add constraint profiles_role_check
  check (role in ('super_admin','sales','owner','manager','cashier'));

alter table profiles add column if not exists terms_accepted_at timestamptz;
alter table profiles add column if not exists terms_version text;

alter table businesses add column if not exists agent_id uuid references profiles(id) on delete set null;
alter table businesses add column if not exists owner_email text default '';
alter table businesses add column if not exists invited_at timestamptz;
alter table businesses drop constraint if exists businesses_status_chk;
alter table businesses add constraint businesses_status_chk check (status in ('active','pending','suspended'));
create index if not exists businesses_agent on businesses(agent_id) where agent_id is not null;

-- 2. a sales agent has no business of their own, so the helpers must not require one -----
create or replace function my_business() returns uuid language sql stable security definer set search_path = public as $$
  select p.business_id from profiles p left join businesses b on b.id = p.business_id
  where p.id = auth.uid() and p.active and auth_ok() and (p.role in ('super_admin','sales') or b.status = 'active') $$;
create or replace function my_role() returns text language sql stable security definer set search_path = public as $$
  select p.role from profiles p left join businesses b on b.id = p.business_id
  where p.id = auth.uid() and p.active and auth_ok() and (p.role in ('super_admin','sales') or b.status = 'active') $$;
create or replace function my_branch() returns uuid language sql stable security definer set search_path = public as $$
  select p.branch_id from profiles p left join businesses b on b.id = p.business_id
  where p.id = auth.uid() and p.active and auth_ok() and (p.role in ('super_admin','sales') or b.status = 'active') $$;

-- 3. what a sales agent may read --------------------------------------
-- Their own businesses by name and status only. Everything inside a shop (sales, stock, staff,
-- customers) stays closed to them: no policy anywhere grants the sales role access to it.
drop policy if exists biz_select on businesses;
create policy biz_select on businesses for select using (
  (select my_role()) = 'super_admin'
  or id = (select my_business())
  or id = (select my_business_any())
  or ((select my_role()) = 'sales' and agent_id = auth.uid()));

drop policy if exists pr_select on profiles;
create policy pr_select on profiles for select using (
  id = auth.uid()
  or (select my_role()) = 'super_admin'
  or (business_id = (select my_business()) and (select my_role()) in ('owner','manager')));

-- 4. the agent sets up a business and the owner is invited ------------
-- The caller must be an active sales agent. The auth user is created by the server first; this
-- function makes the business, its first branch and the owner's profile in one transaction.
create or replace function create_business_as_agent(
  p_owner uuid, p_name text, p_type text, p_owner_name text, p_owner_email text,
  p_branch text default 'Main Branch', p_item_label text default 'Product', p_custom_fields jsonb default '[]'::jsonb
) returns uuid language plpgsql security definer set search_path = public as $$
declare bid uuid; brid uuid;
begin
  if my_role() <> 'sales' then raise exception 'Not allowed'; end if;
  if coalesce(btrim(p_name), '') = '' then raise exception 'Enter the business name'; end if;
  if coalesce(btrim(p_owner_name), '') = '' then raise exception 'Enter the owner name'; end if;
  if exists (select 1 from profiles where id = p_owner) then raise exception 'That person already has an account'; end if;
  insert into businesses(name, business_type, item_label, custom_fields, status, agent_id, owner_email, invited_at)
    values (left(btrim(p_name), 120), coalesce(p_type, 'retail'), coalesce(nullif(btrim(p_item_label), ''), 'Product'),
            coalesce(p_custom_fields, '[]'::jsonb), 'pending', auth.uid(), lower(btrim(p_owner_email)), now())
    returning id into bid;
  insert into branches(business_id, name) values (bid, left(coalesce(nullif(btrim(p_branch), ''), 'Main Branch'), 80))
    returning id into brid;
  insert into profiles(id, business_id, branch_id, full_name, email, role)
    values (p_owner, bid, brid, left(btrim(p_owner_name), 120), lower(btrim(p_owner_email)), 'owner');
  return bid;
end $$;
revoke execute on function create_business_as_agent(uuid, text, text, text, text, text, text, jsonb) from public, anon;
grant execute on function create_business_as_agent(uuid, text, text, text, text, text, text, jsonb) to authenticated;

-- 5. the agent's own list ---------------------------------------------
drop function if exists agent_businesses();
create or replace function agent_businesses()
returns table(id uuid, name text, business_type text, status text, owner_email text, owner_name text,
              invited_at timestamptz, created_at timestamptz, joined boolean)
language plpgsql security definer set search_path = public as $$
begin
  if my_role() <> 'sales' then raise exception 'Not allowed'; end if;
  return query
  select b.id, b.name, b.business_type, b.status, b.owner_email,
    (select p.full_name from profiles p where p.business_id = b.id and p.role = 'owner' limit 1),
    b.invited_at, b.created_at,
    exists (select 1 from auth.users u join profiles p on p.id = u.id
            where p.business_id = b.id and p.role = 'owner' and u.last_sign_in_at is not null)
  from businesses b where b.agent_id = auth.uid() order by b.created_at desc;
end $$;
revoke execute on function agent_businesses() from public, anon;
grant execute on function agent_businesses() to authenticated;
alter function agent_businesses() set search_path = public, auth;

-- 6. the super admin's view of the sales team -------------------------
drop function if exists admin_agents();
create or replace function admin_agents()
returns table(id uuid, full_name text, email text, active boolean, created_at timestamptz,
              signed bigint, live bigint, pending bigint)
language plpgsql security definer set search_path = public as $$
begin
  if my_role() <> 'super_admin' then raise exception 'Not allowed'; end if;
  return query
  select p.id, p.full_name, p.email, p.active, p.created_at,
    (select count(*) from businesses b where b.agent_id = p.id),
    (select count(*) from businesses b where b.agent_id = p.id and b.status = 'active'),
    (select count(*) from businesses b where b.agent_id = p.id and b.status = 'pending')
  from profiles p where p.role = 'sales' order by p.created_at desc;
end $$;
revoke execute on function admin_agents() from public, anon;
grant execute on function admin_agents() to authenticated;

-- the super admin's business list now shows who signed each one
drop function if exists admin_overview();
create or replace function admin_overview()
returns table(id uuid, name text, business_type text, status text, created_at timestamptz, branches bigint,
              staff bigint, sales_count bigint, revenue_7d numeric, last_sale timestamptz, owner_email text, agent_name text)
language plpgsql security definer set search_path = public as $$
begin
  if my_role() <> 'super_admin' then raise exception 'Not allowed'; end if;
  return query
  select b.id, b.name, b.business_type, b.status, b.created_at,
    (select count(*) from branches x where x.business_id = b.id),
    (select count(*) from profiles x where x.business_id = b.id),
    (select count(*) from sales s where s.business_id = b.id),
    (select coalesce(sum(s.total),0) from sales s where s.business_id = b.id and s.created_at > now() - interval '7 days'),
    (select max(s.created_at) from sales s where s.business_id = b.id),
    coalesce((select p.email from profiles p where p.business_id = b.id and p.role = 'owner' limit 1), b.owner_email),
    (select a.full_name from profiles a where a.id = b.agent_id)
  from businesses b order by b.created_at desc;
end $$;
revoke execute on function admin_overview() from public, anon;
grant execute on function admin_overview() to authenticated;

-- 7. accepting the terms ----------------------------------------------
create or replace function accept_terms(p_version text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  update profiles set terms_accepted_at = now(), terms_version = left(coalesce(p_version, ''), 40)
  where id = auth.uid();
end $$;
revoke execute on function accept_terms(text) from public, anon;
grant execute on function accept_terms(text) to authenticated;

-- a shop owner who signs up for themselves accepts on the form, so record it there too
create or replace function register_business(p_name text, p_type text, p_full_name text, p_item_label text default 'Product', p_custom_fields jsonb default '[]'::jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare bid uuid; brid uuid;
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  if exists (select 1 from profiles where id = auth.uid()) then raise exception 'You already have a business'; end if;
  insert into businesses(name, business_type, item_label, custom_fields)
    values (left(btrim(p_name), 120), coalesce(p_type, 'retail'), coalesce(nullif(btrim(p_item_label), ''), 'Product'), coalesce(p_custom_fields, '[]'::jsonb))
    returning id into bid;
  insert into branches(business_id, name) values (bid, 'Main Branch') returning id into brid;
  insert into profiles(id, business_id, branch_id, full_name, email, role, terms_accepted_at)
    values (auth.uid(), bid, brid, left(btrim(p_full_name), 120),
            (select email from auth.users where id = auth.uid()), 'owner', now());
  return bid;
end $$;
alter function register_business(text, text, text, text, jsonb) set search_path = public, auth;
revoke execute on function register_business(text, text, text, text, jsonb) from public, anon;
grant execute on function register_business(text, text, text, text, jsonb) to authenticated;

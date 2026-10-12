-- Uzaa: every database change in order, safe to run as many times as you like.
-- Paste this whole file into the Supabase SQL editor and press Run.
-- It covers patches 1 to 8. If you are unsure what has been applied, run this.


-- ================== security-patch.sql ==================

-- UZAA security patch. Safe to run more than once. Run in Supabase SQL Editor.

-- 1. Disabled staff and suspended businesses lose database access, not just the screen
create or replace function my_business() returns uuid language sql stable security definer set search_path = public as $$
  select p.business_id from profiles p left join businesses b on b.id = p.business_id
  where p.id = auth.uid() and p.active and (p.role = 'super_admin' or b.status = 'active') $$;
create or replace function my_role() returns text language sql stable security definer set search_path = public as $$
  select p.role from profiles p left join businesses b on b.id = p.business_id
  where p.id = auth.uid() and p.active and (p.role = 'super_admin' or b.status = 'active') $$;
create or replace function my_branch() returns uuid language sql stable security definer set search_path = public as $$
  select p.branch_id from profiles p left join businesses b on b.id = p.business_id
  where p.id = auth.uid() and p.active and (p.role = 'super_admin' or b.status = 'active') $$;
-- lets a suspended business still read its own row so the app can show the "suspended" message
create or replace function my_business_any() returns uuid language sql stable security definer set search_path = public as $$
  select business_id from profiles where id = auth.uid() $$;

drop policy if exists biz_select on businesses;
create policy biz_select on businesses for select using (my_role() = 'super_admin' or id = my_business() or id = my_business_any());

-- 2. Only the Uzaa super admin can change a business status (owners could un-suspend themselves)
create or replace function businesses_guard() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and coalesce(my_role(), '') <> 'super_admin' then
    if new.status is distinct from old.status or new.id is distinct from old.id or new.created_at is distinct from old.created_at then
      raise exception 'Not allowed';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists businesses_guard on businesses;
create trigger businesses_guard before update on businesses for each row execute function businesses_guard();

-- 3. Branches: owners can add and edit, but not delete (a delete would wipe that branch's sales history)
drop policy if exists br_write on branches;
drop policy if exists br_insert on branches;
drop policy if exists br_update on branches;
create policy br_insert on branches for insert with check (my_role() = 'owner' and business_id = my_business());
create policy br_update on branches for update using (my_role() = 'owner' and business_id = my_business()) with check (my_role() = 'owner' and business_id = my_business());

-- 4. Receipt numbers cannot repeat inside one business
create unique index if not exists sales_receipt_unique on sales(business_id, receipt_no);

-- 5. create_sale: always use the stored price, reject bad quantities, discounts and payments
create or replace function create_sale(p_branch uuid, p_items jsonb, p_payment text, p_paid numeric, p_discount numeric default 0, p_note text default '')
returns uuid language plpgsql security definer set search_path = public as $$
declare bid uuid := my_business(); r text := my_role(); sid uuid; rno bigint; it jsonb; pr record;
  sub numeric := 0; tx numeric; rate numeric; q numeric; disc numeric := coalesce(p_discount, 0);
begin
  if bid is null then raise exception 'No business'; end if;
  if not exists (select 1 from branches where id = p_branch and business_id = bid) then raise exception 'Bad branch'; end if;
  if r = 'cashier' and p_branch <> my_branch() then raise exception 'Not your branch'; end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then raise exception 'Empty cart'; end if;
  if jsonb_array_length(p_items) > 200 then raise exception 'Too many items'; end if;
  if disc < 0 then raise exception 'Bad discount'; end if;
  if coalesce(p_paid, 0) < 0 then raise exception 'Bad payment'; end if;
  perform pg_advisory_xact_lock(hashtext(bid::text));
  select coalesce(max(receipt_no),0)+1 into rno from sales where business_id = bid;
  select tax_rate into rate from businesses where id = bid;
  insert into sales(business_id, branch_id, cashier_id, receipt_no, payment_method, amount_paid, discount, note)
    values (bid, p_branch, auth.uid(), rno, left(p_payment, 40), coalesce(p_paid, 0), disc, left(coalesce(p_note,''), 500)) returning id into sid;
  for it in select * from jsonb_array_elements(p_items) loop
    select * into pr from products where id = (it->>'product_id')::uuid and business_id = bid and active;
    if not found then raise exception 'Unknown product'; end if;
    q := (it->>'qty')::numeric;
    if q <= 0 or q > 100000 then raise exception 'Bad quantity'; end if;
    insert into sale_items(sale_id, product_id, name, qty, price, cost) values (sid, pr.id, pr.name, q, pr.price, pr.cost);
    sub := sub + q * pr.price;
    if pr.track_stock then
      insert into stock(product_id, branch_id, business_id, qty) values (pr.id, p_branch, bid, -q)
        on conflict (product_id, branch_id) do update set qty = stock.qty - q;
      insert into stock_movements(business_id, branch_id, product_id, change, reason, user_id)
        values (bid, p_branch, pr.id, -q, 'Sale #' || rno, auth.uid());
    end if;
  end loop;
  if disc > sub then raise exception 'Discount is larger than the sale'; end if;
  tx := round((sub - disc) * coalesce(rate,0) / 100, 2);
  update sales set subtotal = sub, tax = tx, total = sub - disc + tx where id = sid;
  return sid;
end $$;

-- 6. Signed-out visitors cannot call any of these
revoke execute on function register_business(text, text, text, text, jsonb) from public, anon;
revoke execute on function create_sale(uuid, jsonb, text, numeric, numeric, text) from public, anon;
revoke execute on function adjust_stock(uuid, uuid, numeric, text) from public, anon;
revoke execute on function weekly_report(timestamptz, timestamptz, uuid) from public, anon;
revoke execute on function admin_overview() from public, anon;
revoke execute on function my_business() from public, anon;
revoke execute on function my_role() from public, anon;
revoke execute on function my_branch() from public, anon;
revoke execute on function my_business_any() from public, anon;
grant execute on function register_business(text, text, text, text, jsonb), create_sale(uuid, jsonb, text, numeric, numeric, text),
  adjust_stock(uuid, uuid, numeric, text), weekly_report(timestamptz, timestamptz, uuid), admin_overview(),
  my_business(), my_role(), my_branch(), my_business_any() to authenticated;

-- ================== security-patch-2.sql ==================

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

-- ================== security-patch-3.sql ==================

-- UZAA patch 3: categories list, units of measure, receipt mode, barcode on/off.
-- Safe to run more than once. Run after security-patch-2.sql.

-- 1. Categories managed in Settings (products keep the category name as text, so nothing existing breaks)
create table if not exists categories (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  name text not null check (char_length(trim(name)) between 1 and 60),
  created_at timestamptz default now()
);
create unique index if not exists categories_biz_name on categories(business_id, lower(trim(name)));
create index if not exists categories_biz on categories(business_id);
alter table categories enable row level security;
drop policy if exists cat_select on categories;
create policy cat_select on categories for select using ((select my_role()) = 'super_admin' or business_id = (select my_business()));
drop policy if exists cat_write on categories;
create policy cat_write on categories for all
  using ((select my_role()) in ('owner','manager') and business_id = (select my_business()))
  with check ((select my_role()) in ('owner','manager') and business_id = (select my_business()));
revoke all on categories from anon;
grant select, insert, update, delete on categories to authenticated;

-- fill the list from categories already typed on products
insert into categories(business_id, name)
  select distinct on (business_id, lower(trim(category))) business_id, trim(category) from products where trim(coalesce(category,'')) <> ''
  on conflict do nothing;

-- 2. Units of measure (litre, kg, piece ...) on products, copied onto each sale line
alter table products add column if not exists unit text not null default 'pc';
alter table sale_items add column if not exists unit text not null default 'pc';

-- 3. Business-level choices
alter table businesses add column if not exists receipt_mode text not null default 'always';
alter table businesses add column if not exists barcode_enabled boolean not null default true;
alter table businesses drop constraint if exists businesses_receipt_mode_chk;
alter table businesses add constraint businesses_receipt_mode_chk check (receipt_mode in ('always','ask','never'));

-- 4. create_sale now records each item's unit (everything else unchanged)
create or replace function create_sale(p_branch uuid, p_items jsonb, p_payment text, p_paid numeric, p_discount numeric default 0, p_note text default '')
returns uuid language plpgsql security definer set search_path = public as $$
declare bid uuid := my_business(); r text := my_role(); sid uuid; rno bigint; it jsonb; pr record;
  sub numeric := 0; tx numeric; rate numeric; q numeric; disc numeric := coalesce(p_discount, 0);
begin
  if bid is null then raise exception 'No business'; end if;
  if not exists (select 1 from branches where id = p_branch and business_id = bid) then raise exception 'Bad branch'; end if;
  if r = 'cashier' and p_branch <> my_branch() then raise exception 'Not your branch'; end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then raise exception 'Empty cart'; end if;
  if jsonb_array_length(p_items) > 200 then raise exception 'Too many items'; end if;
  if disc < 0 then raise exception 'Bad discount'; end if;
  if coalesce(p_paid, 0) < 0 then raise exception 'Bad payment'; end if;
  perform pg_advisory_xact_lock(hashtext(bid::text));
  select coalesce(max(receipt_no),0)+1 into rno from sales where business_id = bid;
  select tax_rate into rate from businesses where id = bid;
  insert into sales(business_id, branch_id, cashier_id, receipt_no, payment_method, amount_paid, discount, note)
    values (bid, p_branch, auth.uid(), rno, left(p_payment, 40), coalesce(p_paid, 0), disc, left(coalesce(p_note,''), 500)) returning id into sid;
  for it in select * from jsonb_array_elements(p_items) loop
    select * into pr from products where id = (it->>'product_id')::uuid and business_id = bid and active;
    if not found then raise exception 'Unknown product'; end if;
    q := round((it->>'qty')::numeric, 3);
    if q <= 0 or q > 100000 then raise exception 'Bad quantity'; end if;
    insert into sale_items(sale_id, product_id, name, qty, price, cost, unit) values (sid, pr.id, pr.name, q, pr.price, pr.cost, pr.unit);
    sub := sub + q * pr.price;
    if pr.track_stock then
      insert into stock(product_id, branch_id, business_id, qty) values (pr.id, p_branch, bid, -q)
        on conflict (product_id, branch_id) do update set qty = stock.qty - q;
      insert into stock_movements(business_id, branch_id, product_id, change, reason, user_id)
        values (bid, p_branch, pr.id, -q, 'Sale #' || rno, auth.uid());
    end if;
  end loop;
  if disc > sub then raise exception 'Discount is larger than the sale'; end if;
  tx := round((sub - disc) * coalesce(rate,0) / 100, 2);
  update sales set subtotal = sub, tax = tx, total = sub - disc + tx where id = sid;
  return sid;
end $$;
revoke execute on function create_sale(uuid, jsonb, text, numeric, numeric, text) from public, anon;
grant execute on function create_sale(uuid, jsonb, text, numeric, numeric, text) to authenticated;

-- ================== security-patch-4.sql ==================

-- Patch 4: offline sales.
-- Run after security-patch-3.sql. Safe to run twice.
--  * every sale carries a client_id, so a retried or re-synced sale is never recorded twice
--  * sales made without internet keep their real time and the price the customer was charged;
--    they are marked offline, and flagged when the price differs from the current list price

alter table sales add column if not exists client_id uuid;
alter table sales add column if not exists offline boolean not null default false;
alter table sales add column if not exists price_diff boolean not null default false;
alter table sale_items add column if not exists list_price numeric;
create unique index if not exists sales_client_id_uq on sales(business_id, client_id) where client_id is not null;

drop function if exists create_sale(uuid, jsonb, text, numeric, numeric, text);

create or replace function create_sale(
  p_branch uuid, p_items jsonb, p_payment text, p_paid numeric,
  p_discount numeric default 0, p_note text default '',
  p_client_id uuid default null, p_at timestamptz default null
) returns uuid language plpgsql security definer set search_path = public as $$
declare bid uuid := my_business(); r text := my_role(); sid uuid; rno bigint; it jsonb; pr record;
  sub numeric := 0; tx numeric; rate numeric; q numeric; pc numeric; disc numeric := coalesce(p_discount, 0);
  off boolean := p_at is not null; made timestamptz := now(); diff boolean := false;
begin
  if bid is null then raise exception 'No business'; end if;
  -- already saved (a retry, or a sale that reached the server before the connection dropped)
  if p_client_id is not null then
    select id into sid from sales where business_id = bid and client_id = p_client_id;
    if found then return sid; end if;
  end if;
  if not exists (select 1 from branches where id = p_branch and business_id = bid) then raise exception 'Bad branch'; end if;
  if r = 'cashier' and p_branch <> my_branch() then raise exception 'Not your branch'; end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then raise exception 'Empty cart'; end if;
  if jsonb_array_length(p_items) > 200 then raise exception 'Too many items'; end if;
  if disc < 0 then raise exception 'Bad discount'; end if;
  if coalesce(p_paid, 0) < 0 then raise exception 'Bad payment'; end if;
  if off then
    -- offline sales keep their own time, but never from the future or from long ago
    if p_at > now() + interval '10 minutes' or p_at < now() - interval '45 days' then raise exception 'Bad sale time'; end if;
    made := least(p_at, now());
  end if;
  perform pg_advisory_xact_lock(hashtext(bid::text));
  if p_client_id is not null then
    select id into sid from sales where business_id = bid and client_id = p_client_id;
    if found then return sid; end if;
  end if;
  select coalesce(max(receipt_no),0)+1 into rno from sales where business_id = bid;
  select tax_rate into rate from businesses where id = bid;
  insert into sales(business_id, branch_id, cashier_id, receipt_no, payment_method, amount_paid, discount, note, created_at, client_id, offline)
    values (bid, p_branch, auth.uid(), rno, left(p_payment, 40), coalesce(p_paid, 0), disc, left(coalesce(p_note,''), 500), made, p_client_id, off)
    returning id into sid;
  for it in select * from jsonb_array_elements(p_items) loop
    select * into pr from products where id = (it->>'product_id')::uuid and business_id = bid and active;
    if not found then raise exception 'Unknown product'; end if;
    q := round((it->>'qty')::numeric, 3);
    if q <= 0 or q > 100000 then raise exception 'Bad quantity'; end if;
    pc := pr.price;
    if off and it ? 'price' then
      pc := round((it->>'price')::numeric, 2);   -- the price the customer was actually charged
      if pc < 0 or pc > 10000000 then raise exception 'Bad price'; end if;
      if pc <> pr.price then diff := true; end if;
    end if;
    insert into sale_items(sale_id, product_id, name, qty, price, cost, unit, list_price)
      values (sid, pr.id, pr.name, q, pc, pr.cost, pr.unit, pr.price);
    sub := sub + q * pc;
    if pr.track_stock then
      -- stock may go below zero when the shop sold while offline; the owner sees it in Stock
      insert into stock(product_id, branch_id, business_id, qty) values (pr.id, p_branch, bid, -q)
        on conflict (product_id, branch_id) do update set qty = stock.qty - q;
      insert into stock_movements(business_id, branch_id, product_id, change, reason, user_id)
        values (bid, p_branch, pr.id, -q, 'Sale #' || rno || case when off then ' (offline)' else '' end, auth.uid());
    end if;
  end loop;
  if disc > sub then raise exception 'Discount is larger than the sale'; end if;
  tx := round((sub - disc) * coalesce(rate,0) / 100, 2);
  update sales set subtotal = sub, tax = tx, total = sub - disc + tx, price_diff = diff where id = sid;
  return sid;
end $$;
revoke execute on function create_sale(uuid, jsonb, text, numeric, numeric, text, uuid, timestamptz) from public, anon;
grant execute on function create_sale(uuid, jsonb, text, numeric, numeric, text, uuid, timestamptz) to authenticated;

-- ================== security-patch-5.sql ==================

-- Patch 5: credit sales (deni).
-- Run after security-patch-4.sql. Safe to run twice.
--  * the owner switches credit on in Settings and sets how much one customer may owe
--  * at the till, Credit is a payment method: the sale is saved and stock drops as usual,
--    but it stays unpaid and is tied to a customer
--  * customers pay in parts; each payment is recorded against their account

alter table businesses add column if not exists credit_enabled boolean not null default false;
alter table businesses add column if not exists credit_limit numeric not null default 5000;

create table if not exists customers (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  name text not null,
  phone text default '',
  credit_limit numeric,                       -- null = use the business default
  note text default '',
  active boolean not null default true,
  created_at timestamptz default now()
);
create index if not exists customers_biz on customers(business_id, name);
create unique index if not exists customers_phone_uq on customers(business_id, phone) where phone <> '';

alter table sales add column if not exists customer_id uuid references customers(id) on delete set null;
create index if not exists sales_customer on sales(customer_id) where customer_id is not null;

create table if not exists credit_payments (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  customer_id uuid not null references customers(id) on delete cascade,
  branch_id uuid references branches(id) on delete set null,
  amount numeric not null check (amount > 0),
  method text default 'Cash',
  note text default '',
  user_id uuid,
  created_at timestamptz default now()
);
create index if not exists credit_pay_cust on credit_payments(customer_id, created_at desc);

-- what a customer still owes: unpaid part of their credit sales, less what they have paid in
create or replace function customer_balance(p_customer uuid) returns numeric
language sql stable security definer set search_path = public as $$
  select greatest(0, coalesce((select sum(s.total - s.amount_paid) from sales s
                                where s.customer_id = p_customer and s.payment_method = 'Credit'), 0)
                   - coalesce((select sum(p.amount) from credit_payments p where p.customer_id = p_customer), 0)) $$;
revoke execute on function customer_balance(uuid) from public, anon;
grant execute on function customer_balance(uuid) to authenticated;

create or replace view customer_debts as
  select c.id, c.business_id, c.name, c.phone, c.note, c.active, c.created_at,
         coalesce(c.credit_limit, b.credit_limit) as credit_limit,
         customer_balance(c.id) as balance,
         (select max(s.created_at) from sales s where s.customer_id = c.id) as last_sale
  from customers c join businesses b on b.id = c.business_id;

alter table customers enable row level security;
alter table credit_payments enable row level security;

drop policy if exists cust_select on customers;
create policy cust_select on customers for select using (business_id = (select my_business()));
drop policy if exists cust_insert on customers;
create policy cust_insert on customers for insert with check (business_id = (select my_business()));
drop policy if exists cust_update on customers;
create policy cust_update on customers for update using ((select my_role()) in ('owner','manager') and business_id = (select my_business()))
  with check ((select my_role()) in ('owner','manager') and business_id = (select my_business()));
drop policy if exists cust_delete on customers;
create policy cust_delete on customers for delete using ((select my_role()) = 'owner' and business_id = (select my_business()));

drop policy if exists cpay_select on credit_payments;
create policy cpay_select on credit_payments for select using (business_id = (select my_business()));
drop policy if exists cpay_insert on credit_payments;
create policy cpay_insert on credit_payments for insert with check (business_id = (select my_business()) and user_id = auth.uid());
drop policy if exists cpay_delete on credit_payments;
create policy cpay_delete on credit_payments for delete using ((select my_role()) = 'owner' and business_id = (select my_business()));

grant select on customer_debts to authenticated;
alter view customer_debts set (security_invoker = on);

-- create_sale: Credit needs a customer, and stays within that customer's limit
drop function if exists create_sale(uuid, jsonb, text, numeric, numeric, text, uuid, timestamptz);

create or replace function create_sale(
  p_branch uuid, p_items jsonb, p_payment text, p_paid numeric,
  p_discount numeric default 0, p_note text default '',
  p_client_id uuid default null, p_at timestamptz default null,
  p_customer uuid default null
) returns uuid language plpgsql security definer set search_path = public as $$
declare bid uuid := my_business(); r text := my_role(); sid uuid; rno bigint; it jsonb; pr record;
  sub numeric := 0; tx numeric; rate numeric; q numeric; pc numeric; disc numeric := coalesce(p_discount, 0);
  off boolean := p_at is not null; made timestamptz := now(); diff boolean := false;
  cred boolean := lower(coalesce(p_payment, '')) = 'credit'; lim numeric; owed numeric; tot numeric;
begin
  if bid is null then raise exception 'No business'; end if;
  if p_client_id is not null then
    select id into sid from sales where business_id = bid and client_id = p_client_id;
    if found then return sid; end if;
  end if;
  if not exists (select 1 from branches where id = p_branch and business_id = bid) then raise exception 'Bad branch'; end if;
  if r = 'cashier' and p_branch <> my_branch() then raise exception 'Not your branch'; end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then raise exception 'Empty cart'; end if;
  if jsonb_array_length(p_items) > 200 then raise exception 'Too many items'; end if;
  if disc < 0 then raise exception 'Bad discount'; end if;
  if coalesce(p_paid, 0) < 0 then raise exception 'Bad payment'; end if;
  if cred then
    if not (select credit_enabled from businesses where id = bid) then raise exception 'Credit sales are switched off'; end if;
    if p_customer is null then raise exception 'Choose the customer for a credit sale'; end if;
    if not exists (select 1 from customers where id = p_customer and business_id = bid and active) then raise exception 'Unknown customer'; end if;
    if off then raise exception 'Credit sales need a connection'; end if;
  elsif p_customer is not null and not exists (select 1 from customers where id = p_customer and business_id = bid) then
    raise exception 'Unknown customer';
  end if;
  if off then
    if p_at > now() + interval '10 minutes' or p_at < now() - interval '45 days' then raise exception 'Bad sale time'; end if;
    made := least(p_at, now());
  end if;
  perform pg_advisory_xact_lock(hashtext(bid::text));
  if p_client_id is not null then
    select id into sid from sales where business_id = bid and client_id = p_client_id;
    if found then return sid; end if;
  end if;
  select coalesce(max(receipt_no),0)+1 into rno from sales where business_id = bid;
  select tax_rate into rate from businesses where id = bid;
  insert into sales(business_id, branch_id, cashier_id, receipt_no, payment_method, amount_paid, discount, note, created_at, client_id, offline, customer_id)
    values (bid, p_branch, auth.uid(), rno, left(p_payment, 40), coalesce(p_paid, 0), disc, left(coalesce(p_note,''), 500), made, p_client_id, off, p_customer)
    returning id into sid;
  for it in select * from jsonb_array_elements(p_items) loop
    select * into pr from products where id = (it->>'product_id')::uuid and business_id = bid and active;
    if not found then raise exception 'Unknown product'; end if;
    q := round((it->>'qty')::numeric, 3);
    if q <= 0 or q > 100000 then raise exception 'Bad quantity'; end if;
    pc := pr.price;
    if off and it ? 'price' then
      pc := round((it->>'price')::numeric, 2);
      if pc < 0 or pc > 10000000 then raise exception 'Bad price'; end if;
      if pc <> pr.price then diff := true; end if;
    end if;
    insert into sale_items(sale_id, product_id, name, qty, price, cost, unit, list_price)
      values (sid, pr.id, pr.name, q, pc, pr.cost, pr.unit, pr.price);
    sub := sub + q * pc;
    if pr.track_stock then
      insert into stock(product_id, branch_id, business_id, qty) values (pr.id, p_branch, bid, -q)
        on conflict (product_id, branch_id) do update set qty = stock.qty - q;
      insert into stock_movements(business_id, branch_id, product_id, change, reason, user_id)
        values (bid, p_branch, pr.id, -q, 'Sale #' || rno || case when off then ' (offline)' else '' end, auth.uid());
    end if;
  end loop;
  if disc > sub then raise exception 'Discount is larger than the sale'; end if;
  tx := round((sub - disc) * coalesce(rate,0) / 100, 2);
  tot := sub - disc + tx;
  update sales set subtotal = sub, tax = tx, total = tot, price_diff = diff where id = sid;
  if cred then
    if coalesce(p_paid, 0) > tot then raise exception 'The deposit is more than the sale'; end if;
    select coalesce(c.credit_limit, b.credit_limit) into lim
      from customers c join businesses b on b.id = c.business_id where c.id = p_customer;
    owed := customer_balance(p_customer);        -- this sale is counted in already
    if lim > 0 and owed > lim then
      raise exception 'This would take % past their credit limit of %. They owe % already.',
        (select name from customers where id = p_customer), to_char(lim, 'FM999999990.00'),
        to_char(owed - (tot - coalesce(p_paid, 0)), 'FM999999990.00');
    end if;
  end if;
  return sid;
end $$;
revoke execute on function create_sale(uuid, jsonb, text, numeric, numeric, text, uuid, timestamptz, uuid) from public, anon;
grant execute on function create_sale(uuid, jsonb, text, numeric, numeric, text, uuid, timestamptz, uuid) to authenticated;

-- ================== security-patch-6.sql ==================

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

-- ================== security-patch-7.sql ==================

-- Patch 7: phone alerts for the business owner.
-- Run after security-patch-6.sql. Safe to run twice.
--  * the owner chooses: nothing, every sale a cashier makes, or one summary at the end of the day
--  * each phone that agrees to alerts is stored once, by its own endpoint

alter table businesses add column if not exists notify_mode text not null default 'off';
alter table businesses drop constraint if exists businesses_notify_mode_chk;
alter table businesses add constraint businesses_notify_mode_chk check (notify_mode in ('off','sale','daily'));
alter table businesses add column if not exists notify_hour int not null default 20;
alter table businesses drop constraint if exists businesses_notify_hour_chk;
alter table businesses add constraint businesses_notify_hour_chk check (notify_hour between 0 and 23);
alter table businesses add column if not exists notify_min numeric not null default 0;   -- only sales at or above this

create table if not exists push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  business_id uuid references businesses(id) on delete cascade,
  endpoint text not null,
  p256dh text not null,
  auth text not null,
  label text default '',
  created_at timestamptz default now(),
  last_sent timestamptz
);
create unique index if not exists push_endpoint_uq on push_subscriptions(endpoint);
create index if not exists push_biz on push_subscriptions(business_id);

alter table push_subscriptions enable row level security;
drop policy if exists push_own on push_subscriptions;
create policy push_own on push_subscriptions for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- What one business owes the owner at the end of the day, read by the server when it sends the summary.
drop function if exists day_summary(uuid, timestamptz, timestamptz);
create or replace function day_summary(p_business uuid, p_from timestamptz, p_to timestamptz)
returns table(sales bigint, total numeric, cash numeric, other numeric) language sql stable security definer set search_path = public as $$
  select count(*), coalesce(sum(s.total), 0),
         coalesce(sum(s.total) filter (where lower(s.payment_method) = 'cash'), 0),
         coalesce(sum(s.total) filter (where lower(s.payment_method) <> 'cash'), 0)
  from sales s where s.business_id = p_business and s.created_at >= p_from and s.created_at < p_to $$;
revoke execute on function day_summary(uuid, timestamptz, timestamptz) from public, anon, authenticated;

-- ================== security-patch-8.sql ==================

-- Patch 8: the proprietor's phone number when a sales agent signs a business up.
-- Run after security-patch-7.sql. Safe to run twice.

alter table businesses add column if not exists owner_phone text default '';

drop function if exists create_business_as_agent(uuid, text, text, text, text, text, text, jsonb);

create or replace function create_business_as_agent(
  p_owner uuid, p_name text, p_type text, p_owner_name text, p_owner_email text,
  p_branch text default 'Main Branch', p_item_label text default 'Product', p_custom_fields jsonb default '[]'::jsonb,
  p_owner_phone text default ''
) returns uuid language plpgsql security definer set search_path = public as $$
declare bid uuid; brid uuid;
begin
  if my_role() <> 'sales' then raise exception 'Not allowed'; end if;
  if coalesce(btrim(p_name), '') = '' then raise exception 'Enter the business name'; end if;
  if coalesce(btrim(p_owner_name), '') = '' then raise exception 'Enter the name of the proprietor'; end if;
  if exists (select 1 from profiles where id = p_owner) then raise exception 'That person already has an account'; end if;
  insert into businesses(name, business_type, item_label, custom_fields, status, agent_id, owner_email, owner_phone, invited_at)
    values (left(btrim(p_name), 120), coalesce(p_type, 'retail'), coalesce(nullif(btrim(p_item_label), ''), 'Product'),
            coalesce(p_custom_fields, '[]'::jsonb), 'pending', auth.uid(), lower(btrim(p_owner_email)),
            left(btrim(coalesce(p_owner_phone, '')), 20), now())
    returning id into bid;
  insert into branches(business_id, name) values (bid, left(coalesce(nullif(btrim(p_branch), ''), 'Main Branch'), 80))
    returning id into brid;
  insert into profiles(id, business_id, branch_id, full_name, email, role)
    values (p_owner, bid, brid, left(btrim(p_owner_name), 120), lower(btrim(p_owner_email)), 'owner');
  return bid;
end $$;
revoke execute on function create_business_as_agent(uuid, text, text, text, text, text, text, jsonb, text) from public, anon;
grant execute on function create_business_as_agent(uuid, text, text, text, text, text, text, jsonb, text) to authenticated;

-- the agent's list shows the phone number too, so they can follow the shop up
drop function if exists agent_businesses();
create or replace function agent_businesses()
returns table(id uuid, name text, business_type text, status text, owner_email text, owner_name text, owner_phone text,
              invited_at timestamptz, created_at timestamptz, joined boolean)
language plpgsql security definer set search_path = public, auth as $$
begin
  if my_role() <> 'sales' then raise exception 'Not allowed'; end if;
  return query
  select b.id, b.name, b.business_type, b.status, b.owner_email,
    (select p.full_name from profiles p where p.business_id = b.id and p.role = 'owner' limit 1),
    b.owner_phone, b.invited_at, b.created_at,
    exists (select 1 from auth.users u join profiles p on p.id = u.id
            where p.business_id = b.id and p.role = 'owner' and u.last_sign_in_at is not null)
  from businesses b where b.agent_id = auth.uid() order by b.created_at desc;
end $$;
revoke execute on function agent_businesses() from public, anon;
grant execute on function agent_businesses() to authenticated;

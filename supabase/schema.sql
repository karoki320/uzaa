-- UZAA POS : run this whole file once in Supabase SQL Editor
create extension if not exists pgcrypto;

create table if not exists businesses (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  business_type text default 'retail',
  currency text default 'KES',
  tax_rate numeric default 0,
  receipt_header text default '',
  receipt_footer text default 'Thank you for shopping with us',
  item_label text default 'Product',
  custom_fields jsonb default '[]'::jsonb,
  payment_methods jsonb default '["Cash","M-Pesa","Card"]'::jsonb,
  status text default 'active',
  created_at timestamptz default now()
);

create table if not exists branches (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  name text not null,
  address text default '',
  phone text default '',
  created_at timestamptz default now()
);

create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  business_id uuid references businesses(id) on delete cascade,
  branch_id uuid references branches(id) on delete set null,
  full_name text default '',
  email text default '',
  role text not null default 'cashier' check (role in ('super_admin','owner','manager','cashier')),
  active boolean default true,
  created_at timestamptz default now()
);

create table if not exists products (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  name text not null,
  barcode text,
  category text default '',
  price numeric not null default 0,
  cost numeric not null default 0,
  track_stock boolean default true,
  low_stock_level numeric default 5,
  custom jsonb default '{}'::jsonb,
  active boolean default true,
  created_at timestamptz default now()
);
create unique index if not exists products_barcode_uq on products(business_id, barcode) where barcode is not null and barcode <> '';

create table if not exists stock (
  product_id uuid not null references products(id) on delete cascade,
  branch_id uuid not null references branches(id) on delete cascade,
  business_id uuid not null references businesses(id) on delete cascade,
  qty numeric not null default 0,
  primary key (product_id, branch_id)
);

create table if not exists stock_movements (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  branch_id uuid not null references branches(id) on delete cascade,
  product_id uuid not null references products(id) on delete cascade,
  change numeric not null,
  reason text,
  user_id uuid,
  created_at timestamptz default now()
);

create table if not exists sales (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  branch_id uuid not null references branches(id) on delete cascade,
  cashier_id uuid references profiles(id) on delete set null,
  receipt_no bigint not null,
  subtotal numeric not null default 0,
  discount numeric not null default 0,
  tax numeric not null default 0,
  total numeric not null default 0,
  payment_method text,
  amount_paid numeric default 0,
  note text default '',
  created_at timestamptz default now()
);
create index if not exists sales_biz_date on sales(business_id, created_at desc);

create table if not exists sale_items (
  id uuid primary key default gen_random_uuid(),
  sale_id uuid not null references sales(id) on delete cascade,
  product_id uuid references products(id) on delete set null,
  name text not null,
  qty numeric not null,
  price numeric not null,
  cost numeric not null default 0
);
create index if not exists sale_items_sale on sale_items(sale_id);

-- helpers ---------------------------------------------------------------
create or replace function my_business() returns uuid language sql stable security definer set search_path = public as $$
  select business_id from profiles where id = auth.uid() $$;
create or replace function my_role() returns text language sql stable security definer set search_path = public as $$
  select role from profiles where id = auth.uid() $$;
create or replace function my_branch() returns uuid language sql stable security definer set search_path = public as $$
  select branch_id from profiles where id = auth.uid() $$;

-- RLS -------------------------------------------------------------------
alter table businesses enable row level security;
alter table branches enable row level security;
alter table profiles enable row level security;
alter table products enable row level security;
alter table stock enable row level security;
alter table stock_movements enable row level security;
alter table sales enable row level security;
alter table sale_items enable row level security;

drop policy if exists biz_select on businesses;
create policy biz_select on businesses for select using (my_role() = 'super_admin' or id = my_business());
drop policy if exists biz_update on businesses;
create policy biz_update on businesses for update using (my_role() = 'super_admin' or (id = my_business() and my_role() = 'owner'));

drop policy if exists br_select on branches;
create policy br_select on branches for select using (my_role() = 'super_admin' or business_id = my_business());
drop policy if exists br_write on branches;
create policy br_write on branches for all using (my_role() = 'owner' and business_id = my_business()) with check (my_role() = 'owner' and business_id = my_business());

drop policy if exists pr_select on profiles;
create policy pr_select on profiles for select using (
  id = auth.uid() or my_role() = 'super_admin' or (business_id = my_business() and my_role() in ('owner','manager')));

drop policy if exists prod_select on products;
create policy prod_select on products for select using (my_role() = 'super_admin' or business_id = my_business());
drop policy if exists prod_write on products;
create policy prod_write on products for all using (my_role() in ('owner','manager') and business_id = my_business())
  with check (my_role() in ('owner','manager') and business_id = my_business());

drop policy if exists stock_select on stock;
create policy stock_select on stock for select using (
  my_role() = 'super_admin' or (business_id = my_business() and (my_role() in ('owner','manager') or branch_id = my_branch())));

drop policy if exists mov_select on stock_movements;
create policy mov_select on stock_movements for select using (
  my_role() = 'super_admin' or (business_id = my_business() and my_role() in ('owner','manager')));

drop policy if exists sales_select on sales;
create policy sales_select on sales for select using (
  my_role() = 'super_admin' or (business_id = my_business() and (my_role() in ('owner','manager') or cashier_id = auth.uid())));

drop policy if exists si_select on sale_items;
create policy si_select on sale_items for select using (exists (select 1 from sales s where s.id = sale_id));

-- RPCs ------------------------------------------------------------------
create or replace function register_business(p_name text, p_type text, p_full_name text, p_item_label text default 'Product', p_custom_fields jsonb default '[]'::jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare bid uuid; brid uuid; uemail text;
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  if exists (select 1 from profiles where id = auth.uid()) then raise exception 'Account already set up'; end if;
  select email into uemail from auth.users where id = auth.uid();
  insert into businesses(name, business_type, item_label, custom_fields) values (p_name, p_type, coalesce(p_item_label,'Product'), coalesce(p_custom_fields,'[]'::jsonb)) returning id into bid;
  insert into branches(business_id, name) values (bid, 'Main Branch') returning id into brid;
  insert into profiles(id, business_id, branch_id, full_name, email, role) values (auth.uid(), bid, brid, p_full_name, uemail, 'owner');
  return bid;
end $$;

create or replace function create_sale(p_branch uuid, p_items jsonb, p_payment text, p_paid numeric, p_discount numeric default 0, p_note text default '')
returns uuid language plpgsql security definer set search_path = public as $$
declare bid uuid := my_business(); r text := my_role(); sid uuid; rno bigint; it jsonb; pr record;
  sub numeric := 0; tx numeric; rate numeric; q numeric;
begin
  if bid is null then raise exception 'No business'; end if;
  if not exists (select 1 from profiles where id = auth.uid() and active) then raise exception 'Account disabled'; end if;
  if not exists (select 1 from branches where id = p_branch and business_id = bid) then raise exception 'Bad branch'; end if;
  if r = 'cashier' and p_branch <> my_branch() then raise exception 'Not your branch'; end if;
  if jsonb_array_length(p_items) = 0 then raise exception 'Empty cart'; end if;
  perform pg_advisory_xact_lock(hashtext(bid::text));
  select coalesce(max(receipt_no),0)+1 into rno from sales where business_id = bid;
  select tax_rate into rate from businesses where id = bid;
  insert into sales(business_id, branch_id, cashier_id, receipt_no, payment_method, amount_paid, discount, note)
    values (bid, p_branch, auth.uid(), rno, p_payment, p_paid, coalesce(p_discount,0), coalesce(p_note,'')) returning id into sid;
  for it in select * from jsonb_array_elements(p_items) loop
    select * into pr from products where id = (it->>'product_id')::uuid and business_id = bid;
    if not found then raise exception 'Unknown product'; end if;
    q := (it->>'qty')::numeric;
    if q <= 0 then raise exception 'Bad quantity'; end if;
    insert into sale_items(sale_id, product_id, name, qty, price, cost)
      values (sid, pr.id, pr.name, q, coalesce((it->>'price')::numeric, pr.price), pr.cost);
    sub := sub + q * coalesce((it->>'price')::numeric, pr.price);
    if pr.track_stock then
      insert into stock(product_id, branch_id, business_id, qty) values (pr.id, p_branch, bid, -q)
        on conflict (product_id, branch_id) do update set qty = stock.qty - q;
      insert into stock_movements(business_id, branch_id, product_id, change, reason, user_id)
        values (bid, p_branch, pr.id, -q, 'Sale #' || rno, auth.uid());
    end if;
  end loop;
  tx := round((sub - coalesce(p_discount,0)) * coalesce(rate,0) / 100, 2);
  update sales set subtotal = sub, tax = tx, total = sub - coalesce(p_discount,0) + tx where id = sid;
  return sid;
end $$;

create or replace function adjust_stock(p_product uuid, p_branch uuid, p_change numeric, p_reason text default 'Adjustment')
returns void language plpgsql security definer set search_path = public as $$
declare bid uuid := my_business();
begin
  if my_role() not in ('owner','manager') then raise exception 'Not allowed'; end if;
  if not exists (select 1 from products where id = p_product and business_id = bid) then raise exception 'Bad product'; end if;
  if not exists (select 1 from branches where id = p_branch and business_id = bid) then raise exception 'Bad branch'; end if;
  insert into stock(product_id, branch_id, business_id, qty) values (p_product, p_branch, bid, p_change)
    on conflict (product_id, branch_id) do update set qty = stock.qty + p_change;
  insert into stock_movements(business_id, branch_id, product_id, change, reason, user_id)
    values (bid, p_branch, p_product, p_change, p_reason, auth.uid());
end $$;

create or replace function weekly_report(p_from timestamptz, p_to timestamptz, p_branch uuid default null)
returns jsonb language sql stable security invoker as $$
  select jsonb_build_object(
    'totals', (select jsonb_build_object('revenue', coalesce(sum(total),0), 'count', count(*), 'tax', coalesce(sum(tax),0))
               from sales where created_at >= p_from and created_at < p_to and (p_branch is null or branch_id = p_branch)),
    'profit', (select coalesce(sum((si.price - si.cost) * si.qty),0) from sale_items si join sales s on s.id = si.sale_id
               where s.created_at >= p_from and s.created_at < p_to and (p_branch is null or s.branch_id = p_branch)),
    'by_day', (select coalesce(jsonb_agg(x order by x.day), '[]'::jsonb) from (
               select (created_at at time zone 'Africa/Nairobi')::date as day, sum(total) as revenue, count(*) as count
               from sales where created_at >= p_from and created_at < p_to and (p_branch is null or branch_id = p_branch) group by 1) x),
    'by_branch', (select coalesce(jsonb_agg(x order by x.revenue desc), '[]'::jsonb) from (
               select b.name, sum(s.total) as revenue, count(*) as count from sales s join branches b on b.id = s.branch_id
               where s.created_at >= p_from and s.created_at < p_to and (p_branch is null or s.branch_id = p_branch) group by b.name) x),
    'by_payment', (select coalesce(jsonb_agg(x order by x.revenue desc), '[]'::jsonb) from (
               select coalesce(payment_method,'Other') as name, sum(total) as revenue, count(*) as count from sales
               where created_at >= p_from and created_at < p_to and (p_branch is null or branch_id = p_branch) group by 1) x),
    'top_products', (select coalesce(jsonb_agg(x order by x.revenue desc), '[]'::jsonb) from (
               select si.name, sum(si.qty) as qty, sum(si.qty * si.price) as revenue from sale_items si join sales s on s.id = si.sale_id
               where s.created_at >= p_from and s.created_at < p_to and (p_branch is null or s.branch_id = p_branch)
               group by si.name order by sum(si.qty * si.price) desc limit 10) x),
    'by_cashier', (select coalesce(jsonb_agg(x order by x.revenue desc), '[]'::jsonb) from (
               select coalesce(p.full_name,'Unknown') as name, sum(s.total) as revenue, count(*) as count from sales s left join profiles p on p.id = s.cashier_id
               where s.created_at >= p_from and s.created_at < p_to and (p_branch is null or s.branch_id = p_branch) group by 1) x)
  ) $$;

create or replace function admin_overview()
returns table(id uuid, name text, business_type text, status text, created_at timestamptz, branches bigint, staff bigint, sales_count bigint, revenue_7d numeric, last_sale timestamptz, owner_email text)
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
    (select p.email from profiles p where p.business_id = b.id and p.role = 'owner' limit 1)
  from businesses b order by b.created_at desc;
end $$;

-- To make yourself super admin, after signing up once:
-- insert into profiles(id, full_name, email, role) select id, 'Eugene', email, 'super_admin' from auth.users where email = 'YOUR_EMAIL' on conflict (id) do update set role = 'super_admin';

-- ===== SECURITY PATCH (same as security-patch.sql) =====
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

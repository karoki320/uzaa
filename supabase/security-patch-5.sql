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

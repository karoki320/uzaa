-- Patch 15: split payments (part cash, part M-Pesa, ...). Safe to run twice.
-- Run after security-patch-14.sql (or run apply-all.sql).
--  * a split sale has payment_method 'Split' and its parts in sales.payments: [{"method":"Cash","amount":300},{"method":"M-Pesa","amount":570}]
--  * the parts always add up to the sale total; amount_paid is what was handed over (so change = amount_paid - total, given in cash)
--  * reports, closing the day and the evening summary count each part under its own method

-- ===== included: patch 14 =====
-- (closing the day and the supplier; included so this file also works if patch 14 was skipped)
-- Patch 14: closing the day (cash count) and the supplier for reorders. Safe to run twice.
-- Run after security-patch-13.sql (or run apply-all.sql).

-- 1. Who to send the reorder list to
alter table businesses add column if not exists supplier_name text not null default '';
alter table businesses add column if not exists supplier_whatsapp text not null default '';
alter table businesses drop constraint if exists businesses_supplier_chk;
alter table businesses add constraint businesses_supplier_chk check (length(supplier_name) <= 80 and length(supplier_whatsapp) <= 20);

-- 2. Closing the day: the cashier counts the cash in the drawer, Uzaa works out what should be there.
--    One count per branch per day; counting again replaces it (the last count stands).
create table if not exists cash_counts (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  branch_id uuid not null references branches(id) on delete cascade,
  day date not null,
  cash_sales numeric not null default 0,
  cash_paid_in numeric not null default 0,      -- credit customers paying in cash
  cash_spent numeric not null default 0,        -- expenses paid from cash
  expected numeric not null default 0,
  counted numeric not null,
  diff numeric not null default 0,              -- counted - expected: below 0 is short
  note text not null default '',
  user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (business_id, branch_id, day)
);
create index if not exists cash_counts_biz_day on cash_counts(business_id, day desc);
alter table cash_counts enable row level security;
revoke all on cash_counts from anon;
revoke insert, update, delete on cash_counts from authenticated;   -- only close_day() writes
drop policy if exists cc_select on cash_counts;
create policy cc_select on cash_counts for select using (
  business_id = (select my_business())
  and ((select my_role()) in ('owner','manager') or branch_id = (select my_branch())));

-- Works out the expected cash on the server (the phone cannot be trusted with it) and saves the count.
create or replace function close_day(p_branch uuid, p_day date, p_counted numeric, p_note text default '')
returns cash_counts language plpgsql security definer set search_path = public as $$
declare bid uuid := my_business(); r text := my_role(); f timestamptz; t timestamptz;
  cs numeric; cp numeric; ce numeric := 0; rec cash_counts; today date := (now() at time zone 'Africa/Nairobi')::date;
begin
  if bid is null or r not in ('owner','manager','cashier') then raise exception 'Not allowed'; end if;
  if not exists (select 1 from branches where id = p_branch and business_id = bid) then raise exception 'Bad branch'; end if;
  if r = 'cashier' and p_branch is distinct from my_branch() then raise exception 'Not your branch'; end if;
  if p_day > today or p_day < today - 7 then raise exception 'You can close today or the last 7 days'; end if;
  if r = 'cashier' and p_day < today - 1 then raise exception 'Cashiers can close today or yesterday'; end if;
  if p_counted is null or p_counted < 0 or p_counted > 1000000000 then raise exception 'Enter the cash you counted'; end if;
  f := (p_day::timestamp) at time zone 'Africa/Nairobi';
  t := ((p_day + 1)::timestamp) at time zone 'Africa/Nairobi';
  select coalesce(sum(least(total, amount_paid)), 0) into cs from sales
    where business_id = bid and branch_id = p_branch and created_at >= f and created_at < t and lower(payment_method) = 'cash';
  -- a cash deposit taken with a credit sale is cash in the drawer too
  cs := cs + coalesce((select sum(amount_paid) from sales where business_id = bid and branch_id = p_branch
                         and created_at >= f and created_at < t and lower(payment_method) = 'credit'), 0);
  select coalesce(sum(amount), 0) into cp from credit_payments
    where business_id = bid and branch_id = p_branch and created_at >= f and created_at < t and lower(method) = 'cash';
  if to_regclass('public.expenses') is not null then
    execute 'select coalesce(sum(amount), 0) from expenses where business_id = $1 and branch_id = $2 and spent_on = $3 and lower(paid_from) = ''cash'''
      into ce using bid, p_branch, p_day;
  end if;
  insert into cash_counts(business_id, branch_id, day, cash_sales, cash_paid_in, cash_spent, expected, counted, diff, note, user_id)
    values (bid, p_branch, p_day, cs, cp, ce, cs + cp - ce, round(p_counted, 2), round(p_counted, 2) - (cs + cp - ce), left(coalesce(p_note, ''), 300), auth.uid())
    on conflict (business_id, branch_id, day) do update set
      cash_sales = excluded.cash_sales, cash_paid_in = excluded.cash_paid_in, cash_spent = excluded.cash_spent,
      expected = excluded.expected, counted = excluded.counted, diff = excluded.diff, note = excluded.note,
      user_id = excluded.user_id, created_at = now()
    returning * into rec;
  return rec;
end $$;
revoke execute on function close_day(uuid, date, numeric, text) from public, anon;
grant execute on function close_day(uuid, date, numeric, text) to authenticated;

-- ===== end of patch 14 =====

alter table sales add column if not exists payments jsonb;

-- what one way of paying covered in a sale (works for split and ordinary sales)
create or replace function sale_part(p_payments jsonb, p_payment text, p_total numeric, p_paid numeric, p_method text)
returns numeric language sql immutable as $$
  select case
    when jsonb_typeof(p_payments) = 'array' then
      coalesce((select sum((x->>'amount')::numeric) from jsonb_array_elements(p_payments) x where lower(btrim(x->>'method')) = lower(p_method)), 0)
    when lower(coalesce(p_payment, '')) = lower(p_method) then
      case when lower(p_method) = 'credit' then least(coalesce(p_paid, 0), p_total) else p_total end
    else 0 end $$;
grant execute on function sale_part(jsonb, text, numeric, numeric, text) to authenticated;

-- create_sale gains p_payments. The old 9-argument version is dropped so calls are never ambiguous.
drop function if exists create_sale(uuid, jsonb, text, numeric, numeric, text, uuid, timestamptz, uuid);
create or replace function create_sale(
  p_branch uuid, p_items jsonb, p_payment text, p_paid numeric,
  p_discount numeric default 0, p_note text default '',
  p_client_id uuid default null, p_at timestamptz default null,
  p_customer uuid default null,
  p_payments jsonb default null
) returns uuid language plpgsql security definer set search_path = public as $$
declare bid uuid := my_business(); r text := my_role(); sid uuid; rno bigint; it jsonb; pr record;
  sub numeric := 0; tx numeric; rate numeric; q numeric; pc numeric; disc numeric := coalesce(p_discount, 0);
  off boolean := p_at is not null; made timestamptz := now(); diff boolean := false;
  cred boolean := lower(coalesce(p_payment, '')) = 'credit'; lim numeric; owed numeric; tot numeric;
  split boolean := jsonb_typeof(p_payments) = 'array' and jsonb_array_length(p_payments) > 0;
  psum numeric; pcash numeric; pchg numeric; pn int; pays jsonb;
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
  if split then
    if cred then raise exception 'A credit sale cannot be split'; end if;
    pn := jsonb_array_length(p_payments);
    if pn < 2 or pn > 4 then raise exception 'Split the payment into 2 to 4 parts'; end if;
    if exists (select 1 from jsonb_array_elements(p_payments) x
               where jsonb_typeof(x) <> 'object' or btrim(coalesce(x->>'method', '')) = '' or length(x->>'method') > 40
                  or lower(x->>'method') = 'credit' or (x->>'amount') !~ '^[0-9]+(\.[0-9]+)?$'
                  or (x->>'amount')::numeric <= 0 or (x->>'amount')::numeric > 1000000000) then
      raise exception 'Bad split payment';
    end if;
    if (select count(distinct lower(btrim(x->>'method'))) from jsonb_array_elements(p_payments) x) <> pn then
      raise exception 'Each way of paying can appear once in a split';
    end if;
  end if;
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
  if split then
    select sum((x->>'amount')::numeric), coalesce(sum((x->>'amount')::numeric) filter (where lower(btrim(x->>'method')) = 'cash'), 0)
      into psum, pcash from jsonb_array_elements(p_payments) x;
    if psum < tot - 0.005 then
      raise exception 'The split adds up to % but the sale is %', to_char(psum, 'FM999999990.00'), to_char(tot, 'FM999999990.00');
    end if;
    pchg := greatest(0, psum - tot);                   -- change is only ever given in cash
    if pchg > 0.005 and pchg > pcash then raise exception 'Only the cash part can be more than the total (to give change)'; end if;
    -- keep what each method really covered: the cash part less the change, so the parts add up to the total
    select jsonb_agg(jsonb_build_object('method', left(btrim(x->>'method'), 40),
             'amount', round((x->>'amount')::numeric - case when lower(btrim(x->>'method')) = 'cash' then pchg else 0 end, 2)) order by i)
      into pays from jsonb_array_elements(p_payments) with ordinality as t(x, i);
    update sales set payments = pays, payment_method = 'Split', amount_paid = psum where id = sid;
  end if;
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
revoke execute on function create_sale(uuid, jsonb, text, numeric, numeric, text, uuid, timestamptz, uuid, jsonb) from public, anon;
grant execute on function create_sale(uuid, jsonb, text, numeric, numeric, text, uuid, timestamptz, uuid, jsonb) to authenticated;

drop function if exists create_sale_fast(uuid, jsonb, text, numeric, numeric, text, uuid, uuid);
create or replace function create_sale_fast(
  p_branch uuid, p_items jsonb, p_payment text, p_paid numeric,
  p_discount numeric default 0, p_note text default '',
  p_client_id uuid default null, p_customer uuid default null,
  p_payments jsonb default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare sid uuid; out jsonb;
begin
  sid := create_sale(p_branch, p_items, p_payment, p_paid, p_discount, p_note, p_client_id, null, p_customer, p_payments);
  select jsonb_build_object('id', s.id, 'receipt_no', s.receipt_no, 'total', s.total, 'amount_paid', s.amount_paid, 'payments', s.payments)
    into out from sales s where s.id = sid;
  return out;
end $$;
revoke execute on function create_sale_fast(uuid, jsonb, text, numeric, numeric, text, uuid, uuid, jsonb) from public, anon;
grant execute on function create_sale_fast(uuid, jsonb, text, numeric, numeric, text, uuid, uuid, jsonb) to authenticated;

-- Reports: "How customers paid" counts each part of a split under its own method
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
               select coalesce(btrim(p->>'method'), s.payment_method, 'Other') as name,
                      sum(coalesce((p->>'amount')::numeric, s.total)) as revenue, count(distinct s.id) as count
               from sales s
               left join lateral jsonb_array_elements(case when jsonb_typeof(s.payments) = 'array' then s.payments end) p on true
               where s.created_at >= p_from and s.created_at < p_to and (p_branch is null or s.branch_id = p_branch) group by 1) x),
    'top_products', (select coalesce(jsonb_agg(x order by x.revenue desc), '[]'::jsonb) from (
               select si.name, sum(si.qty) as qty, sum(si.qty * si.price) as revenue from sale_items si join sales s on s.id = si.sale_id
               where s.created_at >= p_from and s.created_at < p_to and (p_branch is null or s.branch_id = p_branch)
               group by si.name order by sum(si.qty * si.price) desc limit 10) x),
    'by_cashier', (select coalesce(jsonb_agg(x order by x.revenue desc), '[]'::jsonb) from (
               select coalesce(p.full_name,'Unknown') as name, sum(s.total) as revenue, count(*) as count from sales s left join profiles p on p.id = s.cashier_id
               where s.created_at >= p_from and s.created_at < p_to and (p_branch is null or s.branch_id = p_branch) group by 1) x)
  ) $$;
revoke execute on function weekly_report(timestamptz, timestamptz, uuid) from public, anon;
grant execute on function weekly_report(timestamptz, timestamptz, uuid) to authenticated;

-- The evening summary on the owner's phone: cash and the rest, with splits shared out
create or replace function day_summary(p_business uuid, p_from timestamptz, p_to timestamptz)
returns table(sales bigint, total numeric, cash numeric, other numeric) language sql stable security definer set search_path = public as $$
  select count(*), coalesce(sum(s.total), 0),
         coalesce(sum(sale_part(s.payments, s.payment_method, s.total, s.amount_paid, 'cash')), 0),
         coalesce(sum(s.total - sale_part(s.payments, s.payment_method, s.total, s.amount_paid, 'cash')), 0)
  from sales s where s.business_id = p_business and s.created_at >= p_from and s.created_at < p_to $$;
revoke execute on function day_summary(uuid, timestamptz, timestamptz) from public, anon, authenticated;

-- Closing the day counts the cash part of split sales
create or replace function close_day(p_branch uuid, p_day date, p_counted numeric, p_note text default '')
returns cash_counts language plpgsql security definer set search_path = public as $$
declare bid uuid := my_business(); r text := my_role(); f timestamptz; t timestamptz;
  cs numeric; cp numeric; ce numeric := 0; rec cash_counts; today date := (now() at time zone 'Africa/Nairobi')::date;
begin
  if bid is null or r not in ('owner','manager','cashier') then raise exception 'Not allowed'; end if;
  if not exists (select 1 from branches where id = p_branch and business_id = bid) then raise exception 'Bad branch'; end if;
  if r = 'cashier' and p_branch is distinct from my_branch() then raise exception 'Not your branch'; end if;
  if p_day > today or p_day < today - 7 then raise exception 'You can close today or the last 7 days'; end if;
  if r = 'cashier' and p_day < today - 1 then raise exception 'Cashiers can close today or yesterday'; end if;
  if p_counted is null or p_counted < 0 or p_counted > 1000000000 then raise exception 'Enter the cash you counted'; end if;
  f := (p_day::timestamp) at time zone 'Africa/Nairobi';
  t := ((p_day + 1)::timestamp) at time zone 'Africa/Nairobi';
  -- cash sales, the cash part of split sales, and cash deposits taken with credit sales
  select coalesce(sum(case
           when jsonb_typeof(payments) = 'array' then sale_part(payments, payment_method, total, amount_paid, 'cash')
           when lower(payment_method) = 'cash' then least(total, amount_paid)
           when lower(payment_method) = 'credit' then amount_paid
           else 0 end), 0) into cs from sales
    where business_id = bid and branch_id = p_branch and created_at >= f and created_at < t;
  select coalesce(sum(amount), 0) into cp from credit_payments
    where business_id = bid and branch_id = p_branch and created_at >= f and created_at < t and lower(method) = 'cash';
  if to_regclass('public.expenses') is not null then
    execute 'select coalesce(sum(amount), 0) from expenses where business_id = $1 and branch_id = $2 and spent_on = $3 and lower(paid_from) = ''cash'''
      into ce using bid, p_branch, p_day;
  end if;
  insert into cash_counts(business_id, branch_id, day, cash_sales, cash_paid_in, cash_spent, expected, counted, diff, note, user_id)
    values (bid, p_branch, p_day, cs, cp, ce, cs + cp - ce, round(p_counted, 2), round(p_counted, 2) - (cs + cp - ce), left(coalesce(p_note, ''), 300), auth.uid())
    on conflict (business_id, branch_id, day) do update set
      cash_sales = excluded.cash_sales, cash_paid_in = excluded.cash_paid_in, cash_spent = excluded.cash_spent,
      expected = excluded.expected, counted = excluded.counted, diff = excluded.diff, note = excluded.note,
      user_id = excluded.user_id, created_at = now()
    returning * into rec;
  return rec;
end $$;
revoke execute on function close_day(uuid, date, numeric, text) from public, anon;
grant execute on function close_day(uuid, date, numeric, text) to authenticated;

-- Patch 22: customers and loyalty points (first for Glow Collections). Safe to run twice.
-- Run after security-patch-21.sql (or run apply-all.sql).
--  * businesses.features.loyalty: the super admin switches the feature on for a business (Admin > Loyalty).
--  * the owner sets the rules under Settings > Loyalty points:
--      loyalty_spend_per_point  how much a customer spends to earn 1 point (e.g. 100 = 1 point per KES 100)
--      loyalty_point_value      what 1 point takes off a later sale (e.g. 1 = KES 1)
--      loyalty_min_redeem       points a customer must have before they can use them
--  * a sale tied to a customer earns floor(total / spend_per_point) points. Credit sales earn nothing.
--  * p_redeem on create_sale: points used as a discount, checked against the balance in the same
--    transaction as the sale. Needs a connection.
--  * loyalty_points is the ledger (earned +, used -, adjusted by the owner or a manager). Deleting a sale
--    deletes its rows, so the points it earned and used are reversed.
--  * customer_list: every customer with points, money spent, visits, last visit and what they owe.

-- 1. Rules
alter table businesses add column if not exists loyalty_enabled boolean not null default false;
alter table businesses add column if not exists loyalty_spend_per_point numeric not null default 100;
alter table businesses add column if not exists loyalty_point_value numeric not null default 1;
alter table businesses add column if not exists loyalty_min_redeem numeric not null default 100;
alter table businesses drop constraint if exists businesses_loyalty_chk;
alter table businesses add constraint businesses_loyalty_chk check (
  loyalty_spend_per_point >= 1 and loyalty_spend_per_point <= 10000000
  and loyalty_point_value >= 0 and loyalty_point_value <= 1000000
  and loyalty_min_redeem >= 0 and loyalty_min_redeem <= 10000000);

-- 2. What each sale earned and used
alter table sales add column if not exists points_earned numeric not null default 0;
alter table sales add column if not exists points_used numeric not null default 0;
alter table sales add column if not exists points_value numeric not null default 0;

-- 3. The points ledger. Written only by create_sale and loyalty_adjust.
create table if not exists loyalty_points (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  customer_id uuid not null references customers(id) on delete cascade,
  sale_id uuid references sales(id) on delete cascade,
  points numeric not null check (points <> 0 and points = trunc(points)),
  reason text not null default '',
  user_id uuid,
  created_at timestamptz default now()
);
create index if not exists loyalty_cust on loyalty_points(customer_id, created_at desc);
create index if not exists loyalty_sale on loyalty_points(sale_id) where sale_id is not null;
alter table loyalty_points enable row level security;
drop policy if exists loy_select on loyalty_points;
create policy loy_select on loyalty_points for select using (business_id = (select my_business()));
revoke insert, update, delete on loyalty_points from anon, authenticated;

alter table customers add column if not exists note text default '';

-- 4. Customers with their points, spending and debt
create or replace view customer_list as
  select c.id, c.business_id, c.name, c.phone, c.note, c.active, c.created_at,
         coalesce(c.credit_limit, b.credit_limit) as credit_limit,
         customer_balance(c.id) as balance,
         coalesce(lp.points, 0) as points,
         coalesce(st.spent, 0) as spent, coalesce(st.visits, 0) as visits, st.last_sale
  from customers c join businesses b on b.id = c.business_id
  left join lateral (select sum(l.points) as points from loyalty_points l where l.customer_id = c.id) lp on true
  left join lateral (select sum(s.total) as spent, count(*) as visits, max(s.created_at) as last_sale
                     from sales s where s.customer_id = c.id) st on true;
alter view customer_list set (security_invoker = on);
revoke all on customer_list from anon;
grant select on customer_list to authenticated;

-- 5. Owner or manager adds or takes off points by hand (welcome bonus, correction), with a reason
create or replace function loyalty_adjust(p_customer uuid, p_points numeric, p_reason text)
returns numeric language plpgsql security definer set search_path = public as $$
declare bid uuid := my_business(); why text := btrim(coalesce(p_reason, '')); have numeric;
begin
  if bid is null or coalesce(my_role(), '') not in ('owner', 'manager') then raise exception 'Only the owner or a manager can change points'; end if;
  if not coalesce((select (features->>'loyalty')::boolean from businesses where id = bid), false) then raise exception 'Loyalty points are not available for this business'; end if;
  if p_points is null or p_points = 0 or p_points <> trunc(p_points) or abs(p_points) > 1000000 then raise exception 'Enter a whole number of points'; end if;
  if length(why) < 3 then raise exception 'Write why the points are being changed'; end if;
  if not exists (select 1 from customers where id = p_customer and business_id = bid) then raise exception 'Unknown customer'; end if;
  perform pg_advisory_xact_lock(hashtext(bid::text));
  select coalesce(sum(points), 0) into have from loyalty_points where customer_id = p_customer;
  if have + p_points < 0 then raise exception 'They have only % points', to_char(have, 'FM999999990'); end if;
  insert into loyalty_points(business_id, customer_id, points, reason, user_id)
    values (bid, p_customer, p_points, left('Adjusted: ' || why, 200), auth.uid());
  return have + p_points;
end $$;
revoke execute on function loyalty_adjust(uuid, numeric, text) from public, anon;
grant execute on function loyalty_adjust(uuid, numeric, text) to authenticated;

-- 6. create_sale: p_redeem (points to use), and points earned on a customer's sale
drop function if exists create_sale(uuid, jsonb, text, numeric, numeric, text, uuid, timestamptz, uuid, jsonb);
create or replace function create_sale(
  p_branch uuid, p_items jsonb, p_payment text, p_paid numeric,
  p_discount numeric default 0, p_note text default '',
  p_client_id uuid default null, p_at timestamptz default null,
  p_customer uuid default null,
  p_payments jsonb default null,
  p_redeem numeric default 0
) returns uuid language plpgsql security definer set search_path = public as $$
declare bid uuid := my_business(); r text := my_role(); sid uuid; rno bigint; it jsonb; pr record;
  sub numeric := 0; tx numeric; rate numeric; q numeric; pc numeric; disc numeric := coalesce(p_discount, 0);
  off boolean := p_at is not null; made timestamptz := now(); diff boolean := false;
  cred boolean := lower(coalesce(p_payment, '')) = 'credit'; lim numeric; owed numeric; tot numeric;
  split boolean := jsonb_typeof(p_payments) = 'array' and jsonb_array_length(p_payments) > 0;
  psum numeric; pcash numeric; pchg numeric; pn int; pays jsonb; lp numeric; sp_id uuid; sp_track boolean;
  sp_allow boolean; sp_name text; sp_unit text; nq numeric; fr boolean;
  loy boolean := false; l_per numeric; l_val numeric; l_min numeric; l_have numeric; red numeric := coalesce(p_redeem, 0);
  pv numeric := 0; earn numeric := 0;
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
  -- loyalty points (patch 22): on when the super admin gave the business the feature and the owner switched it on
  select coalesce((features->>'loyalty')::boolean, false) and coalesce(loyalty_enabled, false),
         loyalty_spend_per_point, loyalty_point_value, loyalty_min_redeem
    into loy, l_per, l_val, l_min from businesses where id = bid;
  if red <> 0 then
    if not loy then raise exception 'Loyalty points are switched off'; end if;
    if p_customer is null then raise exception 'Choose the customer to use their points'; end if;
    if off then raise exception 'Using points needs a connection'; end if;
    if red < 0 or red <> trunc(red) or red > 100000000 then raise exception 'Bad points'; end if;
    if red < coalesce(l_min, 0) then
      raise exception 'At least % points are needed before they can be used', to_char(l_min, 'FM999999990');
    end if;
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
    -- a free item (an empty bottle given with an oil): only items the owner marked "can be given free"
    fr := lower(coalesce(it->>'free', 'false')) = 'true';
    if fr and not coalesce(pr.giveaway, false) then raise exception '% cannot be given free', pr.name; end if;
    if q <= 0 or q > 100000 then raise exception 'Bad quantity'; end if;
    -- bulk price: from bulk_min (for example 50 ml) the whole line is charged at bulk_price
    lp := case when coalesce(pr.bulk_min, 0) > 0 and pr.bulk_price is not null and q >= pr.bulk_min then pr.bulk_price else pr.price end;
    pc := lp;
    if fr then
      pc := 0;
    elsif off and it ? 'price' then
      pc := round((it->>'price')::numeric, 2);
      if pc < 0 or pc > 10000000 then raise exception 'Bad price'; end if;
      if pc <> lp then diff := true; end if;
    end if;
    insert into sale_items(sale_id, product_id, name, qty, price, cost, unit, list_price, free)
      values (sid, pr.id, pr.name, q, pc, pr.cost, pr.unit, pr.price, fr);
    sub := sub + round(q * pc, 2);              -- each line to the cent (12 bottles at 14.166667 = 170.00)
    -- an item can sell from another item's stock (a wholesale oil poured from the retail oil's bottle)
    sp_id := null; sp_track := false;
    if pr.stock_of is not null then
      select id, track_stock, sell_without_stock, name, unit into sp_id, sp_track, sp_allow, sp_name, sp_unit from products where id = pr.stock_of and business_id = bid;
    end if;
    if sp_id is not null then
      if sp_track then
        insert into stock(product_id, branch_id, business_id, qty) values (sp_id, p_branch, bid, -q)
          on conflict (product_id, branch_id) do update set qty = stock.qty - q
          returning qty into nq;
        -- stop at zero unless this item (or the one it pours from) may be sold without stock.
        -- Offline sales already happened in the shop, so they are always kept.
        if not off and nq < 0 and not (coalesce(pr.sell_without_stock, false) or coalesce(sp_allow, false)) then
          raise exception '%', case when nq + q <= 0 then sp_name || ' is out of stock'
            else 'Only ' || to_char(nq + q, 'FM999999990.###') || case when coalesce(sp_unit, 'pc') <> 'pc' then ' ' || sp_unit else '' end || ' of ' || sp_name || ' left' end;
        end if;
        insert into stock_movements(business_id, branch_id, product_id, change, reason, user_id)
          values (bid, p_branch, sp_id, -q, 'Sale #' || rno || ' (' || left(pr.name, 60) || ')' || case when off then ' (offline)' else '' end, auth.uid());
      end if;
    elsif pr.track_stock then
      insert into stock(product_id, branch_id, business_id, qty) values (pr.id, p_branch, bid, -q)
        on conflict (product_id, branch_id) do update set qty = stock.qty - q
        returning qty into nq;
      if not off and nq < 0 and not coalesce(pr.sell_without_stock, false) then
        raise exception '%', case when nq + q <= 0 then pr.name || ' is out of stock'
          else 'Only ' || to_char(nq + q, 'FM999999990.###') || case when coalesce(pr.unit, 'pc') <> 'pc' then ' ' || pr.unit else '' end || ' of ' || pr.name || ' left' end;
      end if;
      insert into stock_movements(business_id, branch_id, product_id, change, reason, user_id)
        values (bid, p_branch, pr.id, -q, 'Sale #' || rno || case when off then ' (offline)' else '' end, auth.uid());
    end if;
  end loop;
  if red > 0 then
    select coalesce(sum(points), 0) into l_have from loyalty_points where customer_id = p_customer;
    if red > l_have then
      raise exception '% has only % points', (select name from customers where id = p_customer), to_char(l_have, 'FM999999990');
    end if;
    pv := round(red * coalesce(l_val, 0), 2);
    if disc + pv > sub then
      raise exception '% points are worth % but the sale is only %. Use fewer points.',
        to_char(red, 'FM999999990'), to_char(pv, 'FM999999990.00'), to_char(greatest(0, sub - disc), 'FM999999990.00');
    end if;
    disc := disc + pv;
    insert into loyalty_points(business_id, customer_id, sale_id, points, reason, user_id)
      values (bid, p_customer, sid, -red, 'Used on sale #' || rno, auth.uid());
  end if;
  if disc > sub then raise exception 'Discount is larger than the sale'; end if;
  tx := round((sub - disc) * coalesce(rate,0) / 100, 2);
  tot := sub - disc + tx;
  update sales set subtotal = sub, tax = tx, total = tot, price_diff = diff, discount = disc,
                   points_used = red, points_value = pv where id = sid;
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
  if loy and p_customer is not null and not cred and coalesce(l_per, 0) > 0 then
    earn := floor(tot / l_per);
    if earn > 0 then
      insert into loyalty_points(business_id, customer_id, sale_id, points, reason, user_id)
        values (bid, p_customer, sid, earn, 'Sale #' || rno || case when off then ' (offline)' else '' end, auth.uid());
      update sales set points_earned = earn where id = sid;
    end if;
  end if;
  return sid;
end $$;

revoke execute on function create_sale(uuid, jsonb, text, numeric, numeric, text, uuid, timestamptz, uuid, jsonb, numeric) from public, anon;
grant execute on function create_sale(uuid, jsonb, text, numeric, numeric, text, uuid, timestamptz, uuid, jsonb, numeric) to authenticated;

-- 7. create_sale_fast: the till's one-trip version, now also returns the points
drop function if exists create_sale_fast(uuid, jsonb, text, numeric, numeric, text, uuid, uuid, jsonb);
create or replace function create_sale_fast(
  p_branch uuid, p_items jsonb, p_payment text, p_paid numeric,
  p_discount numeric default 0, p_note text default '',
  p_client_id uuid default null, p_customer uuid default null,
  p_payments jsonb default null, p_redeem numeric default 0
) returns jsonb language plpgsql security definer set search_path = public as $$
declare sid uuid; out jsonb;
begin
  sid := create_sale(p_branch, p_items, p_payment, p_paid, p_discount, p_note, p_client_id, null, p_customer, p_payments, p_redeem);
  select jsonb_build_object('id', s.id, 'receipt_no', s.receipt_no, 'total', s.total, 'amount_paid', s.amount_paid, 'payments', s.payments,
           'points_earned', s.points_earned, 'points_used', s.points_used,
           'points', case when s.customer_id is null then null
                          else (select coalesce(sum(l.points), 0) from loyalty_points l where l.customer_id = s.customer_id) end)
    into out from sales s where s.id = sid;
  return out;
end $$;
revoke execute on function create_sale_fast(uuid, jsonb, text, numeric, numeric, text, uuid, uuid, jsonb, numeric) from public, anon;
grant execute on function create_sale_fast(uuid, jsonb, text, numeric, numeric, text, uuid, uuid, jsonb, numeric) to authenticated;

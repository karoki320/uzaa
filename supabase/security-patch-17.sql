-- Patch 17: stop selling at zero stock, unless the item is allowed to sell without stock. Safe to run twice.
-- Run after security-patch-16.sql (or run apply-all.sql).
--  * products.sell_without_stock: off (the default) means a sale cannot take the stock below zero.
--    Turn it on for items you sell before the stock is counted in (made to order, services, oils poured
--    from a bottle you have not entered yet).
--  * checked inside create_sale, so every till and phone obeys it. A sale made offline already happened in
--    the shop, so it is always kept when it uploads (the till checks its own copy of the stock instead).

alter table products add column if not exists sell_without_stock boolean not null default false;

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
  psum numeric; pcash numeric; pchg numeric; pn int; pays jsonb; lp numeric; sp_id uuid; sp_track boolean;
  sp_allow boolean; sp_name text; sp_unit text; nq numeric;
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
    -- bulk price: from bulk_min (for example 50 ml) the whole line is charged at bulk_price
    lp := case when coalesce(pr.bulk_min, 0) > 0 and pr.bulk_price is not null and q >= pr.bulk_min then pr.bulk_price else pr.price end;
    pc := lp;
    if off and it ? 'price' then
      pc := round((it->>'price')::numeric, 2);
      if pc < 0 or pc > 10000000 then raise exception 'Bad price'; end if;
      if pc <> lp then diff := true; end if;
    end if;
    insert into sale_items(sale_id, product_id, name, qty, price, cost, unit, list_price)
      values (sid, pr.id, pr.name, q, pc, pr.cost, pr.unit, pr.price);
    sub := sub + q * pc;
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

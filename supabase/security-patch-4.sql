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

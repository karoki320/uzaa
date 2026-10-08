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

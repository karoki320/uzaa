-- Patch 13: expenses, cashiers adding products, and the owner deleting a wrong sale. Safe to run twice.
-- Run after security-patch-12.sql (or run apply-all.sql).

-- 0. What the owner lets cashiers do (Settings > Staff permissions)
alter table businesses add column if not exists cashier_add_products boolean not null default true;
alter table businesses add column if not exists cashier_expense_limit numeric not null default 2000;   -- 0: cashiers cannot record expenses
alter table businesses drop constraint if exists businesses_cashier_perm_chk;
alter table businesses add constraint businesses_cashier_perm_chk check (cashier_expense_limit >= 0 and cashier_expense_limit <= 100000000);

-- 1. Expenses ------------------------------------------------------------------------------------
--  * owner and managers record any expense, and see them all
--  * a cashier records small ones paid from the till (up to the owner's limit, today or yesterday,
--    their own branch); these wait for the owner or a manager to mark them checked
--  * the frequency (one-off, daily, weekly, monthly) is a label for grouping, nothing repeats by itself
create table if not exists expenses (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  branch_id uuid references branches(id) on delete set null,
  category text not null default 'Other',
  amount numeric not null,
  frequency text not null default 'one-off',
  paid_from text not null default 'Cash',
  note text not null default '',
  spent_on date not null default ((now() at time zone 'Africa/Nairobi')::date),
  user_id uuid default auth.uid() references auth.users(id) on delete set null,
  reviewed boolean not null default false,
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint expenses_chk check (
    amount > 0 and amount <= 100000000
    and frequency in ('one-off','daily','weekly','monthly')
    and length(btrim(category)) between 1 and 60 and length(note) <= 300 and length(paid_from) <= 40)
);
create index if not exists expenses_biz_day on expenses(business_id, spent_on desc);
create index if not exists expenses_user on expenses(user_id, spent_on desc);
alter table expenses enable row level security;
revoke all on expenses from anon;

drop policy if exists exp_select on expenses;
create policy exp_select on expenses for select using (
  business_id = (select my_business()) and ((select my_role()) in ('owner','manager') or user_id = auth.uid()));
drop policy if exists exp_insert on expenses;
create policy exp_insert on expenses for insert with check (
  business_id = (select my_business()) and user_id = auth.uid() and (select my_role()) in ('owner','manager','cashier'));
drop policy if exists exp_update on expenses;
create policy exp_update on expenses for update
  using ((select my_role()) in ('owner','manager') and business_id = (select my_business()))
  with check ((select my_role()) in ('owner','manager') and business_id = (select my_business()));
drop policy if exists exp_delete on expenses;
create policy exp_delete on expenses for delete using (
  business_id = (select my_business())
  and ((select my_role()) in ('owner','manager') or (user_id = auth.uid() and not reviewed)));

-- the rules the browser cannot be trusted with
create or replace function expenses_guard() returns trigger language plpgsql security definer set search_path = public as $$
declare r text := my_role(); lim numeric; today date := (now() at time zone 'Africa/Nairobi')::date;
begin
  if auth.uid() is null then return new; end if;            -- service role / SQL editor
  new.category := left(btrim(new.category), 60);
  if tg_op = 'UPDATE' then
    new.business_id := old.business_id; new.user_id := old.user_id; new.created_at := old.created_at;
  end if;
  if new.branch_id is not null and not exists (select 1 from branches where id = new.branch_id and business_id = new.business_id) then
    raise exception 'Bad branch';
  end if;
  if new.spent_on > today + 1 then raise exception 'The date is in the future'; end if;
  if r = 'cashier' then
    select cashier_expense_limit into lim from businesses where id = new.business_id;
    if coalesce(lim, 0) <= 0 then raise exception 'Your owner has not allowed cashiers to record expenses'; end if;
    if new.amount > lim then raise exception 'Cashiers can record expenses of up to %. Ask the owner or a manager for this one.', to_char(lim, 'FM999999990.##'); end if;
    if new.spent_on < today - 1 then raise exception 'Cashiers can only record expenses for today or yesterday'; end if;
    new.branch_id := my_branch();
    new.reviewed := false; new.reviewed_by := null; new.reviewed_at := null;
  elsif tg_op = 'INSERT' then
    new.reviewed := true; new.reviewed_by := auth.uid(); new.reviewed_at := now();
  elsif new.reviewed and not old.reviewed then
    new.reviewed_by := auth.uid(); new.reviewed_at := now();
  elsif not new.reviewed then
    new.reviewed_by := null; new.reviewed_at := null;
  end if;
  return new;
end $$;
drop trigger if exists expenses_guard on expenses;
create trigger expenses_guard before insert or update on expenses for each row execute function expenses_guard();

-- 2. Cashiers add products (when the owner allows it) ---------------------------------------------
alter table products add column if not exists created_by uuid default auth.uid();

drop policy if exists prod_cashier_insert on products;
create policy prod_cashier_insert on products for insert with check (
  (select my_role()) = 'cashier' and business_id = (select my_business())
  and created_by = auth.uid() and active
  and exists (select 1 from businesses b where b.id = business_id and b.cashier_add_products));

drop policy if exists cat_cashier_insert on categories;
create policy cat_cashier_insert on categories for insert with check (
  (select my_role()) = 'cashier' and business_id = (select my_business())
  and exists (select 1 from businesses b where b.id = business_id and b.cashier_add_products));

-- opening stock: owner and managers as before; a cashier only once, for an item they just added, in their own branch
create or replace function adjust_stock(p_product uuid, p_branch uuid, p_change numeric, p_reason text default 'Adjustment')
returns void language plpgsql security definer set search_path = public as $$
declare bid uuid := my_business(); r text := my_role();
begin
  if r = 'cashier' then
    if p_reason <> 'Opening stock' or p_change <= 0 or p_branch is distinct from my_branch()
       or not exists (select 1 from products where id = p_product and business_id = bid and created_by = auth.uid())
       or exists (select 1 from stock_movements where product_id = p_product) then
      raise exception 'Not allowed';
    end if;
  elsif r not in ('owner','manager') then raise exception 'Not allowed';
  end if;
  if not exists (select 1 from products where id = p_product and business_id = bid) then raise exception 'Bad product'; end if;
  if not exists (select 1 from branches where id = p_branch and business_id = bid) then raise exception 'Bad branch'; end if;
  insert into stock(product_id, branch_id, business_id, qty) values (p_product, p_branch, bid, p_change)
    on conflict (product_id, branch_id) do update set qty = stock.qty + p_change;
  insert into stock_movements(business_id, branch_id, product_id, change, reason, user_id)
    values (bid, p_branch, p_product, p_change, left(p_reason, 120), auth.uid());
end $$;
revoke execute on function adjust_stock(uuid, uuid, numeric, text) from public, anon;
grant execute on function adjust_stock(uuid, uuid, numeric, text) to authenticated;

-- 3. The owner deletes a wrong sale ----------------------------------------------------------------
-- The stock it took is put back, and a copy of the sale is kept in sale_deletions with who deleted it and why.
create table if not exists sale_deletions (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  sale_id uuid not null,
  receipt_no bigint,
  branch_id uuid references branches(id) on delete set null,
  cashier_id uuid,
  total numeric,
  payment_method text,
  sold_at timestamptz,
  reason text not null,
  deleted_by uuid,
  snapshot jsonb not null,
  created_at timestamptz not null default now()
);
create index if not exists sale_deletions_biz on sale_deletions(business_id, created_at desc);
alter table sale_deletions enable row level security;
revoke all on sale_deletions from anon;
revoke insert, update, delete on sale_deletions from authenticated;
drop policy if exists sdel_select on sale_deletions;
create policy sdel_select on sale_deletions for select using (
  business_id = (select my_business()) and (select my_role()) in ('owner','manager'));

create or replace function delete_sale(p_sale uuid, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
declare bid uuid := my_business(); s record; m record; snap jsonb; why text := btrim(coalesce(p_reason, ''));
begin
  if bid is null or my_role() <> 'owner' then raise exception 'Only the owner can delete a sale'; end if;
  if length(why) < 3 then raise exception 'Write why this sale is being deleted'; end if;
  perform pg_advisory_xact_lock(hashtext(bid::text));
  select * into s from sales where id = p_sale and business_id = bid for update;
  if not found then raise exception 'Sale not found'; end if;
  snap := jsonb_build_object('sale', to_jsonb(s),
    'items', coalesce((select jsonb_agg(to_jsonb(i)) from sale_items i where i.sale_id = s.id), '[]'::jsonb));
  -- put back exactly what the sale took off, using its own stock movements
  for m in select * from stock_movements
           where business_id = bid and branch_id = s.branch_id
             and reason in ('Sale #' || s.receipt_no, 'Sale #' || s.receipt_no || ' (offline)') loop
    insert into stock(product_id, branch_id, business_id, qty) values (m.product_id, m.branch_id, bid, -m.change)
      on conflict (product_id, branch_id) do update set qty = stock.qty - m.change;
    insert into stock_movements(business_id, branch_id, product_id, change, reason, user_id)
      values (bid, m.branch_id, m.product_id, -m.change, left('Sale #' || s.receipt_no || ' deleted: ' || why, 200), auth.uid());
    update stock_movements set reason = reason || ' (deleted)' where id = m.id;
  end loop;
  insert into sale_deletions(business_id, sale_id, receipt_no, branch_id, cashier_id, total, payment_method, sold_at, reason, deleted_by, snapshot)
    values (bid, s.id, s.receipt_no, s.branch_id, s.cashier_id, s.total, s.payment_method, s.created_at, left(why, 300), auth.uid(), snap);
  delete from sales where id = s.id;          -- its items go with it
end $$;
revoke execute on function delete_sale(uuid, text) from public, anon;
grant execute on function delete_sale(uuid, text) to authenticated;

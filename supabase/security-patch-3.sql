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

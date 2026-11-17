-- Patch 19: features switched on per business, and Pour / Decant (refilling one item from another). Safe to run twice.
-- Run after security-patch-18.sql (or run apply-all.sql).
--  * businesses.features: a business's extras, e.g. {"pour": true}. Only the Uzaa super admin changes it.
--  * an item can be refilled from another: products.refill_from + refill_qty
--    (refill_qty = how much of the source one unit of this item uses: 1 for ml to ml, 10 for a 10 ml decant
--    poured from ml, 0.1 for a 10 ml decant from a 100 ml bottle counted in bottles).
--  * pour_stock() moves stock in one step: takes it off the source and adds it to the item. Items that sell
--    from another item's stock (shared stock, patch 16) use that item's count, so everything stays in sync.

-- 1. Per-business features, set by the super admin only
alter table businesses add column if not exists features jsonb not null default '{}'::jsonb;

create or replace function businesses_guard() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and coalesce(my_role(), '') <> 'super_admin' then
    if new.status is distinct from old.status or new.id is distinct from old.id or new.created_at is distinct from old.created_at
       or new.features is distinct from old.features then
      raise exception 'Not allowed';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists businesses_guard on businesses;
create trigger businesses_guard before update on businesses for each row execute function businesses_guard();

-- 2. Which item refills which, and at what rate (the owner sets it)
alter table products add column if not exists refill_from uuid references products(id) on delete set null;
alter table products add column if not exists refill_qty numeric;
alter table products drop constraint if exists products_refill_chk;
alter table products add constraint products_refill_chk check (
  (refill_from is null or refill_from <> id) and (refill_qty is null or (refill_qty > 0 and refill_qty <= 100000)));

-- 3. Pour or decant: p_qty is how many of the receiving item are made (ml, decants, bottles: its own unit)
create or replace function pour_stock(p_item uuid, p_branch uuid, p_qty numeric, p_note text default '')
returns jsonb language plpgsql security definer set search_path = public as $$
declare bid uuid := my_business(); r text := my_role(); it record; src record;
  src_id uuid; src_track boolean; src_name text; src_unit text; src_allow boolean;
  dst_id uuid; dst_track boolean; dst_name text; dst_unit text;
  q numeric := round(coalesce(p_qty, 0), 3); need numeric; left_q numeric; got numeric; why text := left(btrim(coalesce(p_note, '')), 120);
begin
  if bid is null or r not in ('owner','manager','cashier') then raise exception 'Not allowed'; end if;
  if not coalesce((select (features->>'pour')::boolean from businesses where id = bid), false) then
    raise exception 'Pour / Decant is not switched on for this business';
  end if;
  if not exists (select 1 from branches where id = p_branch and business_id = bid) then raise exception 'Bad branch'; end if;
  if r = 'cashier' and p_branch is distinct from my_branch() then raise exception 'Not your branch'; end if;
  if q <= 0 or q > 1000000 then raise exception 'Enter how much you are pouring'; end if;
  select * into it from products where id = p_item and business_id = bid;
  if not found then raise exception 'Unknown item'; end if;
  if it.refill_from is null or coalesce(it.refill_qty, 0) <= 0 then raise exception '% is not set up to be refilled. Set "Refilled from" on it under Products.', it.name; end if;
  select * into src from products where id = it.refill_from and business_id = bid;
  if not found then raise exception 'The item it is refilled from is gone'; end if;

  -- whose stock count each side really uses (shared stock points at the item it sells from)
  select p.id, p.track_stock, p.name, p.unit, p.sell_without_stock into src_id, src_track, src_name, src_unit, src_allow
    from products p where p.id = coalesce(case when not src.track_stock then src.stock_of end, src.id);
  select p.id, p.track_stock, p.name, p.unit into dst_id, dst_track, dst_name, dst_unit
    from products p where p.id = coalesce(case when not it.track_stock then it.stock_of end, it.id);
  if not src_track then raise exception '% does not track stock, so nothing can be poured from it', src_name; end if;
  if not dst_track then raise exception '% does not track stock. Turn on "Track stock" for it first.', dst_name; end if;
  if src_id = dst_id then raise exception 'These two items already share one stock count, so there is nothing to move'; end if;

  need := round(q * it.refill_qty, 3);
  perform pg_advisory_xact_lock(hashtext(bid::text));
  insert into stock(product_id, branch_id, business_id, qty) values (src_id, p_branch, bid, -need)
    on conflict (product_id, branch_id) do update set qty = stock.qty - need
    returning qty into left_q;
  if left_q < 0 and not coalesce(src_allow, false) then
    raise exception 'Only % % of % left: not enough to make % %',
      to_char(left_q + need, 'FM999999990.###'), coalesce(nullif(src_unit, 'pc'), 'pcs'), src_name,
      to_char(q, 'FM999999990.###'), coalesce(nullif(it.unit, 'pc'), 'pcs');
  end if;
  insert into stock(product_id, branch_id, business_id, qty) values (dst_id, p_branch, bid, q)
    on conflict (product_id, branch_id) do update set qty = stock.qty + q
    returning qty into got;
  insert into stock_movements(business_id, branch_id, product_id, change, reason, user_id) values
    (bid, p_branch, src_id, -need, left('Poured into ' || it.name || case when why <> '' then ' (' || why || ')' else '' end, 200), auth.uid()),
    (bid, p_branch, dst_id, q, left('Poured from ' || src.name || case when why <> '' then ' (' || why || ')' else '' end, 200), auth.uid());
  -- the poured item costs what went into it, so profit on decants and refills is right
  if coalesce(src.cost, 0) > 0 and coalesce(it.cost, 0) = 0 then
    update products set cost = round(src.cost * it.refill_qty, 2) where id = it.id;
  end if;
  return jsonb_build_object('from', src_name, 'took', need, 'from_unit', src_unit, 'from_left', left_q,
                            'to', it.name, 'added', q, 'to_unit', it.unit, 'to_now', got);
end $$;
revoke execute on function pour_stock(uuid, uuid, numeric, text) from public, anon;
grant execute on function pour_stock(uuid, uuid, numeric, text) to authenticated;

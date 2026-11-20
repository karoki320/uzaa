-- Patch 23: everyone can reverse a wrong sale; the owner is told. Safe to run twice.
-- Run after security-patch-22.sql (or run apply-all.sql).
--  * owner and managers: any sale. Cashiers: their own sales from today (their branch), to fix a mistake at once.
--  * a reason is always required; a copy of the sale is kept in sale_deletions with who and why,
--    the owner's phone is told (/api/sale/deleted) and Reports shows it under "What stands out".
--  * stock is put back for every line, including items that sell from another item's stock (patch 16).
--  * returns the id of the record kept in sale_deletions.

drop function if exists delete_sale(uuid, text);
create or replace function delete_sale(p_sale uuid, p_reason text)
returns uuid language plpgsql security definer set search_path = public as $$
declare bid uuid := my_business(); r text := my_role(); s record; m record; snap jsonb; did uuid;
  why text := btrim(coalesce(p_reason, '')); today date := (now() at time zone 'Africa/Nairobi')::date;
begin
  if bid is null or r not in ('owner','manager','cashier') then raise exception 'Not allowed'; end if;
  if length(why) < 3 then raise exception 'Write why this sale is being reversed'; end if;
  perform pg_advisory_xact_lock(hashtext(bid::text));
  select * into s from sales where id = p_sale and business_id = bid for update;
  if not found then raise exception 'Sale not found'; end if;
  if r = 'cashier' then
    if s.cashier_id is distinct from auth.uid() then raise exception 'Cashiers can only reverse their own sales'; end if;
    if (s.created_at at time zone 'Africa/Nairobi')::date <> today then
      raise exception 'Cashiers can only reverse sales from today. Ask the owner or a manager.';
    end if;
  end if;
  snap := jsonb_build_object('sale', to_jsonb(s),
    'items', coalesce((select jsonb_agg(to_jsonb(i)) from sale_items i where i.sale_id = s.id), '[]'::jsonb));
  -- put back exactly what the sale took off, using its own stock movements:
  -- "Sale #12", "Sale #12 (offline)" and "Sale #12 (Kenya Love (Wholesale))" for shared stock
  for m in select * from stock_movements
           where business_id = bid and branch_id = s.branch_id
             and (reason = 'Sale #' || s.receipt_no or reason like 'Sale #' || s.receipt_no || ' (%')
             and reason not like '% (deleted)' loop
    insert into stock(product_id, branch_id, business_id, qty) values (m.product_id, m.branch_id, bid, -m.change)
      on conflict (product_id, branch_id) do update set qty = stock.qty - m.change;
    insert into stock_movements(business_id, branch_id, product_id, change, reason, user_id)
      values (bid, m.branch_id, m.product_id, -m.change, left('Sale #' || s.receipt_no || ' reversed: ' || why, 200), auth.uid());
    update stock_movements set reason = reason || ' (deleted)' where id = m.id;
  end loop;
  insert into sale_deletions(business_id, sale_id, receipt_no, branch_id, cashier_id, total, payment_method, sold_at, reason, deleted_by, snapshot)
    values (bid, s.id, s.receipt_no, s.branch_id, s.cashier_id, s.total, s.payment_method, s.created_at, left(why, 300), auth.uid(), snap)
    returning id into did;
  delete from sales where id = s.id;          -- its items (and loyalty points, patch 22) go with it
  return did;
end $$;
revoke execute on function delete_sale(uuid, text) from public, anon;
grant execute on function delete_sale(uuid, text) to authenticated;

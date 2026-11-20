-- Patch 25: Quick add at the till. Safe to run twice. Run after security-patch-24.sql (or run apply-all.sql).
--  * The till can create an item in the middle of a sale ("Add and sell"): name, price, optional stock and
--    (owner/manager only) cost. Cashiers use the same permission as before: Settings > Staff permissions >
--    "Cashiers can add new products" (policy prod_cashier_insert, patch 12).
--  * products.added_at_till: made from the till; Products lists these for the owner to check. Saving the
--    item from Products (owner or manager) clears it.
--  * products.needs_count: made at the till with no stock count, so it sells at 0 stock until counted.
--    Cleared by the database the first time stock is counted or received for it (any stock movement that adds
--    stock and is not from a sale, a sale reversal or a pour). The item then stops selling
--    below 0 stock, like every other item.
alter table products add column if not exists added_at_till boolean not null default false;
alter table products add column if not exists needs_count boolean not null default false;
create index if not exists products_added_at_till on products (business_id) where added_at_till;

-- Cashiers keep inserting through prod_cashier_insert (patch 12); only owner and managers update products,
-- so a cashier cannot clear the flags.

create or replace function clear_needs_count() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.change > 0 and coalesce(new.reason, '') not like 'Sale #%' and coalesce(new.reason, '') not like 'Poured%' then
    -- counted: the zero-stock rule (patch 17) applies again, as for any other item
    update products set needs_count = false, sell_without_stock = false where id = new.product_id and needs_count;
  end if;
  return new;
end $$;
drop trigger if exists stock_counted_clears_flag on stock_movements;
create trigger stock_counted_clears_flag after insert on stock_movements
  for each row execute function clear_needs_count();

-- Uzaa speed patch 1 (run once in Supabase > SQL editor; safe to run again)
--
-- 1. create_sale_fast: records the sale AND returns its receipt number and totals in one trip.
--    The till used to call create_sale and then ask for the sale again, two full round trips
--    from the phone (each one Kenya -> Vercel -> Supabase and back). Same checks, same locking:
--    it simply calls create_sale.
create or replace function create_sale_fast(
  p_branch uuid, p_items jsonb, p_payment text, p_paid numeric,
  p_discount numeric default 0, p_note text default '',
  p_client_id uuid default null, p_customer uuid default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare sid uuid; out jsonb;
begin
  sid := create_sale(p_branch, p_items, p_payment, p_paid, p_discount, p_note, p_client_id, null, p_customer);
  select jsonb_build_object('id', s.id, 'receipt_no', s.receipt_no, 'total', s.total, 'amount_paid', s.amount_paid)
    into out from sales s where s.id = sid;
  return out;
end $$;
revoke execute on function create_sale_fast(uuid, jsonb, text, numeric, numeric, text, uuid, uuid) from public, anon;
grant execute on function create_sale_fast(uuid, jsonb, text, numeric, numeric, text, uuid, uuid) to authenticated;

-- 2. Indexes for the queries every screen runs.
-- The till and Stock screen load stock with "where branch_id = ?". The primary key is
-- (product_id, branch_id), which cannot serve a branch-only filter.
create index if not exists stock_branch_product on stock(branch_id, product_id) include (qty);
-- Products screen lists every product (hidden ones too) ordered by name.
create index if not exists products_biz_name on products(business_id, name);
-- Credit: a customer's balance sums their credit sales.
create index if not exists sales_customer_method on sales(customer_id, payment_method) include (total, amount_paid) where customer_id is not null;

-- 3. Fresh statistics so the planner uses the new indexes straight away.
analyze products; analyze stock; analyze sales; analyze sale_items; analyze stock_movements;

-- PostgREST picks up the new function after a schema reload.
notify pgrst, 'reload schema';

-- Patch 24: Part payment. Safe to run twice. Run after security-patch-23.sql (or run apply-all.sql).
--  * businesses.credit_style: what the shop calls taking goods before paying in full.
--      'credit' = Credit (deni), the default.
--      'part'   = Part payment (Glow Collections): the customer pays a deposit now and the rest in
--                 instalments of any size, any time. The till asks for the name and WhatsApp number.
--  * The money works exactly as credit (patch 5): the sale is saved with payment method 'Credit', the
--    deposit is its amount_paid, each instalment is a credit_payments row, and the balance is
--    customer_balance(). Only the words on screen and on receipts change.
alter table businesses add column if not exists credit_style text not null default 'credit';
alter table businesses drop constraint if exists businesses_credit_style_chk;
alter table businesses add constraint businesses_credit_style_chk check (credit_style in ('credit', 'part'));

--  * sales.deposit_method: how the deposit taken with a credit / part-payment sale was paid ('' = cash,
--    as before). Set once, right after the sale, by set_deposit_method(). Close day counts only cash deposits.
alter table sales add column if not exists deposit_method text not null default '';

create or replace function set_deposit_method(p_sale uuid, p_method text)
returns void language plpgsql security definer set search_path = public as $$
declare bid uuid := my_business(); m text := left(btrim(coalesce(p_method, '')), 40);
begin
  if bid is null then raise exception 'No business'; end if;
  if m = '' or lower(m) = 'credit' then raise exception 'Bad payment method'; end if;
  update sales set deposit_method = m
    where id = p_sale and business_id = bid and lower(payment_method) = 'credit' and amount_paid > 0
      and deposit_method = '' and created_at > now() - interval '1 day'
      and (cashier_id = auth.uid() or my_role() in ('owner', 'manager'));
  if not found then raise exception 'Sale not found'; end if;
end $$;
revoke execute on function set_deposit_method(uuid, text) from public, anon;
grant execute on function set_deposit_method(uuid, text) to authenticated;

-- Close day: a deposit counts as cash in the drawer only when it was paid in cash
create or replace function close_day(p_branch uuid, p_day date, p_counted numeric, p_note text default '')
returns cash_counts language plpgsql security definer set search_path = public as $$
declare bid uuid := my_business(); r text := my_role(); f timestamptz; t timestamptz;
  cs numeric; cp numeric; ce numeric := 0; rec cash_counts; today date := (now() at time zone 'Africa/Nairobi')::date;
begin
  if bid is null or r not in ('owner','manager','cashier') then raise exception 'Not allowed'; end if;
  if not exists (select 1 from branches where id = p_branch and business_id = bid) then raise exception 'Bad branch'; end if;
  if r = 'cashier' and p_branch is distinct from my_branch() then raise exception 'Not your branch'; end if;
  if p_day > today or p_day < today - 7 then raise exception 'You can close today or the last 7 days'; end if;
  if r = 'cashier' and p_day < today - 1 then raise exception 'Cashiers can close today or yesterday'; end if;
  if p_counted is null or p_counted < 0 or p_counted > 1000000000 then raise exception 'Enter the cash you counted'; end if;
  f := (p_day::timestamp) at time zone 'Africa/Nairobi';
  t := ((p_day + 1)::timestamp) at time zone 'Africa/Nairobi';
  -- cash sales, the cash part of split sales, and cash deposits taken with credit / part-payment sales
  -- (a deposit paid by M-Pesa or card is not in the drawer: sales.deposit_method, patch 24)
  select coalesce(sum(case
           when jsonb_typeof(payments) = 'array' then sale_part(payments, payment_method, total, amount_paid, 'cash')
           when lower(payment_method) = 'cash' then least(total, amount_paid)
           when lower(payment_method) = 'credit' and lower(coalesce(deposit_method, '')) in ('', 'cash') then amount_paid
           else 0 end), 0) into cs from sales
    where business_id = bid and branch_id = p_branch and created_at >= f and created_at < t;
  select coalesce(sum(amount), 0) into cp from credit_payments
    where business_id = bid and branch_id = p_branch and created_at >= f and created_at < t and lower(method) = 'cash';
  if to_regclass('public.expenses') is not null then
    execute 'select coalesce(sum(amount), 0) from expenses where business_id = $1 and branch_id = $2 and spent_on = $3 and lower(paid_from) = ''cash'''
      into ce using bid, p_branch, p_day;
  end if;
  insert into cash_counts(business_id, branch_id, day, cash_sales, cash_paid_in, cash_spent, expected, counted, diff, note, user_id)
    values (bid, p_branch, p_day, cs, cp, ce, cs + cp - ce, round(p_counted, 2), round(p_counted, 2) - (cs + cp - ce), left(coalesce(p_note, ''), 300), auth.uid())
    on conflict (business_id, branch_id, day) do update set
      cash_sales = excluded.cash_sales, cash_paid_in = excluded.cash_paid_in, cash_spent = excluded.cash_spent,
      expected = excluded.expected, counted = excluded.counted, diff = excluded.diff, note = excluded.note,
      user_id = excluded.user_id, created_at = now()
    returning * into rec;
  return rec;
end $$;
revoke execute on function close_day(uuid, date, numeric, text) from public, anon;
grant execute on function close_day(uuid, date, numeric, text) to authenticated;

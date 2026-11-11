-- Patch 14: closing the day (cash count) and the supplier for reorders. Safe to run twice.
-- Run after security-patch-13.sql (or run apply-all.sql).

-- 1. Who to send the reorder list to
alter table businesses add column if not exists supplier_name text not null default '';
alter table businesses add column if not exists supplier_whatsapp text not null default '';
alter table businesses drop constraint if exists businesses_supplier_chk;
alter table businesses add constraint businesses_supplier_chk check (length(supplier_name) <= 80 and length(supplier_whatsapp) <= 20);

-- 2. Closing the day: the cashier counts the cash in the drawer, Uzaa works out what should be there.
--    One count per branch per day; counting again replaces it (the last count stands).
create table if not exists cash_counts (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  branch_id uuid not null references branches(id) on delete cascade,
  day date not null,
  cash_sales numeric not null default 0,
  cash_paid_in numeric not null default 0,      -- credit customers paying in cash
  cash_spent numeric not null default 0,        -- expenses paid from cash
  expected numeric not null default 0,
  counted numeric not null,
  diff numeric not null default 0,              -- counted - expected: below 0 is short
  note text not null default '',
  user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (business_id, branch_id, day)
);
create index if not exists cash_counts_biz_day on cash_counts(business_id, day desc);
alter table cash_counts enable row level security;
revoke all on cash_counts from anon;
revoke insert, update, delete on cash_counts from authenticated;   -- only close_day() writes
drop policy if exists cc_select on cash_counts;
create policy cc_select on cash_counts for select using (
  business_id = (select my_business())
  and ((select my_role()) in ('owner','manager') or branch_id = (select my_branch())));

-- Works out the expected cash on the server (the phone cannot be trusted with it) and saves the count.
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
  select coalesce(sum(least(total, amount_paid)), 0) into cs from sales
    where business_id = bid and branch_id = p_branch and created_at >= f and created_at < t and lower(payment_method) = 'cash';
  -- a cash deposit taken with a credit sale is cash in the drawer too
  cs := cs + coalesce((select sum(amount_paid) from sales where business_id = bid and branch_id = p_branch
                         and created_at >= f and created_at < t and lower(payment_method) = 'credit'), 0);
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

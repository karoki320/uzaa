-- Patch 18: Uzaa subscription billing with Paystack. Safe to run twice.
-- Run after security-patch-17.sql (or run apply-all.sql).
--  * subscriptions: one row per business: plan, price, how often, and the date it is paid up to.
--    Made when the client signs a generated agreement, or set by the super admin under Billing.
--  * billing_payments: every Paystack checkout or automatic card charge, with its reference.
--  * a business that is more than the grace period (7 days) past its paid-up date becomes 'lapsed':
--    like suspended, nobody can sell or read data until the owner pays. Their data is kept.
--  * a payment switches a waiting (pending) or lapsed business on by itself. A business the admin
--    suspended stays suspended.
-- Both tables are server only: the browser reaches them through /api/billing and /api/admin/billing.

alter table businesses drop constraint if exists businesses_status_chk;
alter table businesses add constraint businesses_status_chk check (status in ('active','pending','suspended','lapsed'));

create table if not exists subscriptions (
  business_id uuid primary key references businesses(id) on delete cascade,
  plan text not null default 'Uzaa POS Standard',
  fee numeric(12,2) not null default 0 check (fee >= 0),
  period text not null default 'month' check (period in ('month','quarter','year')),
  setup_fee numeric(12,2) not null default 0 check (setup_fee >= 0),
  setup_paid boolean not null default false,
  currency text not null default 'KES',
  start_date date,
  paid_until date,                                  -- null: not paid yet (never locks on its own)
  bill_email text not null default '',
  auto_renew boolean not null default false,        -- charge the saved card on the due date
  card_auth text not null default '',               -- Paystack authorization code (useless without our secret key)
  card_label text not null default '',              -- e.g. "Visa ending 4081, expires 12/30"
  card_email text not null default '',              -- Paystack charges a saved card only with the same email
  last_auto_try date,
  agreement_id uuid references agreements(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table subscriptions enable row level security;
revoke all on subscriptions from anon, authenticated;

create table if not exists billing_payments (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  reference text not null unique,
  kind text not null check (kind in ('first','renewal','auto')),
  amount numeric(12,2) not null check (amount > 0),
  currency text not null default 'KES',
  includes_setup boolean not null default false,
  save_card boolean not null default false,
  status text not null default 'pending' check (status in ('pending','success','failed','abandoned')),
  channel text not null default '',
  covers_from date,
  covers_to date,
  paid_at timestamptz,
  note text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists billing_payments_biz on billing_payments(business_id, created_at desc);
alter table billing_payments enable row level security;
revoke all on billing_payments from anon, authenticated;

-- Apply a payment Paystack has confirmed. Runs once per reference however often it is called (the
-- webhook and the return page both call it). Moves the paid-up date on by one period, from the
-- later of today, the current paid-up date and the agreement start date.
create or replace function billing_apply(p_ref text, p_amount numeric, p_currency text, p_channel text, p_paid_at timestamptz)
returns jsonb language plpgsql security definer set search_path = public as $$
declare p billing_payments; s subscriptions; base date; till date; step interval;
begin
  select * into p from billing_payments where reference = p_ref for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'unknown reference'); end if;
  select * into s from subscriptions where business_id = p.business_id for update;
  if p.status = 'success' then
    return jsonb_build_object('ok', true, 'already', true, 'paid_until', s.paid_until, 'business_id', p.business_id);
  end if;
  if not found then return jsonb_build_object('ok', false, 'reason', 'no subscription'); end if;
  if upper(coalesce(p_currency, '')) <> upper(p.currency) or coalesce(p_amount, 0) + 0.005 < p.amount then
    update billing_payments set status = 'failed', note = 'Amount or currency did not match' where id = p.id;
    return jsonb_build_object('ok', false, 'reason', 'amount mismatch');
  end if;
  step := case s.period when 'quarter' then interval '3 months' when 'year' then interval '1 year' else interval '1 month' end;
  base := greatest(coalesce(s.paid_until, current_date), current_date, coalesce(s.start_date, current_date));
  till := (base + step)::date;
  update subscriptions set paid_until = till, setup_paid = setup_paid or p.includes_setup, updated_at = now()
    where business_id = p.business_id;
  update billing_payments set status = 'success', channel = left(coalesce(p_channel, ''), 40),
    paid_at = coalesce(p_paid_at, now()), covers_from = base, covers_to = till where id = p.id;
  update businesses set status = 'active' where id = p.business_id and status in ('pending', 'lapsed');
  return jsonb_build_object('ok', true, 'paid_until', till, 'business_id', p.business_id);
end $$;

-- Lock every active business that is more than p_grace days past its paid-up date. Returns their ids.
create or replace function billing_lapse(p_grace int default 7)
returns setof uuid language sql security definer set search_path = public as $$
  update businesses b set status = 'lapsed'
  from subscriptions s
  where s.business_id = b.id and b.status = 'active' and s.paid_until is not null
    and s.paid_until + greatest(p_grace, 0) < current_date
  returning b.id $$;

revoke execute on function billing_apply(text, numeric, text, text, timestamptz) from public, anon, authenticated;
revoke execute on function billing_lapse(int) from public, anon, authenticated;
grant execute on function billing_apply(text, numeric, text, text, timestamptz) to service_role;
grant execute on function billing_lapse(int) to service_role;

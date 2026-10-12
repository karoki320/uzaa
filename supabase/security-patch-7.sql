-- Patch 7: phone alerts for the business owner.
-- Run after security-patch-6.sql. Safe to run twice.
--  * the owner chooses: nothing, every sale a cashier makes, or one summary at the end of the day
--  * each phone that agrees to alerts is stored once, by its own endpoint

alter table businesses add column if not exists notify_mode text not null default 'off';
alter table businesses drop constraint if exists businesses_notify_mode_chk;
alter table businesses add constraint businesses_notify_mode_chk check (notify_mode in ('off','sale','daily'));
alter table businesses add column if not exists notify_hour int not null default 20;
alter table businesses drop constraint if exists businesses_notify_hour_chk;
alter table businesses add constraint businesses_notify_hour_chk check (notify_hour between 0 and 23);
alter table businesses add column if not exists notify_min numeric not null default 0;   -- only sales at or above this

create table if not exists push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  business_id uuid references businesses(id) on delete cascade,
  endpoint text not null,
  p256dh text not null,
  auth text not null,
  label text default '',
  created_at timestamptz default now(),
  last_sent timestamptz
);
create unique index if not exists push_endpoint_uq on push_subscriptions(endpoint);
create index if not exists push_biz on push_subscriptions(business_id);

alter table push_subscriptions enable row level security;
drop policy if exists push_own on push_subscriptions;
create policy push_own on push_subscriptions for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- What one business owes the owner at the end of the day, read by the server when it sends the summary.
create or replace function day_summary(p_business uuid, p_from timestamptz, p_to timestamptz)
returns table(sales bigint, total numeric, cash numeric, other numeric) language sql stable security definer set search_path = public as $$
  select count(*), coalesce(sum(s.total), 0),
         coalesce(sum(s.total) filter (where lower(s.payment_method) = 'cash'), 0),
         coalesce(sum(s.total) filter (where lower(s.payment_method) <> 'cash'), 0)
  from sales s where s.business_id = p_business and s.created_at >= p_from and s.created_at < p_to $$;
revoke execute on function day_summary(uuid, timestamptz, timestamptz) from public, anon, authenticated;

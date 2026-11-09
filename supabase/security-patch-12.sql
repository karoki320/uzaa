-- Patch 12: client onboarding by the super admin, and service agreements signed online. Safe to run twice.
-- Run after security-patch-11.sql (or run apply-all.sql).

-- 1. Service agreements. Server only: the browser never reads this table directly. The super admin
--    reaches it through /api/admin/agreements, and the client through their private signing link.
create table if not exists agreements (
  id uuid primary key default gen_random_uuid(),
  business_id uuid references businesses(id) on delete cascade,
  token text not null unique,                       -- the private signing link
  kind text not null default 'generated' check (kind in ('generated','uploaded')),
  ref text not null default '',                     -- e.g. UZA-2026-0007
  client_name text not null default '',
  client_business text not null default '',
  client_email text not null default '',
  client_phone text not null default '',
  client_address text not null default '',
  client_id_no text not null default '',            -- national ID / company reg. / KRA PIN, as the client gives it
  terms jsonb not null default '{}'::jsonb,         -- plan, fees, start date, term, special terms
  doc_pdf text not null default '',                 -- an uploaded agreement, base64 (kind = uploaded)
  doc_name text not null default '',
  doc_hash text not null default '',                -- SHA-256 of exactly what the client was shown
  status text not null default 'sent' check (status in ('sent','viewed','signed','void')),
  sent_at timestamptz not null default now(),
  viewed_at timestamptz,
  signed_at timestamptz,
  signer_name text not null default '',
  signer_title text not null default '',
  signature text not null default '',               -- data:image/jpeg;base64,...
  signer_ip text not null default '',
  signer_agent text not null default '',
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint agreements_size_chk check (length(doc_pdf) <= 4500000 and length(signature) <= 200000)
);
create index if not exists agreements_business on agreements(business_id, created_at desc);
alter table agreements enable row level security;
revoke all on agreements from anon, authenticated;

-- 2. The super admin sets a business up directly (same as a sales agent, but no agent attached).
--    The server creates the owner's login first and passes its id in.
create or replace function create_business_as_admin(
  p_owner uuid, p_name text, p_type text, p_owner_name text, p_owner_email text,
  p_branch text default 'Main Branch', p_item_label text default 'Product', p_custom_fields jsonb default '[]'::jsonb,
  p_owner_phone text default ''
) returns uuid language plpgsql security definer set search_path = public as $$
declare bid uuid; brid uuid;
begin
  if my_role() <> 'super_admin' then raise exception 'Not allowed'; end if;
  if coalesce(btrim(p_name), '') = '' then raise exception 'Enter the business name'; end if;
  if coalesce(btrim(p_owner_name), '') = '' then raise exception 'Enter the name of the proprietor'; end if;
  if exists (select 1 from profiles where id = p_owner) then raise exception 'That person already has an account'; end if;
  insert into businesses(name, business_type, item_label, custom_fields, status, owner_email, owner_phone, invited_at)
    values (left(btrim(p_name), 120), coalesce(p_type, 'retail'), coalesce(nullif(btrim(p_item_label), ''), 'Product'),
            coalesce(p_custom_fields, '[]'::jsonb), 'pending', lower(btrim(p_owner_email)),
            left(btrim(coalesce(p_owner_phone, '')), 20), now())
    returning id into bid;
  insert into branches(business_id, name) values (bid, left(coalesce(nullif(btrim(p_branch), ''), 'Main Branch'), 80))
    returning id into brid;
  insert into profiles(id, business_id, branch_id, full_name, email, role)
    values (p_owner, bid, brid, left(btrim(p_owner_name), 120), lower(btrim(p_owner_email)), 'owner');
  return bid;
end $$;
revoke execute on function create_business_as_admin(uuid, text, text, text, text, text, text, jsonb, text) from public, anon;
grant execute on function create_business_as_admin(uuid, text, text, text, text, text, text, jsonb, text) to authenticated;

-- 3. The super admin's business list: performance over 30 days, today's sales, the owner's contacts
--    and where the service agreement stands.
drop function if exists admin_overview();
create or replace function admin_overview()
returns table(id uuid, name text, business_type text, status text, created_at timestamptz, branches bigint,
              staff bigint, sales_count bigint, revenue_7d numeric, last_sale timestamptz, owner_email text, agent_name text,
              revenue_30d numeric, revenue_prev_30d numeric, sales_today bigint, revenue_today numeric,
              products bigint, owner_name text, owner_phone text, owner_joined boolean,
              agreement_status text, agreement_signed_at timestamptz)
language plpgsql security definer set search_path = public, auth as $$
begin
  if my_role() <> 'super_admin' then raise exception 'Not allowed'; end if;
  return query
  select b.id, b.name, b.business_type, b.status, b.created_at,
    (select count(*) from branches x where x.business_id = b.id),
    (select count(*) from profiles x where x.business_id = b.id),
    (select count(*) from sales s where s.business_id = b.id),
    (select coalesce(sum(s.total),0) from sales s where s.business_id = b.id and s.created_at > now() - interval '7 days'),
    (select max(s.created_at) from sales s where s.business_id = b.id),
    coalesce((select p.email from profiles p where p.business_id = b.id and p.role = 'owner' limit 1), b.owner_email),
    (select a.full_name from profiles a where a.id = b.agent_id),
    (select coalesce(sum(s.total),0) from sales s where s.business_id = b.id and s.created_at > now() - interval '30 days'),
    (select coalesce(sum(s.total),0) from sales s where s.business_id = b.id
       and s.created_at > now() - interval '60 days' and s.created_at <= now() - interval '30 days'),
    (select count(*) from sales s where s.business_id = b.id
       and s.created_at >= date_trunc('day', now() at time zone 'Africa/Nairobi') at time zone 'Africa/Nairobi'),
    (select coalesce(sum(s.total),0) from sales s where s.business_id = b.id
       and s.created_at >= date_trunc('day', now() at time zone 'Africa/Nairobi') at time zone 'Africa/Nairobi'),
    (select count(*) from products x where x.business_id = b.id),
    (select p.full_name from profiles p where p.business_id = b.id and p.role = 'owner' limit 1),
    b.owner_phone,
    exists (select 1 from auth.users u join profiles p on p.id = u.id
            where p.business_id = b.id and p.role = 'owner' and u.last_sign_in_at is not null),
    (select g.status from agreements g where g.business_id = b.id and g.status <> 'void' order by g.created_at desc limit 1),
    (select g.signed_at from agreements g where g.business_id = b.id and g.status = 'signed' order by g.signed_at desc limit 1)
  from businesses b order by b.created_at desc;
end $$;
revoke execute on function admin_overview() from public, anon;
grant execute on function admin_overview() to authenticated;

-- Patch 8: the proprietor's phone number when a sales agent signs a business up.
-- Run after security-patch-7.sql. Safe to run twice.

alter table businesses add column if not exists owner_phone text default '';

drop function if exists create_business_as_agent(uuid, text, text, text, text, text, text, jsonb);

create or replace function create_business_as_agent(
  p_owner uuid, p_name text, p_type text, p_owner_name text, p_owner_email text,
  p_branch text default 'Main Branch', p_item_label text default 'Product', p_custom_fields jsonb default '[]'::jsonb,
  p_owner_phone text default ''
) returns uuid language plpgsql security definer set search_path = public as $$
declare bid uuid; brid uuid;
begin
  if my_role() <> 'sales' then raise exception 'Not allowed'; end if;
  if coalesce(btrim(p_name), '') = '' then raise exception 'Enter the business name'; end if;
  if coalesce(btrim(p_owner_name), '') = '' then raise exception 'Enter the name of the proprietor'; end if;
  if exists (select 1 from profiles where id = p_owner) then raise exception 'That person already has an account'; end if;
  insert into businesses(name, business_type, item_label, custom_fields, status, agent_id, owner_email, owner_phone, invited_at)
    values (left(btrim(p_name), 120), coalesce(p_type, 'retail'), coalesce(nullif(btrim(p_item_label), ''), 'Product'),
            coalesce(p_custom_fields, '[]'::jsonb), 'pending', auth.uid(), lower(btrim(p_owner_email)),
            left(btrim(coalesce(p_owner_phone, '')), 20), now())
    returning id into bid;
  insert into branches(business_id, name) values (bid, left(coalesce(nullif(btrim(p_branch), ''), 'Main Branch'), 80))
    returning id into brid;
  insert into profiles(id, business_id, branch_id, full_name, email, role)
    values (p_owner, bid, brid, left(btrim(p_owner_name), 120), lower(btrim(p_owner_email)), 'owner');
  return bid;
end $$;
revoke execute on function create_business_as_agent(uuid, text, text, text, text, text, text, jsonb, text) from public, anon;
grant execute on function create_business_as_agent(uuid, text, text, text, text, text, text, jsonb, text) to authenticated;

-- the agent's list shows the phone number too, so they can follow the shop up
drop function if exists agent_businesses();
create or replace function agent_businesses()
returns table(id uuid, name text, business_type text, status text, owner_email text, owner_name text, owner_phone text,
              invited_at timestamptz, created_at timestamptz, joined boolean)
language plpgsql security definer set search_path = public, auth as $$
begin
  if my_role() <> 'sales' then raise exception 'Not allowed'; end if;
  return query
  select b.id, b.name, b.business_type, b.status, b.owner_email,
    (select p.full_name from profiles p where p.business_id = b.id and p.role = 'owner' limit 1),
    b.owner_phone, b.invited_at, b.created_at,
    exists (select 1 from auth.users u join profiles p on p.id = u.id
            where p.business_id = b.id and p.role = 'owner' and u.last_sign_in_at is not null)
  from businesses b where b.agent_id = auth.uid() order by b.created_at desc;
end $$;
revoke execute on function agent_businesses() from public, anon;
grant execute on function agent_businesses() to authenticated;

-- Why can a person not reach their business?
-- Paste this whole file into the Supabase SQL editor and press Run.
-- Replace the email in all three places with the account you are testing.

-- 1. The account. ids_match must be true, email_confirmed true, active true, status active.
select u.id as auth_id, p.id as profile_id, (p.id = u.id) as ids_match,
       u.email, u.email_confirmed_at is not null as email_confirmed, u.last_sign_in_at,
       p.role, p.active, p.terms_accepted_at, b.name as business, b.status
from auth.users u
left join profiles p on p.id = u.id
left join businesses b on b.id = p.business_id
where u.email = 'todaybiziirise@gmail.com';

-- 2. Any business with no owner who can open it.
select b.id, b.name, b.status, b.owner_email
from businesses b
where not exists (select 1 from profiles p where p.business_id = b.id and p.role = 'owner' and p.active);

-- 3. What that person's own sign-in can see. Both numbers must be at least 1.
begin;
select set_config('request.jwt.claims',
  json_build_object('sub', (select id from auth.users where email = 'todaybiziirise@gmail.com'),
                    'role', 'authenticated', 'aal', 'aal1')::text, true);
set local role authenticated;
select (select count(*) from profiles)   as own_profile_visible,
       (select count(*) from businesses) as own_business_visible,
       coalesce(my_role(), '(blocked)')  as role_the_app_sees;
commit;

-- Tidy up after deleting things by hand in the Supabase tables.
-- Run the SELECTs first and read them. The DELETEs are commented out on purpose.
--
-- Why this is needed: the tables are joined up so that removing a business removes everything inside it,
-- but a login lives in Authentication, not in these tables. Removing one side by hand leaves the other.

-- 1. Businesses with no login left. They still show in the super admin dashboard because they still exist.
--    Use the Remove button in the dashboard, which clears both sides properly, or the delete below.
select b.id, b.name, b.status, b.owner_email, b.created_at,
       (select count(*) from sales s where s.business_id = b.id) as sales
from businesses b
where not exists (select 1 from profiles p where p.business_id = b.id)
order by b.created_at desc;

-- 2. Logins with no business attached. Signing in with one of these lands on "create a business",
--    which is correct but confusing if you thought the account was set up.
select u.id, u.email, u.created_at, u.last_sign_in_at
from auth.users u
where not exists (select 1 from profiles p where p.id = u.id)
order by u.created_at desc;

-- 3. Everything that exists, at a glance.
select (select count(*) from businesses) as businesses,
       (select count(*) from profiles)   as profiles,
       (select count(*) from auth.users) as logins,
       (select count(*) from sales)      as sales;

-- ---------------------------------------------------------------------------
-- THE CLEAN UP. Read the lists above first. These cannot be undone.
--
-- Remove businesses that have no login left (and with them their branches, products, stock and sales):
-- delete from businesses b where not exists (select 1 from profiles p where p.business_id = b.id);
--
-- Remove logins that have no business (this frees the email address to sign up again):
-- delete from auth.users u where not exists (select 1 from profiles p where p.id = u.id);
--
-- Remove one business by name, logins and all:
-- delete from auth.users u where u.id in (select p.id from profiles p join businesses b on b.id = p.business_id where b.name = 'PUT THE NAME HERE');
-- delete from businesses where name = 'PUT THE NAME HERE';

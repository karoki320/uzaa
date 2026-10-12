-- Uzaa setup check. Paste into the Supabase SQL editor and press Run.
-- Every row should say OK. Anything that says MISSING means apply-all.sql has not been run.
select 'patch 3: product units'   as item, case when exists (select 1 from information_schema.columns where table_name='products' and column_name='unit') then 'OK' else 'MISSING' end as state
union all select 'patch 4: offline sales', case when exists (select 1 from information_schema.columns where table_name='sales' and column_name='client_id') then 'OK' else 'MISSING' end
union all select 'patch 5: credit sales', case when exists (select 1 from information_schema.tables where table_name='customers') then 'OK' else 'MISSING' end
union all select 'patch 6: terms column', case when exists (select 1 from information_schema.columns where table_name='profiles' and column_name='terms_accepted_at') then 'OK' else 'MISSING' end
union all select 'patch 6: accept_terms()', case when exists (select 1 from pg_proc where proname='accept_terms') then 'OK' else 'MISSING' end
union all select 'patch 6: sales role allowed', case when (select pg_get_constraintdef(oid) from pg_constraint where conname='profiles_role_check') like '%sales%' then 'OK' else 'MISSING' end
union all select 'patch 7: phone alerts', case when exists (select 1 from information_schema.tables where table_name='push_subscriptions') then 'OK' else 'MISSING' end
union all select 'patch 8: proprietor phone', case when exists (select 1 from information_schema.columns where table_name='businesses' and column_name='owner_phone') then 'OK' else 'MISSING' end;

-- Your own account. role should be owner (or super_admin), active true, and the business status active.
select p.email, p.role, p.active, p.business_id, b.name as business, b.status
from profiles p left join businesses b on b.id = p.business_id
order by p.created_at desc limit 20;

-- Any business that is not active cannot be used until you set it back.
-- select id, name, status from businesses where status <> 'active';
-- update businesses set status = 'active' where id = 'PUT-THE-ID-HERE';

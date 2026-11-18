-- Patch 20: weekly billing, the Uzaa price list and a free trial for businesses that sign themselves up.
-- Safe to run twice. Run after security-patch-19.sql (or run apply-all.sql).
--  * subscriptions.period can now be 'week' (7 days).
--  * subscriptions.plan_code: 'standard' = on the published price list (KES 250/week, 900/month,
--    2,500/quarter); the owner can switch between week, month and quarter. Empty = priced by hand.
--  * subscriptions.trial_ends: the last day of a free trial; cleared by the first payment.

alter table subscriptions drop constraint if exists subscriptions_period_check;
alter table subscriptions drop constraint if exists subscriptions_period_chk;
alter table subscriptions add constraint subscriptions_period_chk check (period in ('week','month','quarter','year'));
alter table subscriptions add column if not exists plan_code text not null default '';
alter table subscriptions add column if not exists trial_ends date;

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
  step := case s.period when 'week' then interval '7 days' when 'quarter' then interval '3 months'
                        when 'year' then interval '1 year' else interval '1 month' end;
  -- Paying during a free trial keeps the trial days: the paid period starts when the trial ends.
  base := greatest(coalesce(s.paid_until, current_date), current_date, coalesce(s.start_date, current_date));
  till := (base + step)::date;
  update subscriptions set paid_until = till, setup_paid = setup_paid or p.includes_setup, trial_ends = null, updated_at = now()
    where business_id = p.business_id;
  update billing_payments set status = 'success', channel = left(coalesce(p_channel, ''), 40),
    paid_at = coalesce(p_paid_at, now()), covers_from = base, covers_to = till where id = p.id;
  update businesses set status = 'active' where id = p.business_id and status in ('pending', 'lapsed');
  return jsonb_build_object('ok', true, 'paid_until', till, 'business_id', p.business_id);
end $$;
revoke execute on function billing_apply(text, numeric, text, text, timestamptz) from public, anon, authenticated;
grant execute on function billing_apply(text, numeric, text, text, timestamptz) to service_role;

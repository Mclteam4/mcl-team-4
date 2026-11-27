-- =============================================================================
-- FICTIONAL DEMO NOTIFICATIONS — run after demo-data.sql and migration 0009:
--   npx supabase db query --remote=<project-ref> -f supabase/demo/demo-notifications.sql
--
-- Re-creates the past movements of the DEMO bills as notifications for BOTH
-- sides (raised by / raised to), exactly as the live system would have sent
-- them. All are marked "skipped" so no email is ever sent. Notices older than
-- three days are marked as read. Does nothing if already loaded.
-- =============================================================================
do $$
declare
  a record; b public.hospital_bills; v_status public.bill_status; v_old public.bill_status; v_actor text; n int := 0;
begin
  if exists (select 1 from public.notifications where details ->> 'demo' = 'true') then
    raise notice 'Demo notifications already loaded - nothing changed.';
    return;
  end if;

  for a in
    select l.* from public.audit_logs l
      join public.hospital_bills hb on hb.id = l.bill_id
      join public.hospitals h on h.id = hb.hospital_id
     where h.code in ('ABC-BBSR', 'SUN-CTC', 'GRN-SBP', 'RVS-ANG', 'LOT-KOL')
       and l.action in ('BILL_SUBMITTED', 'VERIFIED_BILL_SENT', 'QUERY_RAISED', 'FORWARDED_TO_FINANCE',
                        'FINANCE_APPROVE', 'FINANCE_PROCESS', 'FINANCE_COMPLETE', 'FINANCE_RETURN')
     order by l.at, l.id
  loop
    select * into b from public.hospital_bills where id = a.bill_id;
    v_status := case a.action
      when 'BILL_SUBMITTED' then 'SUBMITTED' when 'VERIFIED_BILL_SENT' then 'SENT_TO_HOSPITAL'
      when 'QUERY_RAISED' then 'QUERY_RAISED' when 'FORWARDED_TO_FINANCE' then 'PENDING_FINANCE'
      when 'FINANCE_APPROVE' then 'FINANCIALLY_APPROVED' when 'FINANCE_PROCESS' then 'PAYMENT_PROCESSED'
      when 'FINANCE_COMPLETE' then 'PAYMENT_COMPLETED' else 'FINANCE_RETURNED' end;
    v_old := case a.action
      when 'BILL_SUBMITTED' then 'DRAFT' when 'VERIFIED_BILL_SENT' then 'UNDER_VERIFICATION'
      when 'QUERY_RAISED' then 'SENT_TO_HOSPITAL' when 'FORWARDED_TO_FINANCE' then 'ACCEPTED'
      when 'FINANCE_APPROVE' then 'PENDING_FINANCE' when 'FINANCE_PROCESS' then 'FINANCIALLY_APPROVED'
      when 'FINANCE_COMPLETE' then 'PAYMENT_PROCESSED' else 'PENDING_FINANCE' end;
    -- person who acted: the audit label without its trailing "(role)"
    v_actor := nullif(regexp_replace(a.actor_label, '\s*\([^()]*\)$', ''), 'SYSTEM');
    if a.action = 'FORWARDED_TO_FINANCE' and b.forward_mode = 'ACCEPTED' then
      select nullif(regexp_replace(x.actor_label, '\s*\([^()]*\)$', ''), 'SYSTEM') into v_actor
        from public.audit_logs x where x.bill_id = b.id and x.action = 'HOSPITAL_ACCEPTED' order by x.at limit 1;
    end if;
    n := n + app.write_bill_notifications(b, v_status, v_old, coalesce(v_actor, 'System (automatic)'), a.at,
                                          'SKIPPED', jsonb_build_object('demo', true));
  end loop;

  update public.notifications set read_at = created_at + interval '1 day', email_error = 'Demo notice - never emailed'
   where details ->> 'demo' = 'true' and created_at < now() - interval '3 days';
  update public.notifications set email_error = 'Demo notice - never emailed'
   where details ->> 'demo' = 'true' and email_error is null;
  raise notice 'Demo notifications loaded: %', n;
end $$;

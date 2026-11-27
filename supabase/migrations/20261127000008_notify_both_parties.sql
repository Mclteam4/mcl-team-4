-- =============================================================================
-- 0008 Notify BOTH parties of every bill movement (in-app + email), quoting the
-- bill's unique reference number (tracking no.).
--
-- Example: a hospital submits a bill to the AMO of an Area -> the hospital's
-- users AND the AMO (plus any active delegate) each get a message quoting
-- MCL/BILL/2026/000123, who raised it and to whom it was raised.
--
-- One deferred trigger on hospital_bills.status now produces every workflow
-- notification. It runs at commit, after query / finance / audit rows exist.
-- The older one-sided notifications inside the workflow functions are switched
-- off below, so nobody receives duplicates. Deadline reminders are unchanged.
-- =============================================================================

alter table public.notifications add column details jsonb;

-- optional "connected email" for notifications (falls back to the login email)
alter table public.users add column notify_email text
  check (notify_email is null or notify_email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$');
grant update (notify_email) on public.users to authenticated;   -- admins only (users_admin_upd policy)

-- ---------------------------------------------------------------- switch off the old one-sided messages
create or replace function app.is_status_event(p_event text) returns boolean
language sql immutable as $$
  select p_event in ('BILL_RECEIVED', 'REVISION_REQUESTED', 'VERIFIED_BILL_RECEIVED', 'BILL_FORWARDED', 'QUERY_RAISED',
                     'PAYMENT_COMPLETED', 'FINANCE_RETURNED', 'PAYMENT_STATUS', 'CLARIFICATION_RECEIVED')
$$;

create or replace function app.notify_hospital(p_hospital uuid, p_event text, p_title text, p_body text, p_link text)
returns void language sql security definer set search_path = public as $$
  insert into public.notifications (user_id, event, title, body, link)
  select id, p_event, p_title, p_body, p_link from public.users
  where role = 'hospital' and hospital_id = p_hospital and active and not app.is_status_event(p_event)
$$;

create or replace function app.notify_amo(p_amo uuid, p_event text, p_title text, p_body text, p_link text)
returns void language sql security definer set search_path = public as $$
  insert into public.notifications (user_id, event, title, body, link)
  select x.uid, p_event, p_title, p_body, p_link
    from (select p_amo as uid
          union
          select m.delegate_user_id from public.amo_doctor_mapping m
           where m.amo_user_id = p_amo and current_date between m.valid_from and coalesce(m.valid_to, 'infinity'::date)) x
   where x.uid is not null and not app.is_status_event(p_event)
$$;

create or replace function app.notify_role(p_role public.app_role, p_event text, p_title text, p_body text, p_link text)
returns void language sql security definer set search_path = public as $$
  insert into public.notifications (user_id, event, title, body, link)
  select id, p_event, p_title, p_body, p_link from public.users
  where role = p_role and active and not app.is_status_event(p_event)
$$;

-- ---------------------------------------------------------------- who belongs to each party of a bill
create or replace function app.party_users(p_party text, p_hospital uuid, p_amo uuid) returns table (user_id uuid)
language sql stable security definer set search_path = public as $$
  select u.id from public.users u
   where p_party = 'HOSPITAL' and u.role = 'hospital' and u.hospital_id = p_hospital and u.active
  union
  select u.id from public.users u where p_party = 'AMO' and u.id = p_amo and u.active
  union
  select m.delegate_user_id from public.amo_doctor_mapping m
   where p_party = 'AMO' and m.amo_user_id = p_amo
     and current_date between m.valid_from and coalesce(m.valid_to, 'infinity'::date)
  union
  select u.id from public.users u where p_party = 'FINANCE' and u.role = 'finance' and u.active
$$;

-- ---------------------------------------------------------------- one message per movement, to both sides
create or replace function app.on_bill_status_change() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  inr constant text := 'FM99,99,99,990.00';
  v_hosp text; v_area text; v_ref text; v_amo text; v_actor text;
  f public.finance_processing; pay public.payment_records;
  v_event text; v_title text; v_note text; v_amount numeric;
  v_from text; v_to text[]; v_label jsonb; v_to_label text; v_details jsonb; v_body text;
begin
  select h.name into v_hosp from public.hospitals h where h.id = new.hospital_id;
  select r.referral_no, a.name into v_ref, v_area
    from public.patient_referrals r left join public.areas a on a.id = r.area_id where r.id = new.referral_id;
  select u.full_name into v_amo from public.users u where u.id = new.amo_id;
  -- the person who acted (the party label below already names their office)
  select coalesce((select u.full_name from public.users u where u.id = auth.uid()), 'System (automatic)') into v_actor;
  select * into f from public.finance_processing where bill_id = new.id;
  if f.id is not null then
    select * into pay from public.payment_records where finance_id = f.id order by created_at desc limit 1;
  end if;

  if new.status = 'SUBMITTED' then
    v_event := 'BILL_SUBMITTED'; v_from := 'HOSPITAL'; v_to := array['AMO']; v_amount := new.total_claimed;
    v_title := case when old.status = 'REVISION_REQUESTED' then 'Revised bill submitted for verification'
                    else 'New bill submitted for verification' end;
  elsif new.status = 'REVISION_REQUESTED' then
    v_event := 'REVISION_REQUESTED'; v_from := 'AMO'; v_to := array['HOSPITAL']; v_amount := new.total_claimed;
    v_title := 'Bill returned to hospital for revision';
    select a.new_data ->> 'reason' into v_note from public.audit_logs a
     where a.bill_id = new.id and a.action = 'REVISION_REQUESTED' order by a.at desc, a.id desc limit 1;
  elsif new.status = 'SENT_TO_HOSPITAL' then
    v_event := 'VERIFIED_BILL_SENT'; v_from := 'AMO'; v_to := array['HOSPITAL']; v_amount := new.final_admissible;
    v_title := case when new.current_round > 1 then 'Revised verified bill (round ' || new.current_round || ') sent to hospital'
                    else 'Verified bill sent to hospital' end;
    v_note := 'Admissible Rs ' || to_char(coalesce(new.final_admissible, 0), inr) || ' of Rs ' || to_char(new.total_claimed, inr)
           || ' claimed. Accept or raise a query by '
           || coalesce(to_char(new.query_deadline at time zone 'Asia/Kolkata', 'DD-Mon-YYYY HH24:MI') || ' IST', 'the deadline') || '.';
  elsif new.status = 'QUERY_RAISED' then
    v_event := 'QUERY_RAISED'; v_from := 'HOSPITAL'; v_to := array['AMO']; v_amount := new.final_admissible;
    v_title := 'Query raised by hospital on verified bill';
    select count(*) || ' item(s) queried' into v_note from public.hospital_queries q where q.bill_id = new.id and q.status = 'OPEN';
  elsif new.status = 'PENDING_FINANCE' and old.status = 'FINANCE_RETURNED' then
    v_event := 'CLARIFICATION_SENT'; v_from := 'HOSPITAL'; v_to := array['FINANCE']; v_amount := new.final_admissible;
    v_title := 'Hospital clarification sent to Finance';
  elsif new.status = 'PENDING_FINANCE' then
    v_event := 'FORWARDED_TO_FINANCE'; v_amount := new.final_admissible;
    if new.forward_mode = 'DEEMED' then
      v_from := 'SYSTEM'; v_to := array['HOSPITAL', 'AMO', 'FINANCE'];
      v_title := 'No query within the query period - bill forwarded to Finance';
    else
      v_from := 'HOSPITAL'; v_to := array['AMO', 'FINANCE'];
      v_title := 'Verified bill accepted by hospital and forwarded to Finance';
    end if;
  elsif new.status = 'FINANCE_RETURNED' then
    v_event := 'FINANCE_RETURNED'; v_from := 'FINANCE'; v_to := array[coalesce(f.return_target, 'AMO')];
    v_amount := new.final_admissible; v_title := 'Bill returned by Finance for clarification'; v_note := f.return_reason;
  elsif new.status = 'FINANCIALLY_APPROVED' then
    v_event := 'FINANCIALLY_APPROVED'; v_from := 'FINANCE'; v_to := array['HOSPITAL', 'AMO']; v_amount := f.sanctioned_amount;
    v_title := 'Bill financially approved';
    v_note := 'Sanctioned Rs ' || to_char(coalesce(f.sanctioned_amount, 0), inr) || '.';
  elsif new.status = 'PAYMENT_PROCESSED' then
    v_event := 'PAYMENT_PROCESSED'; v_from := 'FINANCE'; v_to := array['HOSPITAL', 'AMO']; v_amount := f.sanctioned_amount;
    v_title := 'Payment processed';
    v_note := 'Voucher ' || coalesce(pay.voucher_no, '-') || ', SAP document ' || coalesce(pay.sap_doc_no, '-') || '.';
  elsif new.status = 'PAYMENT_COMPLETED' then
    v_event := 'PAYMENT_COMPLETED'; v_from := 'FINANCE'; v_to := array['HOSPITAL', 'AMO'];
    v_amount := coalesce(pay.amount, f.sanctioned_amount); v_title := 'Payment completed';
    v_note := 'Paid on ' || coalesce(to_char(pay.payment_date, 'DD-Mon-YYYY'), '-')
           || ' (SAP document ' || coalesce(pay.sap_doc_no, '-') || ').';
  else
    return null;   -- verification started / accepted / deemed accepted are intermediate: no message
  end if;

  v_label := jsonb_build_object(
    'HOSPITAL', coalesce(v_hosp, 'Hospital'),
    'AMO', coalesce(v_amo, 'AMO') || ' (AMO, ' || coalesce(v_area, 'Area not set') || ')',
    'FINANCE', 'Finance Department, MCL',
    'SYSTEM', 'System (automatic)');
  select string_agg(v_label ->> t.party, ', ') into v_to_label from unnest(v_to) as t(party);

  v_details := jsonb_build_object(
    'reference', new.tracking_no, 'event', v_title, 'referral', v_ref, 'hospital', v_hosp,
    'hospital_bill_no', new.hospital_bill_no, 'amo', v_amo, 'area', v_area,
    'raised_by', case when v_from = 'SYSTEM' then 'System (automatic)' else v_actor end,
    'raised_by_party', v_label ->> v_from, 'raised_to', v_to_label,
    'amount', v_amount, 'note', v_note, 'at', now());
  v_body := 'Ref ' || new.tracking_no || ' | ' || (v_label ->> v_from) || ' -> ' || v_to_label
         || case when v_amount is not null then ' | Rs ' || to_char(v_amount, inr) else '' end
         || case when v_note is not null then ' | ' || v_note else '' end;

  insert into public.notifications (user_id, event, title, body, link, details)
  select distinct on (x.user_id) x.user_id, v_event, v_title || ' - ' || new.tracking_no, v_body, '/bills/' || new.id,
         v_details || jsonb_build_object('your_side', x.side)
    from (select pu.user_id, 'raised_by' as side, 1 as ord
            from app.party_users(v_from, new.hospital_id, new.amo_id) pu where v_from <> 'SYSTEM'
          union all
          select pu.user_id, 'raised_to', 2
            from unnest(v_to) as t(party) cross join lateral app.party_users(t.party, new.hospital_id, new.amo_id) pu) x
   where x.user_id is not null
   order by x.user_id, x.ord;
  return null;
end $$;

create constraint trigger bills_status_notify
  after update of status on public.hospital_bills
  deferrable initially deferred
  for each row when (old.status is distinct from new.status)
  execute function app.on_bill_status_change();

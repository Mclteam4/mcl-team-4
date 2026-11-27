-- =============================================================================
-- 0009 Notifications tab
--  * Administrators may read every notification (monitor view, read-only).
--  * The "notify both parties" logic from 0008 moves into a reusable builder,
--    app.write_bill_notifications(), so the status trigger and the demo-data
--    loader produce exactly the same messages. Behaviour of the trigger is unchanged.
-- =============================================================================

create policy notif_admin_read on public.notifications for select to authenticated
  using (app.has_role('admin'));

create or replace function app.write_bill_notifications(
  p_bill public.hospital_bills, p_status public.bill_status, p_old_status public.bill_status,
  p_actor text, p_at timestamptz, p_email_status text default 'PENDING', p_extra jsonb default '{}'::jsonb)
returns integer language plpgsql security definer set search_path = public as $$
declare
  inr constant text := 'FM99,99,99,990.00';
  v_hosp text; v_area text; v_ref text; v_amo text;
  f public.finance_processing; pay public.payment_records;
  v_event text; v_title text; v_note text; v_amount numeric;
  v_from text; v_to text[]; v_label jsonb; v_to_label text; v_details jsonb; v_body text; n int;
begin
  select h.name into v_hosp from public.hospitals h where h.id = p_bill.hospital_id;
  select r.referral_no, a.name into v_ref, v_area
    from public.patient_referrals r left join public.areas a on a.id = r.area_id where r.id = p_bill.referral_id;
  select u.full_name into v_amo from public.users u where u.id = p_bill.amo_id;
  select * into f from public.finance_processing where bill_id = p_bill.id;
  if f.id is not null then
    select * into pay from public.payment_records where finance_id = f.id order by created_at desc limit 1;
  end if;

  if p_status = 'SUBMITTED' then
    v_event := 'BILL_SUBMITTED'; v_from := 'HOSPITAL'; v_to := array['AMO']; v_amount := p_bill.total_claimed;
    v_title := case when p_old_status = 'REVISION_REQUESTED' then 'Revised bill submitted for verification'
                    else 'New bill submitted for verification' end;
  elsif p_status = 'REVISION_REQUESTED' then
    v_event := 'REVISION_REQUESTED'; v_from := 'AMO'; v_to := array['HOSPITAL']; v_amount := p_bill.total_claimed;
    v_title := 'Bill returned to hospital for revision';
    select a.new_data ->> 'reason' into v_note from public.audit_logs a
     where a.bill_id = p_bill.id and a.action = 'REVISION_REQUESTED' order by a.at desc, a.id desc limit 1;
  elsif p_status = 'SENT_TO_HOSPITAL' then
    v_event := 'VERIFIED_BILL_SENT'; v_from := 'AMO'; v_to := array['HOSPITAL']; v_amount := p_bill.final_admissible;
    v_title := case when p_bill.current_round > 1 then 'Revised verified bill (round ' || p_bill.current_round || ') sent to hospital'
                    else 'Verified bill sent to hospital' end;
    v_note := 'Admissible Rs ' || to_char(coalesce(p_bill.final_admissible, 0), inr) || ' of Rs ' || to_char(p_bill.total_claimed, inr)
           || ' claimed. Accept or raise a query by '
           || coalesce(to_char(p_bill.query_deadline at time zone 'Asia/Kolkata', 'DD-Mon-YYYY HH24:MI') || ' IST', 'the deadline') || '.';
  elsif p_status = 'QUERY_RAISED' then
    v_event := 'QUERY_RAISED'; v_from := 'HOSPITAL'; v_to := array['AMO']; v_amount := p_bill.final_admissible;
    v_title := 'Query raised by hospital on verified bill';
    select count(*) || ' item(s) queried' into v_note from public.hospital_queries q where q.bill_id = p_bill.id and q.status = 'OPEN';
  elsif p_status = 'PENDING_FINANCE' and p_old_status = 'FINANCE_RETURNED' then
    v_event := 'CLARIFICATION_SENT'; v_from := 'HOSPITAL'; v_to := array['FINANCE']; v_amount := p_bill.final_admissible;
    v_title := 'Hospital clarification sent to Finance';
  elsif p_status = 'PENDING_FINANCE' then
    v_event := 'FORWARDED_TO_FINANCE'; v_amount := p_bill.final_admissible;
    if p_bill.forward_mode = 'DEEMED' then
      v_from := 'SYSTEM'; v_to := array['HOSPITAL', 'AMO', 'FINANCE'];
      v_title := 'No query within the query period - bill forwarded to Finance';
    else
      v_from := 'HOSPITAL'; v_to := array['AMO', 'FINANCE'];
      v_title := 'Verified bill accepted by hospital and forwarded to Finance';
    end if;
  elsif p_status = 'FINANCE_RETURNED' then
    v_event := 'FINANCE_RETURNED'; v_from := 'FINANCE'; v_to := array[coalesce(f.return_target, 'AMO')];
    v_amount := p_bill.final_admissible; v_title := 'Bill returned by Finance for clarification'; v_note := f.return_reason;
  elsif p_status = 'FINANCIALLY_APPROVED' then
    v_event := 'FINANCIALLY_APPROVED'; v_from := 'FINANCE'; v_to := array['HOSPITAL', 'AMO']; v_amount := f.sanctioned_amount;
    v_title := 'Bill financially approved';
    v_note := 'Sanctioned Rs ' || to_char(coalesce(f.sanctioned_amount, 0), inr) || '.';
  elsif p_status = 'PAYMENT_PROCESSED' then
    v_event := 'PAYMENT_PROCESSED'; v_from := 'FINANCE'; v_to := array['HOSPITAL', 'AMO']; v_amount := f.sanctioned_amount;
    v_title := 'Payment processed';
    v_note := 'Voucher ' || coalesce(pay.voucher_no, '-') || ', SAP document ' || coalesce(pay.sap_doc_no, '-') || '.';
  elsif p_status = 'PAYMENT_COMPLETED' then
    v_event := 'PAYMENT_COMPLETED'; v_from := 'FINANCE'; v_to := array['HOSPITAL', 'AMO'];
    v_amount := coalesce(pay.amount, f.sanctioned_amount); v_title := 'Payment completed';
    v_note := 'Paid on ' || coalesce(to_char(pay.payment_date, 'DD-Mon-YYYY'), '-')
           || ' (SAP document ' || coalesce(pay.sap_doc_no, '-') || ').';
  else
    return 0;   -- verification started / accepted / deemed accepted are intermediate: no message
  end if;

  v_label := jsonb_build_object(
    'HOSPITAL', coalesce(v_hosp, 'Hospital'),
    'AMO', coalesce(v_amo, 'AMO') || ' (AMO, ' || coalesce(v_area, 'Area not set') || ')',
    'FINANCE', 'Finance Department, MCL',
    'SYSTEM', 'System (automatic)');
  select string_agg(v_label ->> t.party, ', ') into v_to_label from unnest(v_to) as t(party);

  v_details := jsonb_build_object(
    'reference', p_bill.tracking_no, 'event', v_title, 'referral', v_ref, 'hospital', v_hosp,
    'hospital_bill_no', p_bill.hospital_bill_no, 'amo', v_amo, 'area', v_area,
    'raised_by', case when v_from = 'SYSTEM' then 'System (automatic)' else coalesce(p_actor, 'System (automatic)') end,
    'raised_by_party', v_label ->> v_from, 'raised_to', v_to_label,
    'amount', v_amount, 'note', v_note, 'at', p_at);
  v_body := 'Ref ' || p_bill.tracking_no || ' | ' || (v_label ->> v_from) || ' -> ' || v_to_label
         || case when v_amount is not null then ' | Rs ' || to_char(v_amount, inr) else '' end
         || case when v_note is not null then ' | ' || v_note else '' end;

  insert into public.notifications (user_id, event, title, body, link, details, created_at, email_status)
  select distinct on (x.user_id) x.user_id, v_event, v_title || ' - ' || p_bill.tracking_no, v_body, '/bills/' || p_bill.id,
         v_details || jsonb_build_object('your_side', x.side) || coalesce(p_extra, '{}'::jsonb), p_at, p_email_status
    from (select pu.user_id, 'raised_by' as side, 1 as ord
            from app.party_users(v_from, p_bill.hospital_id, p_bill.amo_id) pu where v_from <> 'SYSTEM'
          union all
          select pu.user_id, 'raised_to', 2
            from unnest(v_to) as t(party) cross join lateral app.party_users(t.party, p_bill.hospital_id, p_bill.amo_id) pu) x
   where x.user_id is not null
   order by x.user_id, x.ord;
  get diagnostics n = row_count;
  return n;
end $$;

-- the status trigger (created in 0008) now simply calls the builder
create or replace function app.on_bill_status_change() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform app.write_bill_notifications(new, new.status, old.status,
    coalesce((select u.full_name from public.users u where u.id = auth.uid()), 'System (automatic)'), now());
  return null;
end $$;

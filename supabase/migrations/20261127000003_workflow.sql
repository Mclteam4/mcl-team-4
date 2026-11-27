-- =============================================================================
-- 0003 Workflow state machine — every status transition is one of these RPCs.
-- Each RPC: checks caller role & ownership → checks current status → writes
-- change → writes audit_logs → writes notifications, all in one transaction.
-- =============================================================================

-- ---------------------------------------------------------------- internal helpers
create or replace function app.log(p_bill uuid, p_action text, p_data jsonb default null, p_actor uuid default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  insert into public.audit_logs (actor_id, actor_label, entity, entity_id, bill_id, action, new_data)
  values (coalesce(p_actor, auth.uid()),
          coalesce((select full_name || ' (' || role || ')' from public.users where id = coalesce(p_actor, auth.uid())), 'SYSTEM'),
          'hospital_bills', p_bill, p_bill, p_action, p_data);
end $$;

create or replace function app.notify(p_user uuid, p_event text, p_title text, p_body text, p_link text)
returns void language sql security definer set search_path = public as $$
  insert into public.notifications (user_id, event, title, body, link)
  select p_user, p_event, p_title, p_body, p_link where p_user is not null
$$;

create or replace function app.notify_hospital(p_hospital uuid, p_event text, p_title text, p_body text, p_link text)
returns void language sql security definer set search_path = public as $$
  insert into public.notifications (user_id, event, title, body, link)
  select id, p_event, p_title, p_body, p_link from public.users
  where role = 'hospital' and hospital_id = p_hospital and active
$$;

create or replace function app.notify_amo(p_amo uuid, p_event text, p_title text, p_body text, p_link text)
returns void language sql security definer set search_path = public as $$
  insert into public.notifications (user_id, event, title, body, link)
  select p_amo, p_event, p_title, p_body, p_link
  union
  select m.delegate_user_id, p_event, p_title, p_body, p_link from public.amo_doctor_mapping m
  where m.amo_user_id = p_amo and current_date between m.valid_from and coalesce(m.valid_to, 'infinity'::date)
$$;

create or replace function app.notify_role(p_role public.app_role, p_event text, p_title text, p_body text, p_link text)
returns void language sql security definer set search_path = public as $$
  insert into public.notifications (user_id, event, title, body, link)
  select id, p_event, p_title, p_body, p_link from public.users where role = p_role and active
$$;

create or replace function app.setting(p_key text) returns jsonb
language sql stable security definer set search_path = public as $$
  select value from public.system_settings where key = p_key
$$;

-- deadline = 23:59:59 (local tz) on the Nth calendar day after the sending date
create or replace function app.compute_deadline(p_from timestamptz, p_days int) returns timestamptz
language sql stable as $$
  select ((((p_from at time zone tz)::date + p_days + 1)::timestamp) at time zone tz) - interval '1 second'
  from (select coalesce(app.setting('deadline_timezone') #>> '{}', 'Asia/Kolkata') as tz) s
$$;

create or replace function app.acts_for_amo_as(p_actor uuid, p_amo uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.users u where u.id = p_actor and u.role = 'amo' and u.active)
     and (p_actor = p_amo or exists (
           select 1 from public.amo_doctor_mapping m
           where m.amo_user_id = p_amo and m.delegate_user_id = p_actor
             and current_date between m.valid_from and coalesce(m.valid_to, 'infinity'::date)))
$$;

create or replace function app.bill_for_update(p_bill uuid) returns public.hospital_bills
language plpgsql security definer set search_path = public as $$
declare b public.hospital_bills;
begin
  select * into b from public.hospital_bills where id = p_bill for update;
  if not found then raise exception 'Bill not found' using errcode = 'P0002'; end if;
  return b;
end $$;

-- ---------------------------------------------------------------- tracking number
create or replace function app.assign_tracking_no() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.tracking_no is null or new.tracking_no = '' then
    new.tracking_no := 'MCL/BILL/' || to_char(now() at time zone 'Asia/Kolkata', 'YYYY') || '/'
                       || lpad(nextval('public.bill_tracking_seq')::text, 6, '0');
  end if;
  return new;
end $$;
create trigger bills_tracking before insert on public.hospital_bills
  for each row execute function app.assign_tracking_no();
alter table public.hospital_bills alter column tracking_no set default '';

-- ---------------------------------------------------------------- HOSPITAL: submit bill
create or replace function public.rpc_submit_bill(p_bill uuid) returns void
language plpgsql security definer set search_path = public as $$
declare b public.hospital_bills; n int; items jsonb;
begin
  b := app.bill_for_update(p_bill);
  if app.current_role() <> 'hospital' or b.hospital_id <> app.current_hospital() then
    raise exception 'Not authorised' using errcode = '42501';
  end if;
  if b.status not in ('DRAFT', 'REVISION_REQUESTED') then
    raise exception 'Bill cannot be submitted from status %', b.status;
  end if;
  select count(*), jsonb_agg(to_jsonb(i) order by line_no) into n, items
    from public.hospital_bill_items i where bill_id = p_bill;
  if n = 0 then raise exception 'Bill has no items'; end if;
  if not exists (select 1 from public.supporting_documents where bill_id = p_bill and doc_type = 'FINAL_BILL') then
    raise exception 'Upload the final hospital bill before submitting';
  end if;

  update public.hospital_bills set status = 'SUBMITTED', submitted_at = now(),
         version = case when b.status = 'REVISION_REQUESTED' then version + 1 else version end
   where id = p_bill;
  perform app.log(p_bill, case when b.status = 'DRAFT' then 'BILL_SUBMITTED' else 'BILL_RESUBMITTED' end,
                  jsonb_build_object('total_claimed', b.total_claimed, 'items', items));
  perform app.notify_amo(b.amo_id, 'BILL_RECEIVED', 'New bill for verification',
          b.tracking_no || ' — claimed ₹' || to_char(b.total_claimed, 'FM99,99,99,990.00'), '/amo/bills/' || p_bill);
end $$;

-- ---------------------------------------------------------------- AMO: ask hospital to correct the bill itself
create or replace function public.rpc_request_revision(p_bill uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare b public.hospital_bills;
begin
  b := app.bill_for_update(p_bill);
  if not app.acts_for_amo(b.amo_id) then raise exception 'Not authorised' using errcode = '42501'; end if;
  if b.status not in ('SUBMITTED', 'UNDER_VERIFICATION') then raise exception 'Cannot request revision from %', b.status; end if;
  if length(trim(coalesce(p_reason, ''))) < 5 then raise exception 'Reason is required'; end if;
  delete from public.bill_verification where bill_id = p_bill and status = 'DRAFT';   -- stale draft
  update public.hospital_bills set status = 'REVISION_REQUESTED',
         current_round = (select coalesce(max(round_no), 0) from public.bill_verification where bill_id = p_bill)
   where id = p_bill;
  perform app.log(p_bill, 'REVISION_REQUESTED', jsonb_build_object('reason', p_reason));
  perform app.notify_hospital(b.hospital_id, 'REVISION_REQUESTED', 'Bill revision requested',
          b.tracking_no || ': ' || p_reason, '/hospital/bills/' || p_bill);
end $$;

-- ---------------------------------------------------------------- SERVER ENGINE: create verification round
-- Called only by the Next.js server (service_role) after it has run the TypeScript
-- CGHS engine. p_items: [{bill_item_id, rate_id, suggested_rate_id, match_status, match_note,
-- cghs_rate, ceiling_amount, proposed_qty, proposed_rate}]
create or replace function public.rpc_create_round(p_bill uuid, p_actor uuid, p_snapshot jsonb, p_items jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare b public.hospital_bills; v_round int; v_id uuid; v_prev uuid;
begin
  b := app.bill_for_update(p_bill);
  if not app.acts_for_amo_as(p_actor, b.amo_id) then raise exception 'Not authorised' using errcode = '42501'; end if;
  if exists (select 1 from public.bill_verification where bill_id = p_bill and status = 'DRAFT') then
    raise exception 'A draft verification round already exists';
  end if;
  if b.status not in ('SUBMITTED', 'QUERY_RAISED', 'FINANCE_RETURNED') then
    raise exception 'Verification cannot start from status %', b.status;
  end if;
  if b.status = 'FINANCE_RETURNED' and
     (select return_target from public.finance_processing where bill_id = p_bill) <> 'AMO' then
    raise exception 'Bill was returned by Finance to the hospital, not the AMO';
  end if;

  select coalesce(max(round_no), 0) + 1 into v_round from public.bill_verification where bill_id = p_bill;
  select id into v_prev from public.bill_verification where bill_id = p_bill and status = 'SUBMITTED'
   order by round_no desc limit 1;

  insert into public.bill_verification (bill_id, round_no, amo_id, rule_snapshot, total_claimed)
  values (p_bill, v_round, p_actor, coalesce(p_snapshot, '{}'::jsonb), b.total_claimed)
  returning id into v_id;

  insert into public.bill_verification_items (verification_id, bill_item_id, rate_id, suggested_rate_id, match_status,
              match_note, cghs_rate, ceiling_amount, proposed_qty, proposed_rate, admissible_qty, admissible_rate)
  select v_id, x.bill_item_id, x.rate_id, x.suggested_rate_id, x.match_status, x.match_note, x.cghs_rate,
         x.ceiling_amount, x.proposed_qty, x.proposed_rate, x.proposed_qty, x.proposed_rate
    from jsonb_to_recordset(p_items) as x(bill_item_id uuid, rate_id uuid, suggested_rate_id uuid,
         match_status public.match_status, match_note text, cghs_rate numeric, ceiling_amount numeric,
         proposed_qty numeric, proposed_rate numeric)
    join public.hospital_bill_items i on i.id = x.bill_item_id and i.bill_id = p_bill;

  if (select count(*) from public.bill_verification_items where verification_id = v_id)
     <> (select count(*) from public.hospital_bill_items where bill_id = p_bill) then
    raise exception 'Engine output does not cover every bill item';
  end if;

  -- carry forward previous round decisions (AMO revises only what is needed)
  if v_prev is not null then
    update public.bill_verification_items n set
           decision = p.decision, admissible_qty = p.admissible_qty, admissible_rate = p.admissible_rate,
           remarks = p.remarks, suggestion_confirmed = p.suggestion_confirmed,
           decided_by = p.decided_by, decided_at = p.decided_at
      from public.bill_verification_items p
     where n.verification_id = v_id and p.verification_id = v_prev and p.bill_item_id = n.bill_item_id;
  end if;

  update public.hospital_bills set status = 'UNDER_VERIFICATION', current_round = v_round where id = p_bill;
  perform app.log(p_bill, 'VERIFICATION_ROUND_STARTED', jsonb_build_object('round', v_round, 'rules', p_snapshot), p_actor);
  return v_id;
end $$;

-- ---------------------------------------------------------------- AMO: bulk approve green items
create or replace function public.rpc_approve_green(p_verification uuid) returns int
language plpgsql security definer set search_path = public as $$
declare v public.bill_verification; n int;
begin
  select * into v from public.bill_verification where id = p_verification;
  if not found or v.status <> 'DRAFT' then raise exception 'Round not open'; end if;
  if not app.acts_for_amo((select amo_id from public.hospital_bills where id = v.bill_id)) then
    raise exception 'Not authorised' using errcode = '42501';
  end if;
  update public.bill_verification_items set decision = 'APPROVED', decided_by = auth.uid(), decided_at = now(),
         admissible_qty = proposed_qty, admissible_rate = proposed_rate
   where verification_id = p_verification and match_status = 'GREEN' and decision = 'PENDING';
  get diagnostics n = row_count;
  return n;
end $$;

-- ---------------------------------------------------------------- AMO: submit verified bill to hospital
create or replace function public.rpc_send_to_hospital(p_verification uuid, p_remarks text default null) returns timestamptz
language plpgsql security definer set search_path = public as $$
declare v public.bill_verification; b public.hospital_bills; d int; dl timestamptz; t record;
begin
  select * into v from public.bill_verification where id = p_verification for update;
  if not found then raise exception 'Round not found'; end if;
  b := app.bill_for_update(v.bill_id);
  if not app.acts_for_amo(b.amo_id) then raise exception 'Not authorised' using errcode = '42501'; end if;
  if v.status <> 'DRAFT' or b.status <> 'UNDER_VERIFICATION' then raise exception 'Round is not open for submission'; end if;
  if exists (select 1 from public.bill_verification_items where verification_id = v.id and decision = 'PENDING') then
    raise exception 'All items must be decided before submission';
  end if;

  -- server-side totals (never trust the client)
  select coalesce(sum(i.amount_claimed), 0)                                       as claimed,
         coalesce(sum(vi.admissible_amount), 0)                                    as admissible,
         count(*) filter (where vi.decision = 'APPROVED')                          as approved,
         count(*) filter (where vi.decision in ('MODIFIED', 'PARTIAL'))            as modified,
         count(*) filter (where vi.decision = 'DISALLOWED')                        as disallowed
    into t
    from public.bill_verification_items vi join public.hospital_bill_items i on i.id = vi.bill_item_id
   where vi.verification_id = v.id;

  if exists (select 1 from public.bill_verification_items vi join public.hospital_bill_items i on i.id = vi.bill_item_id
             where vi.verification_id = v.id and vi.admissible_amount > i.amount_claimed
               and length(trim(coalesce(vi.remarks, ''))) < 3) then
    raise exception 'Admissible amount above claimed amount needs a remark';
  end if;

  d  := coalesce((app.setting('query_period_days') #>> '{}')::int, 7);
  dl := app.compute_deadline(now(), d);

  update public.bill_verification set status = 'SUBMITTED', remarks = coalesce(p_remarks, remarks),
         total_claimed = t.claimed, total_admissible = t.admissible, total_disallowed = t.claimed - t.admissible,
         approved_count = t.approved, modified_count = t.modified, disallowed_count = t.disallowed,
         query_period_days = d, sent_at = now(), deadline = dl
   where id = v.id;
  update public.hospital_bills set status = 'SENT_TO_HOSPITAL', final_admissible = t.admissible,
         query_deadline = dl, sent_to_hospital_at = now()
   where id = b.id;
  -- queries of earlier rounds are now answered by this round
  update public.hospital_queries set status = case when status = 'OPEN' then 'REJECTED' else status end
   where bill_id = b.id and verification_id <> v.id and status = 'OPEN';

  perform app.log(b.id, 'VERIFIED_BILL_SENT', jsonb_build_object('round', v.round_no, 'claimed', t.claimed,
                  'admissible', t.admissible, 'deadline', dl, 'query_period_days', d));
  perform app.notify_hospital(b.hospital_id, 'VERIFIED_BILL_RECEIVED', 'Verified bill received',
          b.tracking_no || ' — admissible ₹' || to_char(t.admissible, 'FM99,99,99,990.00')
          || '. Accept or raise query by ' || to_char(dl at time zone 'Asia/Kolkata', 'DD-Mon-YYYY HH24:MI'),
          '/hospital/bills/' || b.id);
  return dl;
end $$;

-- ---------------------------------------------------------------- forward to finance (idempotent)
create or replace function app.forward_to_finance(p_bill uuid, p_mode text, p_actor uuid default null) returns boolean
language plpgsql security definer set search_path = public as $$
declare b public.hospital_bills; v_ver uuid; n int;
begin
  select * into b from public.hospital_bills where id = p_bill;
  select id into v_ver from public.bill_verification where bill_id = p_bill and status = 'SUBMITTED'
   order by round_no desc limit 1;

  insert into public.finance_processing (bill_id, verification_id, forward_mode, final_admissible)
  values (p_bill, v_ver, p_mode, b.final_admissible)
  on conflict (bill_id) do update
     set verification_id = excluded.verification_id, forward_mode = excluded.forward_mode,
         final_admissible = excluded.final_admissible, received_at = now(),
         status = 'PENDING_FINANCE_VERIFICATION', return_target = null, return_reason = null,
         sanctioned_amount = null, updated_at = now()
   where public.finance_processing.status = 'RETURNED_FOR_CLARIFICATION';
  get diagnostics n = row_count;
  if n = 0 then return false; end if;       -- already forwarded: no duplicate

  update public.hospital_bills set status = 'PENDING_FINANCE', forwarded_at = now(), forward_mode = p_mode where id = p_bill;
  perform app.log(p_bill, 'FORWARDED_TO_FINANCE', jsonb_build_object('mode', p_mode, 'final_admissible', b.final_admissible), p_actor);
  perform app.notify_role('finance', 'BILL_FORWARDED', 'Bill received for reimbursement',
          b.tracking_no || ' — ₹' || to_char(b.final_admissible, 'FM99,99,99,990.00')
          || case when p_mode = 'DEEMED' then ' (deemed accepted after query period)' else ' (accepted by hospital)' end,
          '/finance/bills/' || p_bill);
  perform app.notify_amo(b.amo_id, 'BILL_FORWARDED', 'Bill forwarded to Finance', b.tracking_no, '/amo/bills/' || p_bill);
  perform app.notify_hospital(b.hospital_id, 'BILL_FORWARDED', 'Bill forwarded to Finance', b.tracking_no, '/hospital/bills/' || p_bill);
  return true;
end $$;

-- ---------------------------------------------------------------- HOSPITAL: accept verified bill
create or replace function public.rpc_accept_bill(p_bill uuid) returns void
language plpgsql security definer set search_path = public as $$
declare b public.hospital_bills;
begin
  b := app.bill_for_update(p_bill);
  if app.current_role() <> 'hospital' or b.hospital_id <> app.current_hospital() then
    raise exception 'Not authorised' using errcode = '42501';
  end if;
  if b.status <> 'SENT_TO_HOSPITAL' then raise exception 'Bill is not awaiting acceptance (status %)', b.status; end if;
  update public.hospital_bills set status = 'ACCEPTED', accepted_at = now() where id = p_bill;
  perform app.log(p_bill, 'HOSPITAL_ACCEPTED', jsonb_build_object('final_admissible', b.final_admissible,
                  'within_deadline', now() <= b.query_deadline));
  perform app.forward_to_finance(p_bill, 'ACCEPTED');
end $$;

-- ---------------------------------------------------------------- HOSPITAL: raise item queries
-- p_queries: [{bill_item_id, query_type, reason}]  (bill_item_id null = general observation)
create or replace function public.rpc_raise_query(p_bill uuid, p_queries jsonb) returns setof uuid
language plpgsql security definer set search_path = public as $$
declare b public.hospital_bills; v_ver uuid;
begin
  b := app.bill_for_update(p_bill);
  if app.current_role() <> 'hospital' or b.hospital_id <> app.current_hospital() then
    raise exception 'Not authorised' using errcode = '42501';
  end if;
  if b.status <> 'SENT_TO_HOSPITAL' then raise exception 'Queries can only be raised on a verified bill'; end if;
  if now() > b.query_deadline then raise exception 'Query period expired on %', b.query_deadline; end if;
  if jsonb_array_length(coalesce(p_queries, '[]'::jsonb)) = 0 then raise exception 'At least one query is required'; end if;

  select id into v_ver from public.bill_verification where bill_id = p_bill and status = 'SUBMITTED'
   order by round_no desc limit 1;

  return query
  with ins as (
    insert into public.hospital_queries (bill_id, verification_id, bill_item_id, query_type, reason, raised_by)
    select p_bill, v_ver, x.bill_item_id, x.query_type, x.reason, auth.uid()
      from jsonb_to_recordset(p_queries) as x(bill_item_id uuid, query_type text, reason text)
     where x.bill_item_id is null
        or exists (select 1 from public.hospital_bill_items i where i.id = x.bill_item_id and i.bill_id = p_bill)
    returning id)
  select ins.id from ins;

  update public.hospital_bills set status = 'QUERY_RAISED' where id = p_bill;
  perform app.log(p_bill, 'QUERY_RAISED', jsonb_build_object('queries', p_queries));
  perform app.notify_amo(b.amo_id, 'QUERY_RAISED', 'Hospital raised a query',
          b.tracking_no || ' — ' || jsonb_array_length(p_queries) || ' item(s) queried', '/amo/bills/' || p_bill);
end $$;

-- ---------------------------------------------------------------- AMO: respond to a query
create or replace function public.rpc_respond_query(p_query uuid, p_type text, p_response text) returns void
language plpgsql security definer set search_path = public as $$
declare q public.hospital_queries; b public.hospital_bills;
begin
  select * into q from public.hospital_queries where id = p_query for update;
  if not found then raise exception 'Query not found'; end if;
  b := app.bill_for_update(q.bill_id);
  if not app.acts_for_amo(b.amo_id) then raise exception 'Not authorised' using errcode = '42501'; end if;
  if b.status not in ('QUERY_RAISED', 'UNDER_VERIFICATION') then raise exception 'Bill is not under query review'; end if;
  insert into public.query_responses (query_id, response_type, response, responded_by)
  values (p_query, p_type, p_response, auth.uid());
  update public.hospital_queries set status = p_type where id = p_query;
  perform app.log(b.id, 'QUERY_RESPONDED', jsonb_build_object('query_id', p_query, 'type', p_type, 'response', p_response));
end $$;

-- ---------------------------------------------------------------- FINANCE actions
-- p_action: SCRUTINY | APPROVE | PROCESS | COMPLETE | RETURN
create or replace function public.rpc_finance_action(p_bill uuid, p_action text, p_payload jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare b public.hospital_bills; f public.finance_processing; v_amt numeric; v_ded numeric;
begin
  if not app.has_role('finance') then raise exception 'Not authorised' using errcode = '42501'; end if;
  b := app.bill_for_update(p_bill);
  select * into f from public.finance_processing where bill_id = p_bill for update;
  if not found then raise exception 'Bill has not been forwarded to Finance'; end if;

  if p_action = 'SCRUTINY' then
    if f.status not in ('PENDING_FINANCE_VERIFICATION', 'FINANCIALLY_APPROVED') then raise exception 'Not editable now'; end if;
    update public.finance_processing set scrutiny_remarks = p_payload ->> 'remarks', processed_by = auth.uid(), updated_at = now()
     where id = f.id;

  elsif p_action = 'APPROVE' then
    if f.status <> 'PENDING_FINANCE_VERIFICATION' then raise exception 'Bill is not pending finance verification'; end if;
    v_amt := (p_payload ->> 'sanctioned_amount')::numeric;
    select coalesce(sum((d ->> 'amount')::numeric), 0) into v_ded from jsonb_array_elements(coalesce(p_payload -> 'deductions', '[]')) d;
    if v_amt is null or v_amt < 0 or v_amt > f.final_admissible then
      raise exception 'Sanctioned amount must be between 0 and the medically admissible amount %', f.final_admissible;
    end if;
    if v_amt + v_ded <> f.final_admissible and length(trim(coalesce(p_payload ->> 'remarks', ''))) < 5 then
      raise exception 'Remarks required when sanctioned amount + deductions differ from admissible amount';
    end if;
    update public.finance_processing set status = 'FINANCIALLY_APPROVED', sanctioned_amount = v_amt,
           deductions = coalesce(p_payload -> 'deductions', '[]'), approval_date = coalesce((p_payload ->> 'approval_date')::date, current_date),
           scrutiny_remarks = coalesce(p_payload ->> 'remarks', scrutiny_remarks), processed_by = auth.uid(), updated_at = now()
     where id = f.id;
    update public.hospital_bills set status = 'FINANCIALLY_APPROVED' where id = p_bill;

  elsif p_action = 'PROCESS' then
    if f.status <> 'FINANCIALLY_APPROVED' then raise exception 'Bill must be financially approved first'; end if;
    if coalesce(p_payload ->> 'voucher_no', '') = '' or coalesce(p_payload ->> 'sap_doc_no', '') = '' then
      raise exception 'Voucher number and SAP document number are required';
    end if;
    insert into public.payment_records (finance_id, voucher_no, sap_doc_no, amount, remarks, created_by)
    values (f.id, p_payload ->> 'voucher_no', p_payload ->> 'sap_doc_no', f.sanctioned_amount, p_payload ->> 'remarks', auth.uid());
    update public.finance_processing set status = 'PAYMENT_PROCESSED', processed_by = auth.uid(), updated_at = now() where id = f.id;
    update public.hospital_bills set status = 'PAYMENT_PROCESSED' where id = p_bill;

  elsif p_action = 'COMPLETE' then
    if f.status <> 'PAYMENT_PROCESSED' then raise exception 'Payment must be processed first'; end if;
    if (p_payload ->> 'payment_date') is null then raise exception 'Payment date is required'; end if;
    update public.payment_records set payment_date = (p_payload ->> 'payment_date')::date,
           remarks = coalesce(p_payload ->> 'remarks', remarks)
     where finance_id = f.id;
    update public.finance_processing set status = 'PAYMENT_COMPLETED', processed_by = auth.uid(), updated_at = now() where id = f.id;
    update public.hospital_bills set status = 'PAYMENT_COMPLETED' where id = p_bill;
    perform app.notify_hospital(b.hospital_id, 'PAYMENT_COMPLETED', 'Payment completed',
            b.tracking_no || ' — ₹' || to_char(f.sanctioned_amount, 'FM99,99,99,990.00') || ' paid on ' || (p_payload ->> 'payment_date'),
            '/hospital/bills/' || p_bill);
    perform app.notify_amo(b.amo_id, 'PAYMENT_COMPLETED', 'Payment completed', b.tracking_no, '/amo/bills/' || p_bill);

  elsif p_action = 'RETURN' then
    if f.status not in ('PENDING_FINANCE_VERIFICATION', 'FINANCIALLY_APPROVED') then raise exception 'Cannot return now'; end if;
    if (p_payload ->> 'target') not in ('AMO', 'HOSPITAL') or length(trim(coalesce(p_payload ->> 'reason', ''))) < 5 then
      raise exception 'Return target (AMO/HOSPITAL) and reason are required';
    end if;
    update public.finance_processing set status = 'RETURNED_FOR_CLARIFICATION', return_target = p_payload ->> 'target',
           return_reason = p_payload ->> 'reason', sanctioned_amount = null, processed_by = auth.uid(), updated_at = now()
     where id = f.id;
    update public.hospital_bills set status = 'FINANCE_RETURNED' where id = p_bill;
    if p_payload ->> 'target' = 'AMO' then
      perform app.notify_amo(b.amo_id, 'FINANCE_RETURNED', 'Finance returned bill for medical clarification',
              b.tracking_no || ': ' || (p_payload ->> 'reason'), '/amo/bills/' || p_bill);
    else
      perform app.notify_hospital(b.hospital_id, 'FINANCE_RETURNED', 'Finance requires clarification',
              b.tracking_no || ': ' || (p_payload ->> 'reason'), '/hospital/bills/' || p_bill);
    end if;
  else
    raise exception 'Unknown finance action %', p_action;
  end if;

  if p_action <> 'COMPLETE' and p_action <> 'SCRUTINY' and p_action <> 'RETURN' then
    perform app.notify_hospital(b.hospital_id, 'PAYMENT_STATUS', 'Payment status updated',
            b.tracking_no || ' — ' || p_action, '/hospital/bills/' || p_bill);
  end if;
  perform app.log(p_bill, 'FINANCE_' || p_action, p_payload);
end $$;

-- ---------------------------------------------------------------- HOSPITAL: answer a Finance document clarification
create or replace function public.rpc_hospital_clarify(p_bill uuid, p_note text) returns void
language plpgsql security definer set search_path = public as $$
declare b public.hospital_bills;
begin
  b := app.bill_for_update(p_bill);
  if app.current_role() <> 'hospital' or b.hospital_id <> app.current_hospital() then
    raise exception 'Not authorised' using errcode = '42501';
  end if;
  if b.status <> 'FINANCE_RETURNED'
     or (select return_target from public.finance_processing where bill_id = p_bill) <> 'HOSPITAL' then
    raise exception 'No Finance clarification pending with hospital';
  end if;
  update public.finance_processing set status = 'PENDING_FINANCE_VERIFICATION', updated_at = now(),
         scrutiny_remarks = coalesce(scrutiny_remarks || E'\n', '') || 'Hospital clarification: ' || p_note
   where bill_id = p_bill;
  update public.hospital_bills set status = 'PENDING_FINANCE' where id = p_bill;
  perform app.log(p_bill, 'HOSPITAL_CLARIFIED_TO_FINANCE', jsonb_build_object('note', p_note));
  perform app.notify_role('finance', 'CLARIFICATION_RECEIVED', 'Hospital clarification received', b.tracking_no, '/finance/bills/' || p_bill);
end $$;

-- ---------------------------------------------------------------- SCHEDULED: deemed acceptance & reminders
create or replace function public.job_forward_expired_bills() returns int
language plpgsql security definer set search_path = public as $$
declare r record; n int := 0;
begin
  for r in select id from public.hospital_bills
            where status = 'SENT_TO_HOSPITAL' and query_deadline < now()
            for update skip locked
  loop
    update public.hospital_bills set status = 'DEEMED_ACCEPTED', accepted_at = now()
     where id = r.id and status = 'SENT_TO_HOSPITAL';
    perform app.log(r.id, 'DEEMED_ACCEPTED_NO_QUERY', jsonb_build_object('at', now()), null);
    if app.forward_to_finance(r.id, 'DEEMED', null) then n := n + 1; end if;
  end loop;
  return n;
end $$;

create or replace function public.job_send_deadline_reminders() returns int
language plpgsql security definer set search_path = public as $$
declare r record; n int := 0;
begin
  perform set_config('app.allow_round_finalise', 'on', true);
  for r in select v.id, v.deadline, v.reminder_48h_sent, v.reminder_24h_sent, b.id as bill_id, b.hospital_id, b.tracking_no
             from public.bill_verification v join public.hospital_bills b on b.id = v.bill_id
            where b.status = 'SENT_TO_HOSPITAL' and v.status = 'SUBMITTED' and v.round_no = b.current_round
              and v.deadline > now() and v.deadline - now() <= interval '48 hours'
              and (not v.reminder_48h_sent or (not v.reminder_24h_sent and v.deadline - now() <= interval '24 hours'))
  loop
    perform app.notify_hospital(r.hospital_id, 'QUERY_DEADLINE_NEAR', 'Query deadline approaching',
            r.tracking_no || ' — accept or raise query before ' || to_char(r.deadline at time zone 'Asia/Kolkata', 'DD-Mon-YYYY HH24:MI'),
            '/hospital/bills/' || r.bill_id);
    update public.bill_verification set reminder_48h_sent = true,
           reminder_24h_sent = reminder_24h_sent or (r.deadline - now() <= interval '24 hours')
     where id = r.id;
    n := n + 1;
  end loop;
  return n;
end $$;

-- ---------------------------------------------------------------- privileges
revoke all on function public.rpc_create_round(uuid, uuid, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.rpc_create_round(uuid, uuid, jsonb, jsonb) to service_role;
revoke all on function public.job_forward_expired_bills() from public, anon, authenticated;
revoke all on function public.job_send_deadline_reminders() from public, anon, authenticated;
grant execute on function public.job_forward_expired_bills(), public.job_send_deadline_reminders() to service_role;

grant execute on function public.rpc_submit_bill(uuid), public.rpc_request_revision(uuid, text),
  public.rpc_approve_green(uuid), public.rpc_send_to_hospital(uuid, text), public.rpc_accept_bill(uuid),
  public.rpc_raise_query(uuid, jsonb), public.rpc_respond_query(uuid, text, text),
  public.rpc_finance_action(uuid, text, jsonb), public.rpc_hospital_clarify(uuid, text) to authenticated;
revoke execute on function public.rpc_submit_bill(uuid), public.rpc_request_revision(uuid, text),
  public.rpc_approve_green(uuid), public.rpc_send_to_hospital(uuid, text), public.rpc_accept_bill(uuid),
  public.rpc_raise_query(uuid, jsonb), public.rpc_respond_query(uuid, text, text),
  public.rpc_finance_action(uuid, text, jsonb), public.rpc_hospital_clarify(uuid, text) from anon, public;
revoke all on all functions in schema app from public, anon;
grant execute on all functions in schema app to authenticated;

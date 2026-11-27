-- =============================================================================
-- 0005 Referral numbering + read views for dashboards, lists and global search.
-- Views are security_invoker: the caller's RLS applies to every underlying table.
-- =============================================================================

create sequence public.referral_seq;

create or replace function app.assign_referral_no() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.referral_no is null or new.referral_no = '' then
    new.referral_no := 'MCL/REF/' || to_char(now() at time zone 'Asia/Kolkata', 'YYYY') || '/'
                       || lpad(nextval('public.referral_seq')::text, 4, '0');
  end if;
  return new;
end $$;
create trigger referrals_no before insert on public.patient_referrals
  for each row execute function app.assign_referral_no();
alter table public.patient_referrals alter column referral_no set default '';

create view public.bill_overview with (security_invoker = true) as
select b.id, b.tracking_no, b.status, b.bill_type, b.hospital_bill_no, b.bill_date, b.version,
       b.total_claimed, b.total_medicine, b.total_procedure, b.total_investigation, b.total_room, b.total_other,
       b.final_admissible, b.query_deadline, b.submitted_at, b.sent_to_hospital_at, b.accepted_at,
       b.forwarded_at, b.forward_mode, b.current_round, b.created_at, b.updated_at,
       b.hospital_id, b.amo_id, b.referral_id,
       r.referral_no, r.admission_date, r.discharge_date, r.diagnosis, r.area_id,
       p.full_name  as patient_name, p.category as patient_category,
       e.employee_code, e.full_name as employee_name,
       a.name       as area_name,
       h.name       as hospital_name, h.city as hospital_city,
       ud.full_name as amo_name,
       f.status     as finance_status, f.sanctioned_amount, f.return_target, f.return_reason,
       pr.voucher_no, pr.sap_doc_no, pr.payment_date,
       lower(concat_ws(' ', b.tracking_no, r.referral_no, p.full_name, e.employee_code, e.full_name,
                       h.name, ud.full_name, pr.sap_doc_no, pr.voucher_no, b.hospital_bill_no)) as search_text
  from public.hospital_bills b
  left join public.patient_referrals r on r.id = b.referral_id
  left join public.patients p on p.id = r.patient_id
  left join public.employees e on e.id = r.employee_id
  left join public.areas a on a.id = r.area_id
  left join public.hospitals h on h.id = b.hospital_id
  left join public.user_directory ud on ud.id = b.amo_id
  left join public.finance_processing f on f.bill_id = b.id
  left join lateral (select voucher_no, sap_doc_no, payment_date from public.payment_records
                      where finance_id = f.id order by created_at desc limit 1) pr on true;

create view public.referral_overview with (security_invoker = true) as
select r.*, p.full_name as patient_name, p.category as patient_category, p.relationship,
       e.employee_code, e.full_name as employee_name, e.department,
       a.name as area_name, h.name as hospital_name, h.city as hospital_city,
       ud.full_name as amo_name, m.mou_no,
       (select count(*) from public.hospital_bills b where b.referral_id = r.id) as bill_count,
       lower(concat_ws(' ', r.referral_no, p.full_name, e.employee_code, e.full_name, h.name, ud.full_name)) as search_text
  from public.patient_referrals r
  left join public.patients p on p.id = r.patient_id
  left join public.employees e on e.id = r.employee_id
  left join public.areas a on a.id = r.area_id
  left join public.hospitals h on h.id = r.hospital_id
  left join public.user_directory ud on ud.id = r.referring_amo_id
  left join public.hospital_mou_details m on m.id = r.mou_id;

grant select on public.bill_overview, public.referral_overview to authenticated;

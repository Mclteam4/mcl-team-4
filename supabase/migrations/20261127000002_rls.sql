-- =============================================================================
-- 0002 Row Level Security, access helpers, column-level privileges, audit triggers
-- Principle: deny by default. Every table has RLS on. Workflow status changes are
-- only possible through SECURITY DEFINER RPCs (0003), never by direct UPDATE.
-- =============================================================================

-- ---------------------------------------------------------------- helpers (private schema)
create or replace function app.current_role() returns public.app_role
language sql stable security definer set search_path = public as $$
  select role from public.users where id = auth.uid() and active
$$;

create or replace function app.current_hospital() returns uuid
language sql stable security definer set search_path = public as $$
  select hospital_id from public.users where id = auth.uid() and active
$$;

create or replace function app.has_role(variadic roles public.app_role[]) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(app.current_role() = any(roles), false)
$$;

-- is the current user the given AMO, or an active delegate of that AMO?
create or replace function app.acts_for_amo(p_amo uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select app.current_role() = 'amo' and (
    p_amo = auth.uid() or exists (
      select 1 from public.amo_doctor_mapping m
      where m.amo_user_id = p_amo and m.delegate_user_id = auth.uid()
        and current_date between m.valid_from and coalesce(m.valid_to, 'infinity'::date)))
$$;

create or replace function app.finance_visible(p_status public.bill_status) returns boolean
language sql immutable as $$
  select p_status in ('PENDING_FINANCE', 'FINANCE_RETURNED', 'FINANCIALLY_APPROVED',
                      'PAYMENT_PROCESSED', 'PAYMENT_COMPLETED')
$$;

create or replace function app.can_read_bill(p_bill uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.hospital_bills b
    where b.id = p_bill and (
      app.has_role('admin', 'management')
      or (app.current_role() = 'hospital' and b.hospital_id = app.current_hospital())
      or app.acts_for_amo(b.amo_id)
      or (app.current_role() = 'finance' and app.finance_visible(b.status))))
$$;

create or replace function app.can_read_referral(p_ref uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.patient_referrals r
    where r.id = p_ref and (
      app.has_role('admin', 'management')
      or (app.current_role() = 'hospital' and r.hospital_id = app.current_hospital())
      or app.acts_for_amo(r.referring_amo_id)
      or (app.current_role() = 'amo' and r.area_id = (select area_id from public.users where id = auth.uid()))
      or (app.current_role() = 'finance' and exists (
            select 1 from public.hospital_bills b where b.referral_id = r.id and app.finance_visible(b.status)))))
$$;

create or replace function app.actor_label() returns text
language sql stable security definer set search_path = public as $$
  select coalesce((select full_name || ' (' || role || ')' from public.users where id = auth.uid()), 'SYSTEM')
$$;

grant usage on schema app to authenticated;
grant execute on all functions in schema app to authenticated;

-- ---------------------------------------------------------------- enable RLS everywhere
do $$
declare t text;
begin
  foreach t in array array['roles','areas','hospitals','hospital_mou_details','users','employees','patients',
    'amo_doctor_mapping','patient_referrals','cghs_rate_versions','cghs_rate_master','hospital_bills',
    'supporting_documents','hospital_bill_items','bill_verification','bill_verification_items',
    'hospital_queries','query_responses','finance_processing','payment_records','notifications',
    'audit_logs','system_settings']
  loop
    -- ENABLE (not FORCE): the table owner that runs SECURITY DEFINER workflow RPCs bypasses RLS;
    -- API roles (anon, authenticated) are always subject to it.
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
  end loop;
end $$;

-- ---------------------------------------------------------------- reference data
grant select on public.roles, public.areas, public.system_settings to authenticated;
create policy roles_read on public.roles for select to authenticated using (true);
create policy areas_read on public.areas for select to authenticated using (true);
create policy settings_read on public.system_settings for select to authenticated using (true);

grant insert, update on public.areas to authenticated;
create policy areas_admin_ins on public.areas for insert to authenticated with check (app.has_role('admin'));
create policy areas_admin_upd on public.areas for update to authenticated using (app.has_role('admin'));
grant update (value, updated_by, updated_at) on public.system_settings to authenticated;
create policy settings_admin on public.system_settings for update to authenticated using (app.has_role('admin'));

-- hospitals & MOUs
grant select, insert, update on public.hospitals, public.hospital_mou_details to authenticated;
create policy hospitals_read on public.hospitals for select to authenticated
  using (app.has_role('admin', 'amo', 'finance', 'management') or id = app.current_hospital());
create policy hospitals_admin_ins on public.hospitals for insert to authenticated with check (app.has_role('admin'));
create policy hospitals_admin_upd on public.hospitals for update to authenticated using (app.has_role('admin'));
create policy mou_read on public.hospital_mou_details for select to authenticated
  using (app.has_role('admin', 'amo', 'finance', 'management') or hospital_id = app.current_hospital());
create policy mou_admin_ins on public.hospital_mou_details for insert to authenticated with check (app.has_role('admin'));
create policy mou_admin_upd on public.hospital_mou_details for update to authenticated using (app.has_role('admin'));

-- users: profile rows are created by the server (service role) when admin creates an account
grant select on public.users to authenticated;
grant update (full_name, area_id, hospital_id, designation, employee_code, phone, active, role) on public.users to authenticated;
create policy users_read on public.users for select to authenticated
  using (id = auth.uid() or app.has_role('admin', 'management'));
create policy users_admin_upd on public.users for update to authenticated using (app.has_role('admin'));

-- limited directory so hospitals/finance can see names of AMOs etc. (no email/phone)
create view public.user_directory with (security_barrier) as
  select id, full_name, role, designation, area_id, hospital_id, active from public.users;
grant select on public.user_directory to authenticated;

grant select, insert, update on public.amo_doctor_mapping to authenticated;
create policy amo_map_read on public.amo_doctor_mapping for select to authenticated
  using (app.has_role('admin', 'management') or amo_user_id = auth.uid() or delegate_user_id = auth.uid());
create policy amo_map_admin_ins on public.amo_doctor_mapping for insert to authenticated with check (app.has_role('admin'));
create policy amo_map_admin_upd on public.amo_doctor_mapping for update to authenticated using (app.has_role('admin'));

-- employees & patients (AMO registers within own area)
grant select, insert, update on public.employees, public.patients to authenticated;
create policy employees_read on public.employees for select to authenticated using (
  app.has_role('admin', 'management', 'amo')
  or exists (select 1 from public.patient_referrals r where r.employee_id = employees.id and app.can_read_referral(r.id)));
create policy employees_write on public.employees for insert to authenticated with check (app.has_role('admin', 'amo'));
create policy employees_upd on public.employees for update to authenticated using (app.has_role('admin', 'amo'));
create policy patients_read on public.patients for select to authenticated using (
  app.has_role('admin', 'management', 'amo')
  or exists (select 1 from public.patient_referrals r where r.patient_id = patients.id and app.can_read_referral(r.id)));
create policy patients_write on public.patients for insert to authenticated with check (app.has_role('admin', 'amo'));
create policy patients_upd on public.patients for update to authenticated using (app.has_role('admin', 'amo'));

-- referrals: AMO creates as themselves; hospital reads own; exceptions admin-only
grant select, insert on public.patient_referrals to authenticated;
grant update (admission_date, discharge_date, ward_occupied, treatment_details, diagnosis, referral_letter_path, status)
  on public.patient_referrals to authenticated;
-- inline on row columns (not a lookup by id) so INSERT … RETURNING works for the creator
create policy referrals_read on public.patient_referrals for select to authenticated using (
  app.has_role('admin', 'management')
  or (app.current_role() = 'hospital' and hospital_id = app.current_hospital())
  or app.acts_for_amo(referring_amo_id)
  or (app.current_role() = 'amo' and area_id = (select u.area_id from public.users u where u.id = auth.uid()))
  or (app.current_role() = 'finance' and exists (
        select 1 from public.hospital_bills b where b.referral_id = patient_referrals.id and app.finance_visible(b.status))));
create policy referrals_ins on public.patient_referrals for insert to authenticated with check (
  (app.has_role('amo') and referring_amo_id = auth.uid() and not is_exception)
  or app.has_role('admin'));
create policy referrals_upd on public.patient_referrals for update to authenticated using (
  app.has_role('admin') or app.acts_for_amo(referring_amo_id)
  or (app.current_role() = 'hospital' and hospital_id = app.current_hospital() and status = 'ACTIVE'));

-- rate master: everyone reads, only admin writes
grant select on public.cghs_rate_versions, public.cghs_rate_master to authenticated;
grant insert, update, delete on public.cghs_rate_versions, public.cghs_rate_master to authenticated;
create policy rv_read on public.cghs_rate_versions for select to authenticated using (true);
create policy rv_admin_ins on public.cghs_rate_versions for insert to authenticated with check (app.has_role('admin'));
create policy rv_admin_upd on public.cghs_rate_versions for update to authenticated using (app.has_role('admin'));
create policy rv_admin_del on public.cghs_rate_versions for delete to authenticated using (app.has_role('admin') and status = 'DRAFT');
create policy rm_read on public.cghs_rate_master for select to authenticated using (true);
create policy rm_admin_ins on public.cghs_rate_master for insert to authenticated with check (
  app.has_role('admin') and exists (select 1 from public.cghs_rate_versions v where v.id = version_id and v.status = 'DRAFT'));
create policy rm_admin_upd on public.cghs_rate_master for update to authenticated using (
  app.has_role('admin') and exists (select 1 from public.cghs_rate_versions v where v.id = version_id and v.status = 'DRAFT'));
create policy rm_admin_del on public.cghs_rate_master for delete to authenticated using (
  app.has_role('admin') and exists (select 1 from public.cghs_rate_versions v where v.id = version_id and v.status = 'DRAFT'));

-- bills: hospital inserts DRAFT against its own referral; status only via RPC
grant select, insert on public.hospital_bills to authenticated;
grant update (hospital_bill_no, bill_date, bill_type, remarks) on public.hospital_bills to authenticated;
create policy bills_read on public.hospital_bills for select to authenticated using (
  app.has_role('admin', 'management')
  or (app.current_role() = 'hospital' and hospital_id = app.current_hospital())
  or app.acts_for_amo(amo_id)
  or (app.current_role() = 'finance' and app.finance_visible(status)));
create policy bills_ins on public.hospital_bills for insert to authenticated with check (
  app.current_role() = 'hospital' and hospital_id = app.current_hospital() and status = 'DRAFT'
  and exists (select 1 from public.patient_referrals r
              where r.id = referral_id and r.hospital_id = app.current_hospital()
                and r.status = 'ACTIVE' and r.referring_amo_id = amo_id));
create policy bills_upd on public.hospital_bills for update to authenticated using (
  app.current_role() = 'hospital' and hospital_id = app.current_hospital() and status in ('DRAFT', 'REVISION_REQUESTED'));

grant select, insert, update, delete on public.hospital_bill_items to authenticated;
create policy items_read on public.hospital_bill_items for select to authenticated using (app.can_read_bill(bill_id));
create policy items_write on public.hospital_bill_items for all to authenticated
  using (exists (select 1 from public.hospital_bills b where b.id = bill_id and b.hospital_id = app.current_hospital()
                 and app.current_role() = 'hospital' and b.status in ('DRAFT', 'REVISION_REQUESTED')))
  with check (exists (select 1 from public.hospital_bills b where b.id = bill_id and b.hospital_id = app.current_hospital()
                 and app.current_role() = 'hospital' and b.status in ('DRAFT', 'REVISION_REQUESTED')));

grant select, insert on public.supporting_documents to authenticated;
create policy docs_read on public.supporting_documents for select to authenticated using (
  (bill_id is not null and app.can_read_bill(bill_id)) or (referral_id is not null and app.can_read_referral(referral_id)));
create policy docs_ins on public.supporting_documents for insert to authenticated with check (
  uploaded_by = auth.uid() and (
    (bill_id is not null and app.can_read_bill(bill_id) and app.has_role('hospital', 'amo', 'admin'))
    or (referral_id is not null and app.can_read_referral(referral_id) and app.has_role('amo', 'admin', 'hospital'))));

-- verification: rounds created by the server engine; AMO edits decision columns of DRAFT rounds only
grant select on public.bill_verification, public.bill_verification_items to authenticated;
grant update (remarks) on public.bill_verification to authenticated;
grant update (suggestion_confirmed, decision, admissible_qty, admissible_rate, remarks, decided_by, decided_at)
  on public.bill_verification_items to authenticated;
create policy ver_read on public.bill_verification for select to authenticated using (
  app.can_read_bill(bill_id) and (status = 'SUBMITTED' or app.current_role() <> 'hospital'));
create policy ver_upd on public.bill_verification for update to authenticated using (
  status = 'DRAFT' and exists (select 1 from public.hospital_bills b where b.id = bill_id and app.acts_for_amo(b.amo_id)));
create policy vitems_read on public.bill_verification_items for select to authenticated using (
  exists (select 1 from public.bill_verification v where v.id = verification_id and app.can_read_bill(v.bill_id)
          and (v.status = 'SUBMITTED' or app.current_role() <> 'hospital')));
create policy vitems_upd on public.bill_verification_items for update to authenticated
  using (exists (select 1 from public.bill_verification v join public.hospital_bills b on b.id = v.bill_id
                 where v.id = verification_id and v.status = 'DRAFT' and app.acts_for_amo(b.amo_id)))
  with check (decided_by = auth.uid());

-- queries / responses: read follows bill; writes only through RPC
grant select on public.hospital_queries, public.query_responses to authenticated;
create policy q_read on public.hospital_queries for select to authenticated using (app.can_read_bill(bill_id));
create policy qr_read on public.query_responses for select to authenticated using (
  exists (select 1 from public.hospital_queries q where q.id = query_id and app.can_read_bill(q.bill_id)));

-- finance: read for finance/admin/management, status visible to hospital & AMO; writes via RPC
grant select on public.finance_processing, public.payment_records to authenticated;
create policy fin_read on public.finance_processing for select to authenticated using (app.can_read_bill(bill_id));
create policy pay_read on public.payment_records for select to authenticated using (
  exists (select 1 from public.finance_processing f where f.id = finance_id and app.can_read_bill(f.bill_id)));

-- notifications: own only; may mark read
grant select on public.notifications to authenticated;
grant update (read_at) on public.notifications to authenticated;
create policy notif_read on public.notifications for select to authenticated using (user_id = auth.uid());
create policy notif_upd on public.notifications for update to authenticated using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- audit: append-only via triggers; read by admin/management, or for bills the user can see
grant select on public.audit_logs to authenticated;
create policy audit_read on public.audit_logs for select to authenticated using (
  app.has_role('admin', 'management') or (bill_id is not null and app.can_read_bill(bill_id)));

-- ---------------------------------------------------------------- integrity triggers
create or replace function app.touch_updated_at() returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;
create trigger bills_touch before update on public.hospital_bills for each row execute function app.touch_updated_at();

-- recompute bill category totals whenever items change
create or replace function app.recalc_bill_totals() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_bill uuid := coalesce(new.bill_id, old.bill_id);
begin
  update public.hospital_bills b set
    total_medicine      = coalesce(s.med, 0),
    total_procedure     = coalesce(s.proc, 0),
    total_investigation = coalesce(s.inv, 0),
    total_room          = coalesce(s.room, 0),
    total_other         = coalesce(s.oth, 0),
    total_claimed       = coalesce(s.tot, 0)
  from (
    select sum(amount_claimed) filter (where category in ('MEDICINE', 'CONSUMABLE'))                    as med,
           sum(amount_claimed) filter (where category in ('PROCEDURE', 'PACKAGE', 'IMPLANT'))           as proc,
           sum(amount_claimed) filter (where category = 'INVESTIGATION')                                as inv,
           sum(amount_claimed) filter (where category in ('ROOM_RENT', 'ICU'))                          as room,
           sum(amount_claimed) filter (where category in ('CONSULTATION', 'OTHER'))                     as oth,
           sum(amount_claimed) as tot
    from public.hospital_bill_items where bill_id = v_bill) s
  where b.id = v_bill;
  return null;
end $$;
create trigger items_totals after insert or update or delete on public.hospital_bill_items
  for each row execute function app.recalc_bill_totals();

-- submitted verification rounds are immutable (history never overwritten)
create or replace function app.protect_submitted_round() returns trigger language plpgsql as $$
begin
  if tg_table_name = 'bill_verification' then
    if tg_op = 'DELETE' and old.status = 'SUBMITTED' then
      raise exception 'Submitted verification rounds cannot be deleted';
    end if;
    if tg_op = 'UPDATE' and old.status = 'SUBMITTED' and current_setting('app.allow_round_finalise', true) is distinct from 'on' then
      raise exception 'Verification round % is submitted and cannot be changed', old.round_no;
    end if;
  else
    if exists (select 1 from public.bill_verification v where v.id = old.verification_id and v.status = 'SUBMITTED') then
      raise exception 'Items of a submitted verification round cannot be changed';
    end if;
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;
create trigger ver_protect before update or delete on public.bill_verification
  for each row execute function app.protect_submitted_round();
create trigger vitems_protect before update or delete on public.bill_verification_items
  for each row execute function app.protect_submitted_round();

-- audit trail for manual decisions on bill items (old vs new)
create or replace function app.audit_item_decision() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_bill uuid;
begin
  if (old.decision, old.admissible_qty, old.admissible_rate, old.remarks)
     is distinct from (new.decision, new.admissible_qty, new.admissible_rate, new.remarks) then
    select bill_id into v_bill from public.bill_verification where id = new.verification_id;
    insert into public.audit_logs (actor_id, actor_label, entity, entity_id, bill_id, action, old_data, new_data)
    values (auth.uid(), app.actor_label(), 'bill_verification_items', new.id, v_bill,
            case when new.admissible_rate <> new.proposed_rate or new.admissible_qty <> new.proposed_qty
                 then 'ITEM_OVERRIDE' else 'ITEM_DECISION' end,
            jsonb_build_object('decision', old.decision, 'qty', old.admissible_qty, 'rate', old.admissible_rate, 'remarks', old.remarks),
            jsonb_build_object('decision', new.decision, 'qty', new.admissible_qty, 'rate', new.admissible_rate, 'remarks', new.remarks));
  end if;
  return new;
end $$;
create trigger vitems_audit after update on public.bill_verification_items
  for each row execute function app.audit_item_decision();

-- generic audit for master-data changes
create or replace function app.audit_row() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.audit_logs (actor_id, actor_label, entity, entity_id, action, old_data, new_data)
  values (auth.uid(), app.actor_label(), tg_table_name,
          coalesce((to_jsonb(new) ->> 'id'), (to_jsonb(old) ->> 'id'))::uuid, tg_op,
          case when tg_op <> 'INSERT' then to_jsonb(old) end,
          case when tg_op <> 'DELETE' then to_jsonb(new) end);
  return null;
end $$;
do $$
declare t text;
begin
  foreach t in array array['hospitals','hospital_mou_details','users','amo_doctor_mapping','cghs_rate_versions',
                           'system_settings','patient_referrals']
  loop
    execute format('create trigger %I after insert or update or delete on public.%I for each row execute function app.audit_row()',
                   t || '_audit', t);
  end loop;
end $$;

-- system_settings has a text key, not uuid id: override its audit to avoid uuid cast
drop trigger system_settings_audit on public.system_settings;
create or replace function app.audit_setting() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.audit_logs (actor_id, actor_label, entity, action, old_data, new_data)
  values (auth.uid(), app.actor_label(), 'system_settings', tg_op || ':' || coalesce(new.key, old.key),
          case when tg_op <> 'INSERT' then old.value end, case when tg_op <> 'DELETE' then new.value end);
  return null;
end $$;
create trigger system_settings_audit after insert or update or delete on public.system_settings
  for each row execute function app.audit_setting();

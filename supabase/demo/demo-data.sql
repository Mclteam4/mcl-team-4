-- =============================================================================
-- FICTIONAL DEMO DATA — MCL Medical Bill Management System
-- Run once, after the migrations:
--   npx supabase db query --remote=<project-ref> -f supabase/demo/demo-data.sql
--
-- Loads: 5 areas, 5 hospitals + MOUs, 11 demo staff records, DEMO rate schedules
-- (NOT official CGHS values), 21 employees/patients, 36 referrals and 36 bills at
-- every workflow stage — including the Rajesh Kumar / ABC Multispeciality Hospital
-- scenario (₹2,50,000, 20 medicines + 5 investigations + 3 procedures).
--
-- Demo staff have NO password and cannot sign in. All people, hospitals and
-- figures are made up. Does nothing if demo data is already present.
-- =============================================================================

create or replace function pg_temp.demo_user(p_login text, p_name text, p_role public.app_role,
  p_area uuid, p_hosp uuid, p_desig text) returns uuid language plpgsql as $f$
declare v uuid := gen_random_uuid(); v_email text := p_login || '@mcl-demo.example';
begin
  insert into auth.users (instance_id, id, aud, role, email, email_confirmed_at, created_at, updated_at,
         raw_app_meta_data, raw_user_meta_data, confirmation_token, recovery_token, email_change_token_new, email_change)
  values ('00000000-0000-0000-0000-000000000000', v, 'authenticated', 'authenticated', v_email, now(), now(), now(),
         '{"provider":"email","providers":["email"]}', '{"demo":true}', '', '', '', '');
  insert into public.users (id, email, full_name, role, area_id, hospital_id, designation, login_id)
  values (v, v_email, p_name, p_role, p_area, p_hosp, p_desig, p_login);
  return v;
end $f$;

create or replace function pg_temp.demo_audit(p_bill uuid, p_at timestamptz, p_actor text, p_action text, p_data jsonb default null)
returns void language sql as $f$
  insert into public.audit_logs (at, actor_label, entity, entity_id, bill_id, action, new_data)
  values (p_at, p_actor, 'hospital_bills', p_bill, p_bill, p_action, p_data);
$f$;

do $$
declare
  v uuid;
  a_ids uuid[] := '{}';
  h_ids uuid[] := '{}'; h_user uuid[] := '{}';
  h_codes text[] := array['ABC-BBSR','SUN-CTC','GRN-SBP','RVS-ANG','LOT-KOL'];
  h_names text[] := array['ABC Multispeciality Hospital','Sunrise Heart Institute','Greenfield General Hospital',
                          'Riverside Medical Centre','Lotus Multispeciality Hospital'];
  h_city public.city_class[] := array['TIER_I','TIER_II','TIER_III','TIER_III','TIER_I']::public.city_class[];
  h_nabh boolean[] := array[true, true, false, true, true];
  h_ss boolean[] := array[false, true, false, false, true];
  amo uuid[] := '{}';
  amo_name text[] := array['Dr. Sharma','Dr. Mishra','Dr. Patnaik','Dr. Das'];
  area_short text[] := array['Talcher','Ib Valley','Lakhanpur','Jagannath'];
  fin uuid; mgmt uuid; v_cghs uuid; v_med uuid;
  emp uuid[] := '{}'; pat uuid[] := '{}'; emp_amo int[] := '{}'; emp_ward public.ward_type[] := '{}';
  first_names text[] := array['Sunita','Pradeep','Manoj','Anita','Bikash','Sasmita','Deepak','Priyanka','Ramesh','Laxmi',
                              'Ashok','Kavita','Suresh','Mamata','Gopal','Nirupama','Santosh','Jyoti','Bijay','Rina'];
  last_names text[] := array['Behera','Sahoo','Nayak','Mohanty','Pradhan','Rout','Swain','Jena','Panda','Biswal',
                             'Majhi','Dash','Barik','Sethi','Mahapatra','Sahu','Bag','Parida','Tripathy','Senapati'];
  dep_first text[] := array['Meena','Rohit','Puja','Sanjay','Kamala','Arjun','Smita','Ravi'];
  rel text[] := array['Spouse','Son','Daughter','Mother','Father'];
  diag text[] := array['Acute coronary syndrome','Cholelithiasis','Fracture neck of femur','Senile cataract',
                       'Chronic kidney disease (dialysis)','Community-acquired pneumonia','Inguinal hernia','Dengue fever',
                       'Acute appendicitis','Diabetic foot ulcer','Term pregnancy','Osteoarthritis knee'];
  stat text[];
  i int; j int; k int; hi int; ei int; ai int; v_stay int; line int;
  v_ref uuid; v_bill uuid; v_round uuid; v_fin uuid; v_pat uuid;
  v_status text; v_sub timestamptz; v_sent timestamptz; v_acc timestamptz; v_appr timestamptz; v_paid timestamptz;
  v_admit date; v_disch date; v_mode text; v_amo_label text; v_hosp_label text;
  v_fin_label text := 'Finance Officer (Medical Bills) (finance)';
  v_name text; v_basic numeric; v_ward public.ward_type; v_claimed numeric;
  r record; it record; t record;
  f_city numeric; f_acc numeric; f_ss numeric; ward_rate numeric;
  v_cr numeric; v_match public.match_status; v_dec public.item_decision;
  v_aq numeric; v_ar numeric; v_pq numeric; v_pr numeric; v_rem text;
begin
  if exists (select 1 from public.hospitals where code = 'ABC-BBSR') then
    raise notice 'Demo data is already loaded - nothing changed.';
    return;
  end if;
  perform setseed(0.42);
  alter table public.hospital_bills disable trigger bills_touch;   -- keep realistic "updated" dates

  stat := array_fill('PAYMENT_COMPLETED'::text, array[15])
       || array['PAYMENT_PROCESSED','PAYMENT_PROCESSED','FINANCIALLY_APPROVED','FINANCIALLY_APPROVED','FINANCIALLY_APPROVED',
                'FINANCE_RETURNED','PENDING_FINANCE','PENDING_FINANCE','PENDING_FINANCE','PENDING_FINANCE',
                'QUERY_RAISED','QUERY_RAISED','SENT_TO_HOSPITAL','SENT_TO_HOSPITAL','SENT_TO_HOSPITAL',
                'UNDER_VERIFICATION','UNDER_VERIFICATION','SUBMITTED','SUBMITTED','DRAFT'];

  -- ------------------------------------------------------------ areas
  for i in 1..4 loop
    insert into public.areas (code, name)
    values ((array['TLC','IBV','LKN','JGD'])[i], area_short[i] || ' Area')
    on conflict (code) do update set name = excluded.name returning id into v;
    a_ids := a_ids || v;
  end loop;
  insert into public.areas (code, name) values ('HQ', 'MCL Headquarters, Burla') on conflict (code) do nothing;

  -- ------------------------------------------------------------ hospitals + MOUs
  for i in 1..5 loop
    insert into public.hospitals (code, name, address, city, state, city_class, nabh, super_specialty, contact_email, contact_phone)
    values (h_codes[i], h_names[i], 'Demo address ' || i,
            (array['Bhubaneswar','Cuttack','Sambalpur','Angul','Kolkata'])[i],
            (array['Odisha','Odisha','Odisha','Odisha','West Bengal'])[i],
            h_city[i], h_nabh[i], h_ss[i],
            'billing@' || lower(split_part(h_codes[i], '-', 1)) || '-hospital.example', '0000-000000')
    returning id into v;
    h_ids := h_ids || v;
    insert into public.hospital_mou_details (hospital_id, mou_no, valid_from, valid_to, discount_pct, remarks)
    values (v, 'MCL/MOU/' || h_codes[i] || '/2026', '2026-01-01', '2028-12-31', case when i = 5 then 5 else 0 end, 'DEMO MOU');
  end loop;

  -- ------------------------------------------------------------ demo staff (no passwords)
  for i in 1..4 loop
    amo := amo || pg_temp.demo_user((array['dr.sharma','dr.mishra','dr.patnaik','dr.das'])[i], amo_name[i], 'amo',
                                    a_ids[i], null, 'Area Medical Officer, ' || area_short[i]);
  end loop;
  for i in 1..5 loop
    h_user := h_user || pg_temp.demo_user(
      (array['abc.billing','sunrise.billing','greenfield.billing','riverside.billing','lotus.billing'])[i],
      split_part(h_names[i], ' ', 1) || ' Hospital Billing Desk', 'hospital', null, h_ids[i], 'Billing Executive');
  end loop;
  fin := pg_temp.demo_user('finance.demo', 'Finance Officer (Medical Bills)', 'finance', null, null, 'Dy. Manager (Finance)');
  mgmt := pg_temp.demo_user('gm.medical', 'GM (Medical Services)', 'management', null, null, 'General Manager (Medical)');

  -- ------------------------------------------------------------ DEMO rate schedules (not official CGHS values)
  insert into public.cghs_rate_versions (rate_type, version_label, notification_ref, effective_from, status, row_count, source_filename, activated_at)
  values ('CGHS', 'DEMO-CGHS-2026', 'DEMO DATA - not official CGHS rates', '2026-01-01', 'ACTIVE', 14, 'demo-data.sql', now())
  returning id into v_cghs;
  insert into public.cghs_rate_master (version_id, code, name, category, unit, base_rate)
  select v_cghs, x.code, x.name, x.cat::public.item_category, x.unit, x.rate from (values
    ('DEMO-P101','Coronary angiography','PROCEDURE','Procedure',12000),
    ('DEMO-P102','PTCA single vessel (excluding stent)','PROCEDURE','Procedure',95000),
    ('DEMO-P103','Temporary pacemaker implantation','PROCEDURE','Procedure',18000),
    ('DEMO-P104','Upper GI endoscopy','PROCEDURE','Procedure',2000),
    ('DEMO-P105','Laparoscopic cholecystectomy','PROCEDURE','Procedure',32000),
    ('DEMO-P106','Cataract surgery (phaco) with foldable IOL','PROCEDURE','Procedure',15000),
    ('DEMO-P107','Haemodialysis per session','PROCEDURE','Session',2200),
    ('DEMO-P108','Inguinal hernia repair with mesh','PROCEDURE','Procedure',26500),
    ('DEMO-I201','2D Echocardiography','INVESTIGATION','Test',1300),
    ('DEMO-I202','Complete blood count','INVESTIGATION','Test',150),
    ('DEMO-I203','Liver function test','INVESTIGATION','Test',390),
    ('DEMO-I204','Kidney function test','INVESTIGATION','Test',360),
    ('DEMO-I205','ECG','INVESTIGATION','Test',120),
    ('DEMO-I206','X-ray chest PA view','INVESTIGATION','Test',220)
  ) as x(code, name, cat, unit, rate);

  insert into public.cghs_rate_versions (rate_type, version_label, notification_ref, effective_from, status, row_count, source_filename, activated_at)
  values ('MEDICINE', 'DEMO-MEDICINE-2026', 'DEMO DATA - not an official price list', '2026-01-01', 'ACTIVE', 20, 'demo-data.sql', now())
  returning id into v_med;
  insert into public.cghs_rate_master (version_id, code, name, category, specification, unit, base_rate)
  select v_med, x.code, x.name, 'MEDICINE'::public.item_category, x.spec, x.unit, x.rate from (values
    ('DEMO-M01','Inj. Heparin','5000 IU','Vial',180), ('DEMO-M02','Tab. Clopidogrel','75 mg','Tablet',9),
    ('DEMO-M03','Tab. Aspirin','75 mg','Tablet',2), ('DEMO-M04','Tab. Atorvastatin','40 mg','Tablet',26),
    ('DEMO-M05','Inj. Tirofiban','5 mg/100 ml','Vial',9800), ('DEMO-M06','Inj. Pantoprazole','40 mg','Vial',62),
    ('DEMO-M07','Inj. Ceftriaxone','1 g','Vial',80), ('DEMO-M08','IV Normal saline','500 ml','Bottle',35),
    ('DEMO-M09','IV Dextrose 5%','500 ml','Bottle',40), ('DEMO-M10','Contrast Iohexol','350 mgI/ml 100 ml','Bottle',4300),
    ('DEMO-M11','Inj. Nitroglycerin','25 mg','Ampoule',260), ('DEMO-M12','Tab. Metoprolol','25 mg','Tablet',6),
    ('DEMO-M13','Inj. Ondansetron','4 mg','Ampoule',25), ('DEMO-M14','Inj. Amiodarone','150 mg','Ampoule',125),
    ('DEMO-M15','Tab. Ticagrelor','90 mg','Tablet',46), ('DEMO-M16','Inj. Paracetamol infusion','1 g/100 ml','Bottle',185),
    ('DEMO-M17','Inj. Bivalirudin','250 mg','Vial',14500), ('DEMO-M18','Inj. Tenecteplase','40 mg','Vial',22000),
    ('DEMO-M19','Inj. Enoxaparin','60 mg','Prefilled syringe',486), ('DEMO-M20','Protein supplement powder','400 g','Tin',1700)
  ) as x(code, name, spec, unit, rate);

  -- ------------------------------------------------------------ employees & patients (fictional)
  for i in 1..20 loop
    ai := 1 + (i - 1) % 4;
    v_name := first_names[i] || ' ' || last_names[1 + (i * 7) % 20];
    v_basic := 30000 + round(random() * 60000);
    v_ward := case when v_basic <= 36500 then 'GENERAL' when v_basic <= 50500 then 'SEMI_PRIVATE' else 'PRIVATE' end;
    insert into public.employees (employee_code, full_name, area_id, department, designation, basic_pay, ward_entitlement)
    values ('MCL/' || (2006 + (i * 3) % 17) || '/' || lpad(((i * 23) % 900 + 100)::text, 3, '0'), v_name, a_ids[ai],
            (array['Mining','Electrical & Mechanical','Excavation','Civil','Personnel','Finance','Survey'])[1 + i % 7],
            (array['Mining Sirdar','Senior Overman','Junior Engineer','Assistant Manager','Deputy Manager','Senior Clerk','Technician'])[1 + i % 7],
            v_basic, v_ward)
    returning id into v;
    if i % 5 in (1, 3) then
      insert into public.patients (employee_id, full_name, category, relationship, gender)
      values (v, dep_first[1 + i % 8] || ' ' || split_part(v_name, ' ', 2), 'Dependent', rel[1 + i % 5], case when i % 2 = 0 then 'M' else 'F' end)
      returning id into v_pat;
    else
      insert into public.patients (employee_id, full_name, category, gender)
      values (v, v_name, 'Employee', case when i % 2 = 0 then 'M' else 'F' end) returning id into v_pat;
    end if;
    emp := emp || v; pat := pat || v_pat; emp_amo := emp_amo || ai; emp_ward := emp_ward || v_ward;
  end loop;

  -- ------------------------------------------------------------ 35 referrals + bills across the whole workflow
  for i in 1..35 loop
    v_status := stat[i];
    ei := 1 + (i * 7) % 20;
    ai := emp_amo[ei];
    hi := (array[1,2,1,3,4,1,5,2,1,3])[1 + i % 10];
    v_stay := 2 + floor(random() * 8)::int;
    if i <= 21 then v_sub := timestamptz '2026-04-06 11:00:00+05:30' + make_interval(days => (i - 1) * 9);
    else v_sub := now() - make_interval(hours => (36 - i) * 36); end if;
    v_disch := (v_sub - interval '2 days')::date;
    v_admit := v_disch - v_stay;
    v_hosp_label := split_part(h_names[hi], ' ', 1) || ' Hospital Billing Desk (hospital)';
    v_amo_label := amo_name[ai] || ' (amo)';

    insert into public.patient_referrals (referral_no, patient_id, employee_id, referring_amo_id, area_id, establishment,
           hospital_id, mou_id, referral_date, admission_date, discharge_date, diagnosis, treatment_details,
           ward_entitled, ward_occupied, created_by, created_at)
    values ('MCL/REF/2026/' || lpad((i + 1)::text, 3, '0'), pat[ei], emp[ei], amo[ai], a_ids[ai], 'Area Hospital, ' || area_short[ai],
           h_ids[hi], (select m.id from public.hospital_mou_details m where m.hospital_id = h_ids[hi]),
           v_admit - 1, v_admit, v_disch, diag[1 + i % 12], 'Referred for specialised in-patient treatment',
           emp_ward[ei], emp_ward[ei], amo[ai], v_sub - make_interval(days => v_stay + 3))
    returning id into v_ref;

    insert into public.hospital_bills (referral_id, hospital_id, amo_id, bill_type, hospital_bill_no, bill_date, status,
           submitted_at, created_by, created_at, updated_at)
    values (v_ref, h_ids[hi], amo[ai], 'FINAL', upper(split_part(h_codes[hi], '-', 1)) || '/IPD/2026/' || (4000 + i * 37),
           v_disch, v_status::public.bill_status, case when v_status = 'DRAFT' then null else v_sub end, h_user[hi],
           v_sub - interval '1 day', v_sub)
    returning id into v_bill;

    -- items: room rent + random rate-list items (+ an item with no CGHS rate in about half the bills)
    f_city := case h_city[hi] when 'TIER_I' then 1.0 when 'TIER_II' then 0.9 else 0.8 end;
    f_acc := case when h_nabh[hi] then 1.0 else 0.85 end;
    f_ss := case when h_ss[hi] then 1.15 else 1.0 end;
    ward_rate := case emp_ward[ei] when 'GENERAL' then 1500 when 'SEMI_PRIVATE' then 3000 else 4500 end;
    line := 1;
    insert into public.hospital_bill_items (bill_id, line_no, category, description, unit, quantity, rate_claimed, service_date)
    values (v_bill, line, 'ROOM_RENT', initcap(replace(lower(emp_ward[ei]::text), '_', '-')) || ' ward', 'Day', v_stay,
            case when random() < 0.3 then ward_rate * 1.2 else ward_rate end, v_admit);
    k := 5 + floor(random() * 8)::int;
    for r in select rm.id, rm.code, rm.name, rm.category, rm.specification, rm.unit, rm.base_rate
               from public.cghs_rate_master rm where rm.version_id in (v_cghs, v_med) order by random() limit k loop
      line := line + 1;
      insert into public.hospital_bill_items (bill_id, line_no, category, description, cghs_code, specification, unit,
             quantity, rate_claimed, service_date)
      values (v_bill, line, r.category, r.name, r.code, r.specification, r.unit,
             case when r.category = 'MEDICINE' then case when r.base_rate > 1000 then 1 + floor(random() * 2) else 5 + floor(random() * 26) end
                  when r.category = 'INVESTIGATION' then 1 + floor(random() * 3) else 1 end,
             round((r.base_rate
                    * (case when random() < 0.25 then 1.1 + random() * 0.3 else 0.9 + random() * 0.1 end)
                    * (case when r.category in ('PROCEDURE', 'INVESTIGATION') then f_city * f_acc * f_ss else 1 end))::numeric, 2),
             v_admit + floor(random() * (v_stay + 1))::int);
    end loop;
    if random() < 0.5 then
      line := line + 1;
      insert into public.hospital_bill_items (bill_id, line_no, category, description, unit, quantity, rate_claimed, service_date)
      values (v_bill, line, 'CONSUMABLE', 'Surgical consumables (gloves, syringes, dressings)', 'Lot', 1,
              round((800 + random() * 2200)::numeric), v_admit + 1);
    end if;
    select b.total_claimed into v_claimed from public.hospital_bills b where b.id = v_bill;
    if v_status <> 'DRAFT' then
      perform pg_temp.demo_audit(v_bill, v_sub, v_hosp_label, 'BILL_SUBMITTED', jsonb_build_object('total_claimed', v_claimed));
    end if;

    -- AMO verification (round 1)
    if v_status not in ('DRAFT', 'SUBMITTED') then
      if v_status = 'SENT_TO_HOSPITAL' then v_sent := now() - make_interval(days => 31 - i, hours => 3);
      elsif v_status = 'QUERY_RAISED' then v_sent := now() - make_interval(days => 6 + (i - 26), hours => 2);
      else v_sent := v_sub + make_interval(days => 2 + floor(random() * 4)::int, hours => 2); end if;

      insert into public.bill_verification (bill_id, round_no, amo_id, status, rule_snapshot, total_claimed, created_at)
      values (v_bill, 1, amo[ai], 'DRAFT',
              jsonb_build_object('demo', true, 'factors', jsonb_build_object('city', f_city, 'accreditation', f_acc, 'superSpecialty', f_ss)),
              v_claimed, v_sub + interval '1 day')
      returning id into v_round;
      perform pg_temp.demo_audit(v_bill, v_sub + interval '1 day', v_amo_label, 'VERIFICATION_ROUND_STARTED', jsonb_build_object('round', 1));

      j := 0;
      for it in select * from public.hospital_bill_items where bill_id = v_bill order by line_no loop
        j := j + 1;
        v_cr := null;
        if it.category = 'ROOM_RENT' then v_cr := ward_rate;
        elsif it.cghs_code is not null then
          select round((rm.base_rate * case when rm.category in ('PROCEDURE', 'INVESTIGATION') then f_city * f_acc * f_ss else 1 end)::numeric, 2)
            into v_cr from public.cghs_rate_master rm where rm.code = it.cghs_code and rm.version_id in (v_cghs, v_med);
        end if;
        if v_cr is null then v_match := 'GREY'; v_pq := it.quantity; v_pr := 0;
        elsif it.rate_claimed <= v_cr then v_match := 'GREEN'; v_pq := it.quantity; v_pr := it.rate_claimed;
        else v_match := 'RED'; v_pq := it.quantity; v_pr := v_cr; end if;

        v_rem := null;
        if v_status = 'UNDER_VERIFICATION' and j > 3 then
          v_dec := 'PENDING'; v_aq := v_pq; v_ar := v_pr;
        elsif v_match = 'GREEN' then
          if it.category = 'MEDICINE' and random() < 0.07 then
            v_dec := 'DISALLOWED'; v_aq := 0; v_ar := it.rate_claimed; v_rem := 'Not prescribed in the treatment record';
          else v_dec := 'APPROVED'; v_aq := it.quantity; v_ar := it.rate_claimed; end if;
        elsif v_match = 'RED' then
          v_dec := 'MODIFIED'; v_aq := it.quantity; v_ar := v_cr;
          v_rem := case when it.category = 'ROOM_RENT' then 'Restricted to entitled ward rent' else 'Restricted to applicable CGHS rate' end;
        elsif random() < 0.6 then
          v_dec := 'APPROVED'; v_aq := it.quantity; v_ar := it.rate_claimed; v_rem := 'Verified against pharmacy invoice (no CGHS rate)';
        else
          v_dec := 'DISALLOWED'; v_aq := 0; v_ar := it.rate_claimed; v_rem := 'General consumables are included in room charges';
        end if;

        insert into public.bill_verification_items (verification_id, bill_item_id, rate_id, match_status, match_note, cghs_rate,
               ceiling_amount, proposed_qty, proposed_rate, decision, admissible_qty, admissible_rate, remarks, decided_by, decided_at)
        values (v_round, it.id,
               (select rm.id from public.cghs_rate_master rm where rm.code = it.cghs_code and rm.version_id in (v_cghs, v_med)),
               v_match,
               case v_match when 'GREEN' then 'Within CGHS rate' when 'RED' then 'Claimed rate exceeds applicable CGHS rate of Rs ' || v_cr
                            else 'No CGHS rate found - manual verification required' end,
               v_cr, case when v_cr is null then null else round(it.quantity * v_cr, 2) end, v_pq, v_pr,
               v_dec, v_aq, v_ar, v_rem,
               case when v_dec = 'PENDING' then null else amo[ai] end,
               case when v_dec = 'PENDING' then null else v_sub + interval '1 day 2 hours' end);
      end loop;

      select coalesce(sum(i2.amount_claimed), 0) as claimed, coalesce(sum(vi.admissible_amount), 0) as adm,
             count(*) filter (where vi.decision = 'APPROVED') as ap,
             count(*) filter (where vi.decision in ('MODIFIED', 'PARTIAL')) as mo,
             count(*) filter (where vi.decision = 'DISALLOWED') as di
        into t
        from public.bill_verification_items vi join public.hospital_bill_items i2 on i2.id = vi.bill_item_id
       where vi.verification_id = v_round;

      if v_status = 'UNDER_VERIFICATION' then
        update public.hospital_bills set current_round = 1, updated_at = v_sub + interval '1 day' where id = v_bill;
      else
        update public.bill_verification set status = 'SUBMITTED', total_admissible = t.adm, total_disallowed = t.claimed - t.adm,
               approved_count = t.ap, modified_count = t.mo, disallowed_count = t.di, query_period_days = 7,
               sent_at = v_sent, deadline = app.compute_deadline(v_sent, 7),
               remarks = 'Verified item-wise against DEMO CGHS and medicine schedules'
         where id = v_round;
        perform pg_temp.demo_audit(v_bill, v_sent, v_amo_label, 'VERIFIED_BILL_SENT',
                jsonb_build_object('round', 1, 'claimed', t.claimed, 'admissible', t.adm));

        v_acc := null; v_mode := null;
        if v_status in ('PENDING_FINANCE', 'FINANCE_RETURNED', 'FINANCIALLY_APPROVED', 'PAYMENT_PROCESSED', 'PAYMENT_COMPLETED') then
          if random() < 0.75 then
            v_mode := 'ACCEPTED'; v_acc := v_sent + make_interval(days => 1 + floor(random() * 5)::int, hours => 4);
            perform pg_temp.demo_audit(v_bill, v_acc, v_hosp_label, 'HOSPITAL_ACCEPTED', jsonb_build_object('final_admissible', t.adm));
          else
            v_mode := 'DEEMED'; v_acc := app.compute_deadline(v_sent, 7) + interval '10 minutes';
            perform pg_temp.demo_audit(v_bill, v_acc, 'SYSTEM', 'DEEMED_ACCEPTED_NO_QUERY', null);
          end if;
          perform pg_temp.demo_audit(v_bill, v_acc, 'SYSTEM', 'FORWARDED_TO_FINANCE',
                  jsonb_build_object('mode', v_mode, 'final_admissible', t.adm));
        end if;

        update public.hospital_bills set current_round = 1, final_admissible = t.adm, sent_to_hospital_at = v_sent,
               query_deadline = app.compute_deadline(v_sent, 7), accepted_at = v_acc, forwarded_at = v_acc,
               forward_mode = v_mode, updated_at = coalesce(v_acc, v_sent)
         where id = v_bill;

        if v_status = 'QUERY_RAISED' then
          insert into public.hospital_queries (bill_id, verification_id, bill_item_id, query_type, reason, status, raised_by, raised_at)
          select v_bill, v_round, vi.bill_item_id, 'MODIFIED_RATE',
                 'The rate charged is as per our hospital tariff under the MOU. Request reconsideration of the reduced amount.',
                 'OPEN', h_user[hi], v_sent + interval '2 days'
            from public.bill_verification_items vi where vi.verification_id = v_round
           order by (vi.match_status = 'RED') desc, vi.ceiling_amount desc nulls last limit 1;
          perform pg_temp.demo_audit(v_bill, v_sent + interval '2 days', v_hosp_label, 'QUERY_RAISED', null);
          update public.hospital_bills set updated_at = v_sent + interval '2 days' where id = v_bill;
        end if;

        -- Finance
        if v_acc is not null then
          v_appr := v_acc + make_interval(days => 3 + floor(random() * 7)::int);
          v_paid := v_appr + make_interval(days => 5 + floor(random() * 15)::int);
          insert into public.finance_processing (bill_id, verification_id, forward_mode, received_at, final_admissible, status,
                 sanctioned_amount, approval_date, scrutiny_remarks, return_target, return_reason, processed_by, updated_at)
          values (v_bill, v_round, v_mode, v_acc, t.adm,
                 (case v_status when 'PENDING_FINANCE' then 'PENDING_FINANCE_VERIFICATION'
                                when 'FINANCE_RETURNED' then 'RETURNED_FOR_CLARIFICATION' else v_status end)::public.finance_status,
                 case when v_status in ('FINANCIALLY_APPROVED', 'PAYMENT_PROCESSED', 'PAYMENT_COMPLETED') then t.adm end,
                 case when v_status in ('FINANCIALLY_APPROVED', 'PAYMENT_PROCESSED', 'PAYMENT_COMPLETED') then v_appr::date end,
                 case when v_status in ('FINANCIALLY_APPROVED', 'PAYMENT_PROCESSED', 'PAYMENT_COMPLETED') then 'Scrutinised; medically admissible amount sanctioned in full' end,
                 case when v_status = 'FINANCE_RETURNED' then 'AMO' end,
                 case when v_status = 'FINANCE_RETURNED' then 'Please confirm the admissibility of the high-value medicine lines before sanction.' end,
                 case when v_status = 'PENDING_FINANCE' then null else fin end,
                 case when v_status = 'PAYMENT_COMPLETED' then v_paid when v_status = 'PENDING_FINANCE' then v_acc else v_appr end)
          returning id into v_fin;

          if v_status = 'FINANCE_RETURNED' then
            perform pg_temp.demo_audit(v_bill, v_appr, v_fin_label, 'FINANCE_RETURN', jsonb_build_object('target', 'AMO'));
          elsif v_status <> 'PENDING_FINANCE' then
            perform pg_temp.demo_audit(v_bill, v_appr, v_fin_label, 'FINANCE_APPROVE', jsonb_build_object('sanctioned_amount', t.adm));
          end if;
          if v_status in ('PAYMENT_PROCESSED', 'PAYMENT_COMPLETED') then
            insert into public.payment_records (finance_id, voucher_no, sap_doc_no, payment_date, amount, remarks, created_by, created_at)
            values (v_fin, 'MCL/VCH/2026/' || lpad(i::text, 4, '0'), '51000' || lpad((40000 + i * 13)::text, 5, '0'),
                    case when v_status = 'PAYMENT_COMPLETED' then v_paid::date end, t.adm,
                    case when v_status = 'PAYMENT_COMPLETED' then 'Paid by NEFT' end, fin, v_appr + interval '2 days');
            perform pg_temp.demo_audit(v_bill, v_appr + interval '2 days', v_fin_label, 'FINANCE_PROCESS', null);
          end if;
          if v_status = 'PAYMENT_COMPLETED' then
            perform pg_temp.demo_audit(v_bill, v_paid, v_fin_label, 'FINANCE_COMPLETE', jsonb_build_object('payment_date', v_paid::date));
          end if;
          update public.hospital_bills
             set updated_at = case when v_status = 'PAYMENT_COMPLETED' then v_paid when v_status = 'PENDING_FINANCE' then v_acc else v_appr end
           where id = v_bill;
        end if;
      end if;
    end if;
  end loop;

  -- ------------------------------------------------------------ scenario: Rajesh Kumar (master brief §21)
  insert into public.employees (employee_code, full_name, area_id, department, designation, basic_pay, ward_entitlement)
  values ('MCL/2020/001', 'Rajesh Kumar', a_ids[1], 'Mining', 'Senior Overman', 48000, 'SEMI_PRIVATE') returning id into v;
  insert into public.patients (employee_id, full_name, category, gender) values (v, 'Rajesh Kumar', 'Employee', 'M') returning id into v_pat;
  insert into public.patient_referrals (referral_no, patient_id, employee_id, referring_amo_id, area_id, establishment, hospital_id,
         mou_id, referral_date, admission_date, discharge_date, diagnosis, treatment_details, ward_entitled, ward_occupied, created_by)
  values ('MCL/REF/2026/001', v_pat, v, amo[1], a_ids[1], 'Area Hospital, Talcher', h_ids[1],
         (select m.id from public.hospital_mou_details m where m.hospital_id = h_ids[1]),
         '2026-11-10', '2026-11-10', '2026-11-17', 'Acute coronary syndrome - single vessel CAD',
         'CAG followed by PTCA; temporary pacing', 'SEMI_PRIVATE', 'SEMI_PRIVATE', amo[1])
  returning id into v_ref;
  insert into public.hospital_bills (referral_id, hospital_id, amo_id, bill_type, hospital_bill_no, bill_date, status,
         submitted_at, created_by, created_at, updated_at)
  values (v_ref, h_ids[1], amo[1], 'FINAL', 'ABC/IPD/2026/7781', '2026-11-17', 'SUBMITTED',
         now() - interval '5 hours', h_user[1], now() - interval '1 day', now() - interval '5 hours')
  returning id into v_bill;
  insert into public.hospital_bill_items (bill_id, line_no, category, description, cghs_code, specification, unit, quantity, rate_claimed, service_date)
  select v_bill, x.ord, x.cat::public.item_category, x.descr, x.code, x.spec, x.unit, x.qty, x.rate, x.sdate::date
  from (values
    (1,'PROCEDURE','Coronary angiography','DEMO-P101','','Procedure',1,15000,'2026-11-10'),
    (2,'PROCEDURE','PTCA single vessel (excluding stent)','DEMO-P102','','Procedure',1,120000,'2026-11-11'),
    (3,'PROCEDURE','Temporary pacemaker implantation','DEMO-P103','','Procedure',1,18000,'2026-11-11'),
    (4,'INVESTIGATION','2D Echocardiography','DEMO-I201','','Test',1,2500,'2026-11-10'),
    (5,'INVESTIGATION','Complete blood count','DEMO-I202','','Test',3,300,'2026-11-12'),
    (6,'INVESTIGATION','Liver function test','DEMO-I203','','Test',1,600,'2026-11-10'),
    (7,'INVESTIGATION','Kidney function test','DEMO-I204','','Test',2,360,'2026-11-13'),
    (8,'INVESTIGATION','ECG','DEMO-I205','','Test',3,120,'2026-11-14'),
    (9,'MEDICINE','Inj. Heparin','DEMO-M01','5000 IU','Vial',20,180,'2026-11-12'),
    (10,'MEDICINE','Tab. Clopidogrel','DEMO-M02','75 mg','Tablet',30,8,'2026-11-12'),
    (11,'MEDICINE','Tab. Aspirin','DEMO-M03','75 mg','Tablet',30,2,'2026-11-12'),
    (12,'MEDICINE','Tab. Atorvastatin','DEMO-M04','40 mg','Tablet',30,25,'2026-11-12'),
    (13,'MEDICINE','Inj. Tirofiban','DEMO-M05','5 mg/100 ml','Vial',2,9500,'2026-11-12'),
    (14,'MEDICINE','Inj. Pantoprazole','DEMO-M06','40 mg','Vial',10,60,'2026-11-12'),
    (15,'MEDICINE','Inj. Ceftriaxone','DEMO-M07','1 g','Vial',10,75,'2026-11-12'),
    (16,'MEDICINE','IV Normal saline','DEMO-M08','500 ml','Bottle',20,35,'2026-11-12'),
    (17,'MEDICINE','IV Dextrose 5%','DEMO-M09','500 ml','Bottle',10,40,'2026-11-12'),
    (18,'MEDICINE','Contrast Iohexol','DEMO-M10','350 mgI/ml 100 ml','Bottle',2,4200,'2026-11-12'),
    (19,'MEDICINE','Inj. Nitroglycerin','DEMO-M11','25 mg','Ampoule',5,260,'2026-11-12'),
    (20,'MEDICINE','Tab. Metoprolol','DEMO-M12','25 mg','Tablet',30,6,'2026-11-12'),
    (21,'MEDICINE','Inj. Ondansetron','DEMO-M13','4 mg','Ampoule',10,25,'2026-11-12'),
    (22,'MEDICINE','Inj. Amiodarone','DEMO-M14','150 mg','Ampoule',6,120,'2026-11-12'),
    (23,'MEDICINE','Tab. Ticagrelor','DEMO-M15','90 mg','Tablet',60,45,'2026-11-12'),
    (24,'MEDICINE','Inj. Paracetamol infusion','DEMO-M16','1 g/100 ml','Bottle',10,180,'2026-11-12'),
    (25,'MEDICINE','Inj. Bivalirudin','DEMO-M17','250 mg','Vial',1,14000,'2026-11-12'),
    (26,'MEDICINE','Inj. Tenecteplase','DEMO-M18','40 mg','Vial',1,21470,'2026-11-12'),
    (27,'MEDICINE','Inj. Enoxaparin','DEMO-M19','60 mg','Prefilled syringe',10,650,'2026-11-12'),
    (28,'MEDICINE','Protein supplement powder','DEMO-M20','400 g','Tin',5,1700,'2026-11-12')
  ) as x(ord, cat, descr, code, spec, unit, qty, rate, sdate);
  perform pg_temp.demo_audit(v_bill, now() - interval '5 hours', 'ABC Hospital Billing Desk (hospital)', 'BILL_SUBMITTED',
          jsonb_build_object('total_claimed', 250000));

  alter table public.hospital_bills enable trigger bills_touch;
  raise notice 'Demo data loaded.';
end $$;

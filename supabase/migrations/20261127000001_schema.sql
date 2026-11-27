-- =============================================================================
-- MCL Medical Bill Management System — 0001 Core schema
-- Tables, enums, constraints, indexes. RLS in 0002, workflow RPCs in 0003,
-- scheduled jobs in 0004. Money is numeric(14,2) everywhere.
-- =============================================================================

create extension if not exists pgcrypto;
create extension if not exists pg_trgm;
create extension if not exists btree_gist;

create schema if not exists app;   -- private helper functions (not exposed via API)

-- ---------------------------------------------------------------- enums
create type public.app_role      as enum ('admin', 'hospital', 'amo', 'finance', 'management');
create type public.city_class    as enum ('TIER_I', 'TIER_II', 'TIER_III');
create type public.ward_type     as enum ('GENERAL', 'SEMI_PRIVATE', 'PRIVATE');
create type public.rate_type     as enum ('CGHS', 'MEDICINE');
create type public.item_category as enum ('MEDICINE', 'PROCEDURE', 'PACKAGE', 'INVESTIGATION', 'ROOM_RENT',
                                          'ICU', 'CONSULTATION', 'IMPLANT', 'CONSUMABLE', 'OTHER');
create type public.match_status  as enum ('GREEN', 'RED', 'YELLOW', 'GREY');
create type public.item_decision as enum ('PENDING', 'APPROVED', 'MODIFIED', 'PARTIAL', 'DISALLOWED');
create type public.bill_status   as enum (
  'DRAFT', 'SUBMITTED', 'UNDER_VERIFICATION', 'REVISION_REQUESTED', 'SENT_TO_HOSPITAL',
  'QUERY_RAISED', 'ACCEPTED', 'DEEMED_ACCEPTED', 'PENDING_FINANCE', 'FINANCE_RETURNED',
  'FINANCIALLY_APPROVED', 'PAYMENT_PROCESSED', 'PAYMENT_COMPLETED', 'REJECTED');
create type public.finance_status as enum (
  'PENDING_FINANCE_VERIFICATION', 'FINANCIALLY_APPROVED', 'PAYMENT_PROCESSED',
  'PAYMENT_COMPLETED', 'RETURNED_FOR_CLARIFICATION');

-- ---------------------------------------------------------------- reference
create table public.roles (
  code        public.app_role primary key,
  name        text not null,
  description text
);

create table public.areas (
  id         uuid primary key default gen_random_uuid(),
  code       text not null unique,
  name       text not null,
  active     boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.hospitals (
  id              uuid primary key default gen_random_uuid(),
  code            text not null unique,
  name            text not null,
  address         text,
  city            text not null,
  state           text not null,
  city_class      public.city_class not null,
  nabh            boolean not null default false,
  super_specialty boolean not null default false,
  empanelled      boolean not null default true,
  gstin           text,
  pan             text,
  contact_email   text,
  contact_phone   text,
  active          boolean not null default true,
  created_at      timestamptz not null default now()
);
create index hospitals_name_trgm on public.hospitals using gin (name gin_trgm_ops);

create table public.hospital_mou_details (
  id            uuid primary key default gen_random_uuid(),
  hospital_id   uuid not null references public.hospitals(id),
  mou_no        text not null unique,
  valid_from    date not null,
  valid_to      date not null,
  rate_basis    text not null default 'CGHS',
  apply_factors boolean not null default true,     -- apply city/NABH/ward factors to base rate
  discount_pct  numeric(5,2) not null default 0 check (discount_pct between 0 and 100),
  remarks       text,
  document_path text,
  created_at    timestamptz not null default now(),
  check (valid_to >= valid_from),
  exclude using gist (hospital_id with =, daterange(valid_from, valid_to, '[]') with &&)
);

-- users = application profile for each auth.users row
create table public.users (
  id            uuid primary key references auth.users(id) on delete restrict,
  full_name     text not null,
  email         text not null unique,
  role          public.app_role not null references public.roles(code),
  area_id       uuid references public.areas(id),
  hospital_id   uuid references public.hospitals(id),
  designation   text,
  employee_code text,
  phone         text,
  active        boolean not null default true,
  created_at    timestamptz not null default now(),
  check (role <> 'hospital' or hospital_id is not null),
  check (role = 'hospital' or hospital_id is null)
);
create index users_role_idx on public.users(role);
create index users_hospital_idx on public.users(hospital_id);

create table public.employees (
  id               uuid primary key default gen_random_uuid(),
  employee_code    text not null unique,
  full_name        text not null,
  area_id          uuid references public.areas(id),
  department       text,
  designation      text,
  basic_pay        numeric(14,2) check (basic_pay >= 0),
  ward_entitlement public.ward_type,
  active           boolean not null default true,
  created_at       timestamptz not null default now()
);
create index employees_name_trgm on public.employees using gin (full_name gin_trgm_ops);

create table public.patients (
  id           uuid primary key default gen_random_uuid(),
  employee_id  uuid not null references public.employees(id),
  full_name    text not null,
  category     text not null check (category in ('Employee', 'Dependent', 'Other')),
  relationship text,
  gender       text check (gender in ('M', 'F', 'O')),
  date_of_birth date,
  created_at   timestamptz not null default now(),
  check (category = 'Employee' or relationship is not null)
);
create index patients_name_trgm on public.patients using gin (full_name gin_trgm_ops);

-- delegation / reassignment of AMO work
create table public.amo_doctor_mapping (
  id               uuid primary key default gen_random_uuid(),
  amo_user_id      uuid not null references public.users(id),
  delegate_user_id uuid not null references public.users(id),
  valid_from       date not null default current_date,
  valid_to         date,
  reason           text not null,
  created_by       uuid references public.users(id),
  created_at       timestamptz not null default now(),
  check (amo_user_id <> delegate_user_id),
  check (valid_to is null or valid_to >= valid_from)
);

create table public.patient_referrals (
  id                    uuid primary key default gen_random_uuid(),
  referral_no           text not null unique,
  patient_id            uuid not null references public.patients(id),
  employee_id           uuid not null references public.employees(id),
  referring_amo_id      uuid not null references public.users(id),
  area_id               uuid not null references public.areas(id),
  establishment         text,
  hospital_id           uuid not null references public.hospitals(id),
  mou_id                uuid references public.hospital_mou_details(id),
  referral_date         date not null default current_date,
  admission_date        date,
  discharge_date        date,
  diagnosis             text not null,
  treatment_details     text,
  ward_entitled         public.ward_type not null,
  ward_occupied         public.ward_type,
  referral_letter_path  text,
  is_exception          boolean not null default false,
  exception_reason      text,
  exception_approved_by uuid references public.users(id),
  status                text not null default 'ACTIVE' check (status in ('ACTIVE', 'CLOSED', 'CANCELLED')),
  created_by            uuid references public.users(id),
  created_at            timestamptz not null default now(),
  check (discharge_date is null or admission_date is null or discharge_date >= admission_date),
  check (not is_exception or (exception_reason is not null and exception_approved_by is not null))
);
create index referrals_hospital_idx on public.patient_referrals(hospital_id);
create index referrals_amo_idx on public.patient_referrals(referring_amo_id);

-- ---------------------------------------------------------------- CGHS / medicine rate master
create table public.cghs_rate_versions (
  id               uuid primary key default gen_random_uuid(),
  rate_type        public.rate_type not null default 'CGHS',
  version_label    text not null,
  notification_ref text,                   -- CGHS OM number / NPPA notification
  effective_from   date not null,
  effective_to     date,
  status           text not null default 'DRAFT' check (status in ('DRAFT', 'ACTIVE', 'ARCHIVED')),
  source_filename  text,
  row_count        int not null default 0,
  uploaded_by      uuid references public.users(id),
  uploaded_at      timestamptz not null default now(),
  activated_by     uuid references public.users(id),
  activated_at     timestamptz,
  unique (rate_type, version_label),
  check (effective_to is null or effective_to >= effective_from)
);
-- only one ACTIVE version per rate type per period
alter table public.cghs_rate_versions add constraint rate_versions_no_overlap
  exclude using gist (rate_type with =, daterange(effective_from, coalesce(effective_to, 'infinity'::date), '[]') with &&)
  where (status = 'ACTIVE');

create table public.cghs_rate_master (
  id             uuid primary key default gen_random_uuid(),
  version_id     uuid not null references public.cghs_rate_versions(id) on delete cascade,
  code           text not null,
  name           text not null,
  category       public.item_category not null,
  specification  text not null default '',
  unit           text not null default '',
  city_class     public.city_class,          -- null = applies to all; factors applied by engine
  base_rate      numeric(14,2) not null check (base_rate >= 0),
  package_days   int check (package_days >= 0),
  remarks        text,
  unique nulls not distinct (version_id, code, specification, city_class)
);
create index rate_master_code_idx on public.cghs_rate_master(upper(code));
create index rate_master_name_trgm on public.cghs_rate_master using gin (name gin_trgm_ops);

-- ---------------------------------------------------------------- bills
create sequence public.bill_tracking_seq;

create table public.hospital_bills (
  id                  uuid primary key default gen_random_uuid(),
  tracking_no         text not null unique,
  referral_id         uuid not null references public.patient_referrals(id),
  hospital_id         uuid not null references public.hospitals(id),
  amo_id              uuid not null references public.users(id),
  bill_type           text not null default 'FINAL' check (bill_type in ('INTERIM', 'FINAL', 'SUPPLEMENTARY')),
  hospital_bill_no    text not null,
  bill_date           date not null,
  version             int not null default 1 check (version >= 1),
  status              public.bill_status not null default 'DRAFT',
  total_medicine      numeric(14,2) not null default 0,
  total_procedure     numeric(14,2) not null default 0,
  total_investigation numeric(14,2) not null default 0,
  total_room          numeric(14,2) not null default 0,
  total_other         numeric(14,2) not null default 0,
  total_claimed       numeric(14,2) not null default 0,
  current_round       int not null default 0,
  final_admissible    numeric(14,2),
  query_deadline      timestamptz,
  submitted_at        timestamptz,
  sent_to_hospital_at timestamptz,
  accepted_at         timestamptz,
  forwarded_at        timestamptz,
  forward_mode        text check (forward_mode in ('ACCEPTED', 'DEEMED')),
  remarks             text,
  created_by          uuid references public.users(id),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (hospital_id, hospital_bill_no, version)
);
create index bills_status_idx on public.hospital_bills(status);
create index bills_amo_idx on public.hospital_bills(amo_id, status);
create index bills_hospital_idx on public.hospital_bills(hospital_id, status);
create index bills_deadline_idx on public.hospital_bills(query_deadline) where status = 'SENT_TO_HOSPITAL';
-- at most one live FINAL bill per referral (older versions are REJECTED/superseded)
create unique index bills_one_final_per_referral on public.hospital_bills(referral_id)
  where bill_type = 'FINAL' and status <> 'REJECTED';

create table public.supporting_documents (
  id           uuid primary key default gen_random_uuid(),
  bill_id      uuid references public.hospital_bills(id),
  referral_id  uuid references public.patient_referrals(id),
  query_id     uuid,                                         -- fk added after hospital_queries
  doc_type     text not null check (doc_type in ('FINAL_BILL', 'DISCHARGE_SUMMARY', 'INVESTIGATION_REPORT',
                 'PRESCRIPTION', 'MEDICINE_BILL', 'PROCEDURE_DETAILS', 'REFERRAL_LETTER', 'QUERY_SUPPORT',
                 'MOU', 'OTHER')),
  file_name    text not null,
  storage_path text not null unique,
  mime_type    text not null check (mime_type in ('application/pdf', 'image/jpeg', 'image/png',
                 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/vnd.ms-excel', 'text/csv')),
  size_bytes   bigint not null check (size_bytes > 0 and size_bytes <= 20 * 1024 * 1024),
  uploaded_by  uuid references public.users(id),
  uploaded_at  timestamptz not null default now(),
  check (bill_id is not null or referral_id is not null)
);
create index docs_bill_idx on public.supporting_documents(bill_id);

create table public.hospital_bill_items (
  id             uuid primary key default gen_random_uuid(),
  bill_id        uuid not null references public.hospital_bills(id) on delete cascade,
  line_no        int not null check (line_no > 0),
  category       public.item_category not null,
  description    text not null check (length(trim(description)) > 0),
  cghs_code      text,
  specification  text not null default '',
  unit           text not null default '',
  quantity       numeric(12,3) not null check (quantity > 0),
  rate_claimed   numeric(14,2) not null check (rate_claimed >= 0),
  amount_claimed numeric(14,2) generated always as (round(quantity * rate_claimed, 2)) stored,
  service_date   date,
  document_id    uuid references public.supporting_documents(id),
  unique (bill_id, line_no)
);

-- ---------------------------------------------------------------- verification rounds (insert-only history)
create table public.bill_verification (
  id                uuid primary key default gen_random_uuid(),
  bill_id           uuid not null references public.hospital_bills(id),
  round_no          int not null check (round_no >= 1),
  amo_id            uuid not null references public.users(id),
  status            text not null default 'DRAFT' check (status in ('DRAFT', 'SUBMITTED')),
  rule_snapshot     jsonb not null default '{}'::jsonb,  -- factors & rate versions used
  total_claimed     numeric(14,2) not null default 0,
  total_admissible  numeric(14,2) not null default 0,
  total_disallowed  numeric(14,2) not null default 0,
  approved_count    int not null default 0,
  modified_count    int not null default 0,
  disallowed_count  int not null default 0,
  remarks           text,
  query_period_days int,
  sent_at           timestamptz,
  deadline          timestamptz,
  reminder_48h_sent boolean not null default false,
  reminder_24h_sent boolean not null default false,
  created_at        timestamptz not null default now(),
  unique (bill_id, round_no)
);

create table public.bill_verification_items (
  id                   uuid primary key default gen_random_uuid(),
  verification_id      uuid not null references public.bill_verification(id) on delete cascade,
  bill_item_id         uuid not null references public.hospital_bill_items(id),
  -- engine output (server-written only)
  rate_id              uuid references public.cghs_rate_master(id),
  suggested_rate_id    uuid references public.cghs_rate_master(id),
  match_status         public.match_status not null,
  match_note           text,
  cghs_rate            numeric(14,2),        -- applicable (adjusted) unit rate
  ceiling_amount       numeric(14,2),
  proposed_qty         numeric(12,3) not null,
  proposed_rate        numeric(14,2) not null,
  -- AMO decision (column-level grant)
  suggestion_confirmed boolean not null default false,
  decision             public.item_decision not null default 'PENDING',
  admissible_qty       numeric(12,3) not null check (admissible_qty >= 0),
  admissible_rate      numeric(14,2) not null check (admissible_rate >= 0),
  admissible_amount    numeric(14,2) generated always as (round(admissible_qty * admissible_rate, 2)) stored,
  remarks              text,
  decided_by           uuid references public.users(id),
  decided_at           timestamptz,
  unique (verification_id, bill_item_id),
  -- remarks are mandatory for disallowance and any modification / override
  check (decision not in ('DISALLOWED', 'MODIFIED', 'PARTIAL') or length(trim(coalesce(remarks, ''))) >= 3),
  check (decision <> 'DISALLOWED' or (admissible_qty = 0 or admissible_rate = 0)),
  -- grey / yellow items can never be approved without a deliberate manual decision + remark
  check (match_status in ('GREEN', 'RED') or decision in ('PENDING', 'DISALLOWED')
         or length(trim(coalesce(remarks, ''))) >= 3)
);
create index vitems_verification_idx on public.bill_verification_items(verification_id);

-- ---------------------------------------------------------------- queries
create table public.hospital_queries (
  id              uuid primary key default gen_random_uuid(),
  bill_id         uuid not null references public.hospital_bills(id),
  verification_id uuid not null references public.bill_verification(id),
  bill_item_id    uuid references public.hospital_bill_items(id),
  query_type      text not null check (query_type in ('MODIFIED_RATE', 'DISALLOWED_MEDICINE', 'DISALLOWED_PROCEDURE',
                    'QUANTITY', 'OTHER')),
  reason          text not null check (length(trim(reason)) >= 5),
  status          text not null default 'OPEN' check (status in ('OPEN', 'ACCEPTED', 'REJECTED', 'CLARIFICATION_SOUGHT', 'MODIFIED')),
  raised_by       uuid not null references public.users(id),
  raised_at       timestamptz not null default now()
);
create index queries_bill_idx on public.hospital_queries(bill_id);

alter table public.supporting_documents
  add constraint docs_query_fk foreign key (query_id) references public.hospital_queries(id);

create table public.query_responses (
  id            uuid primary key default gen_random_uuid(),
  query_id      uuid not null references public.hospital_queries(id),
  response_type text not null check (response_type in ('ACCEPTED', 'REJECTED', 'MODIFIED', 'CLARIFICATION_SOUGHT')),
  response      text not null check (length(trim(response)) >= 3),
  responded_by  uuid not null references public.users(id),
  created_at    timestamptz not null default now()
);

-- ---------------------------------------------------------------- finance
create table public.finance_processing (
  id                uuid primary key default gen_random_uuid(),
  bill_id           uuid not null unique references public.hospital_bills(id),  -- idempotent forwarding
  verification_id   uuid not null references public.bill_verification(id),
  forward_mode      text not null check (forward_mode in ('ACCEPTED', 'DEEMED')),
  received_at       timestamptz not null default now(),
  final_admissible  numeric(14,2) not null,
  status            public.finance_status not null default 'PENDING_FINANCE_VERIFICATION',
  sanctioned_amount numeric(14,2),
  deductions        jsonb not null default '[]'::jsonb,   -- [{label, amount, reason}] e.g. TDS
  scrutiny_remarks  text,
  approval_date     date,
  return_target     text check (return_target in ('AMO', 'HOSPITAL')),
  return_reason     text,
  processed_by      uuid references public.users(id),
  updated_at        timestamptz not null default now(),
  check (sanctioned_amount is null or (sanctioned_amount >= 0 and sanctioned_amount <= final_admissible)),
  check (status <> 'RETURNED_FOR_CLARIFICATION' or (return_target is not null and return_reason is not null))
);

create table public.payment_records (
  id            uuid primary key default gen_random_uuid(),
  finance_id    uuid not null references public.finance_processing(id),
  voucher_no    text not null,
  sap_doc_no    text not null unique,
  payment_date  date,
  amount        numeric(14,2) not null check (amount > 0),
  remarks       text,
  created_by    uuid references public.users(id),
  created_at    timestamptz not null default now()
);

-- ---------------------------------------------------------------- notifications / audit / settings
create table public.notifications (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.users(id),
  event        text not null,
  title        text not null,
  body         text,
  link         text,
  read_at      timestamptz,
  email_status text not null default 'PENDING' check (email_status in ('PENDING', 'SENT', 'FAILED', 'SKIPPED')),
  email_error  text,
  created_at   timestamptz not null default now()
);
create index notifications_user_idx on public.notifications(user_id, created_at desc);
create index notifications_email_idx on public.notifications(email_status) where email_status = 'PENDING';

create table public.audit_logs (
  id          bigserial primary key,
  at          timestamptz not null default now(),
  actor_id    uuid,                       -- null = SYSTEM (scheduled job)
  actor_label text not null,
  entity      text not null,
  entity_id   uuid,
  bill_id     uuid,
  action      text not null,
  old_data    jsonb,
  new_data    jsonb
);
create index audit_bill_idx on public.audit_logs(bill_id, at);
create index audit_entity_idx on public.audit_logs(entity, entity_id);

create table public.system_settings (
  key         text primary key,
  value       jsonb not null,
  description text,
  updated_by  uuid references public.users(id),
  updated_at  timestamptz not null default now()
);

insert into public.roles (code, name, description) values
  ('admin', 'Administrator', 'MCL IT / System Administrator'),
  ('hospital', 'Hospital', 'Empanelled hospital billing staff'),
  ('amo', 'AMO / Doctor', 'Area Medical Officer / authorised referring doctor'),
  ('finance', 'Finance', 'Finance Department, MCL'),
  ('management', 'Management', 'Higher authorities — read-only');

-- Rule factors are DATA, editable by admin (never hardcoded in application code)
insert into public.system_settings (key, value, description) values
  ('query_period_days', '7', 'Calendar days given to hospital to accept or raise query'),
  ('deadline_timezone', '"Asia/Kolkata"', 'Deadline falls at 23:59:59 of the last day in this timezone'),
  ('rate_factors', '{
     "city":  {"TIER_I": 1.0, "TIER_II": 0.9, "TIER_III": 0.8},
     "accreditation": {"NABH": 1.0, "NON_NABH": 0.85},
     "super_specialty": 1.15,
     "ward":  {"GENERAL": 0.95, "SEMI_PRIVATE": 1.0, "PRIVATE": 1.05},
     "scale_categories": ["PACKAGE", "PROCEDURE"],
     "city_accreditation_categories": ["PACKAGE", "PROCEDURE", "INVESTIGATION", "ICU"]
   }', 'Multipliers applied to uploaded CGHS base rate (NABH, Tier-I, Semi-Private). VERIFY against current CGHS OM.'),
  ('room_rent_per_day', '{"GENERAL": 1500, "SEMI_PRIVATE": 3000, "PRIVATE": 4500}',
     'Room rent ceiling by entitled ward. VERIFY against current CGHS OM.'),
  ('non_admissible_keywords', '["toiletr","attendant","telephone","television","registration charge","admission charge","file charge","service charge","admin charge","soap","toothpaste","toothbrush","comb","shampoo","cosmetic","mineral water","laundry","tissue","diaper","courier","photocopy","parking","surcharge","visitor"]',
     'Bill-line keywords suggested for disallowance (AMO confirms)'),
  ('name_match_threshold', '0.6', 'pg_trgm similarity for name-based suggestions'),
  ('max_rounds_before_escalation', '3', 'Bills exceeding this many verification rounds are flagged to management');

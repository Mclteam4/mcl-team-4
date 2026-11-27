// Applies all Supabase migrations to an in-memory Postgres (PGlite) with stubbed
// Supabase schemas (auth / storage / cron), then drives the full workflow as each
// role and asserts RLS + state-machine behaviour.   Run: npm run test:sql
import { PGlite } from '@electric-sql/pglite';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
import { btree_gist } from '@electric-sql/pglite/contrib/btree_gist';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

process.on('uncaughtException', (e) => { console.error('\nUNEXPECTED ERROR:', e.message, e.where ? `\n  at ${e.where}` : '', e.query ? `\n  query: ${e.query.slice(0, 300)}` : ''); process.exit(1); });
process.on('unhandledRejection', (e) => { console.error('\nUNEXPECTED ERROR:', e.message, e.where ? `\n  at ${e.where}` : '', e.query ? `\n  query: ${e.query.slice(0, 300)}` : ''); process.exit(1); });
const db = new PGlite({ extensions: { pg_trgm, btree_gist, pgcrypto } });
let passed = 0, failed = 0;
const ok = (cond, msg) => { if (cond) { passed++; console.log('  ✔', msg); } else { failed++; console.log('  ✘', msg); } };
const expectError = async (label, fn, pattern) => {
  try { await fn(); failed++; console.log('  ✘', label, '(no error raised)'); }
  catch (e) {
    const m = String(e.message);
    if (!pattern || pattern.test(m)) { passed++; console.log('  ✔', label, '→', m.split('\n')[0].slice(0, 90)); }
    else { failed++; console.log('  ✘', label, 'unexpected error:', m); }
  }
};

// ---------------------------------------------------------------- Supabase stubs
await db.exec(`
  create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
  create schema auth; create schema storage; create schema cron;
  create table auth.users (id uuid primary key, email text);
  create function auth.uid() returns uuid language sql stable as
    $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
  create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text);
  alter table storage.objects enable row level security;
  create function storage.foldername(name text) returns text[] language sql immutable as $$ select string_to_array(name, '/') $$;
  create function cron.schedule(n text, s text, c text) returns bigint language sql as $$ select 1::bigint $$;
  grant usage on schema public, auth, storage to anon, authenticated, service_role;
  grant execute on function auth.uid() to authenticated, service_role;
`);

const dir = 'supabase/migrations';
for (const f of readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
  let sql = readFileSync(join(dir, f), 'utf8').replace(/create extension if not exists pg_cron;/g, '');
  try { await db.exec(sql); console.log('applied', f); }
  catch (e) { console.error('FAILED in', f, '\n', e.message); process.exit(1); }
}
await db.exec(`grant all on all tables in schema public to service_role;
               grant all on all sequences in schema public to service_role;
               grant usage on schema app to service_role; grant execute on all functions in schema app to service_role;`);

// ---------------------------------------------------------------- session helpers
const as = async (uid, fn) => {
  await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${uid ?? ''}', false); set role ${uid ? 'authenticated' : 'service_role'};`);
  try { return await fn(); } finally { await db.exec('reset role'); }
};
const q = (sql, params) => db.query(sql, params);
const one = async (sql, params) => (await q(sql, params)).rows[0];

// ---------------------------------------------------------------- master data (as owner)
const U = {
  admin: '00000000-0000-0000-0000-0000000000a1', amo: '00000000-0000-0000-0000-0000000000b1',
  amo2: '00000000-0000-0000-0000-0000000000b2', hosp: '00000000-0000-0000-0000-0000000000c1',
  hosp2: '00000000-0000-0000-0000-0000000000c2', fin: '00000000-0000-0000-0000-0000000000d1',
  mgmt: '00000000-0000-0000-0000-0000000000e1',
};
await db.exec(`
  insert into auth.users values ${Object.entries(U).map(([k, v]) => `('${v}', '${k}@demo.mcl')`).join(',')};
  insert into areas (id, code, name) values ('10000000-0000-0000-0000-000000000001', 'TLC', 'Talcher Area');
  insert into hospitals (id, code, name, city, state, city_class, nabh) values
    ('20000000-0000-0000-0000-000000000001', 'ABC', 'ABC Multispeciality Hospital', 'Bhubaneswar', 'Odisha', 'TIER_II', true),
    ('20000000-0000-0000-0000-000000000002', 'XYZ', 'XYZ Hospital', 'Cuttack', 'Odisha', 'TIER_II', false);
  insert into hospital_mou_details (id, hospital_id, mou_no, valid_from, valid_to) values
    ('21000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'MOU/ABC/2026', '2026-01-01', '2028-12-31');
  insert into users (id, full_name, email, role, area_id, hospital_id) values
    ('${U.admin}', 'Admin', 'admin@demo.mcl', 'admin', null, null),
    ('${U.amo}',   'Dr. Sharma', 'amo@demo.mcl', 'amo', '10000000-0000-0000-0000-000000000001', null),
    ('${U.amo2}',  'Dr. Other', 'amo2@demo.mcl', 'amo', null, null),
    ('${U.hosp}',  'ABC Billing', 'hosp@demo.mcl', 'hospital', null, '20000000-0000-0000-0000-000000000001'),
    ('${U.hosp2}', 'XYZ Billing', 'hosp2@demo.mcl', 'hospital', null, '20000000-0000-0000-0000-000000000002'),
    ('${U.fin}',   'Finance Officer', 'fin@demo.mcl', 'finance', null, null),
    ('${U.mgmt}',  'GM Medical', 'mgmt@demo.mcl', 'management', null, null);
  insert into employees (id, employee_code, full_name, area_id, basic_pay, ward_entitlement) values
    ('30000000-0000-0000-0000-000000000001', 'MCL/2020/001', 'Rajesh Kumar', '10000000-0000-0000-0000-000000000001', 48000, 'SEMI_PRIVATE');
  insert into patients (id, employee_id, full_name, category) values
    ('31000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', 'Rajesh Kumar', 'Employee');
  insert into cghs_rate_versions (id, version_label, effective_from, status) values
    ('40000000-0000-0000-0000-000000000001', 'DEMO-2026', '2026-01-01', 'ACTIVE');
`);
console.log('\nMaster data loaded\n');

// ---------------------------------------------------------------- referral (AMO)
console.log('Referral');
await as(U.amo, () => q(`insert into patient_referrals (id, referral_no, patient_id, employee_id, referring_amo_id, area_id,
  hospital_id, mou_id, admission_date, discharge_date, diagnosis, ward_entitled)
  values ('50000000-0000-0000-0000-000000000001', 'MCL/REF/2026/001', '31000000-0000-0000-0000-000000000001',
  '30000000-0000-0000-0000-000000000001', '${U.amo}', '10000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000001', '21000000-0000-0000-0000-000000000001', '2026-11-01', '2026-11-08', 'CAD', 'SEMI_PRIVATE')`));
ok(true, 'AMO created referral');
await expectError('AMO cannot create referral in another AMO\'s name', () => as(U.amo, () => q(`insert into patient_referrals
  (referral_no, patient_id, employee_id, referring_amo_id, area_id, hospital_id, diagnosis, ward_entitled)
  values ('X', '31000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', '${U.amo2}',
  '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'x', 'GENERAL')`)), /row-level security/);
ok((await as(U.hosp2, () => q('select * from patient_referrals'))).rows.length === 0, 'Other hospital cannot see the referral');
ok((await as(U.hosp, () => q('select * from patient_referrals'))).rows.length === 1, 'Referred hospital sees the referral');

// ---------------------------------------------------------------- bill (hospital)
console.log('\nBill submission');
const BILL = '60000000-0000-0000-0000-000000000001';
await as(U.hosp, () => q(`insert into hospital_bills (id, referral_id, hospital_id, amo_id, hospital_bill_no, bill_date)
  values ('${BILL}', '50000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '${U.amo}', 'ABC/IP/889', '2026-11-08') returning id`));
const tn = await one(`select tracking_no from hospital_bills where id = '${BILL}'`);
ok(/^MCL\/BILL\/\d{4}\/\d{6}$/.test(tn.tracking_no), `Tracking no. assigned: ${tn.tracking_no}`);
await expectError('Hospital cannot bill another hospital\'s referral', () => as(U.hosp2, () => q(`insert into hospital_bills
  (referral_id, hospital_id, amo_id, hospital_bill_no, bill_date) values ('50000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000002', '${U.amo}', 'X1', '2026-11-08')`)), /row-level security/);
await as(U.hosp, () => q(`insert into hospital_bill_items (bill_id, line_no, category, description, quantity, rate_claimed) values
  ('${BILL}', 1, 'PROCEDURE', 'PTCA', 1, 150000), ('${BILL}', 2, 'MEDICINE', 'Inj. Heparin', 10, 500),
  ('${BILL}', 3, 'OTHER', 'Attendant diet', 1, 1500)`));
const tot = await one(`select total_claimed, total_medicine from hospital_bills where id = '${BILL}'`);
ok(Number(tot.total_claimed) === 156500 && Number(tot.total_medicine) === 5000, `Totals auto-calculated: ₹${tot.total_claimed}`);
await expectError('Submit blocked without final bill document', () => as(U.hosp, () => q(`select rpc_submit_bill('${BILL}')`)), /final hospital bill/);
await as(U.hosp, () => q(`insert into supporting_documents (bill_id, doc_type, file_name, storage_path, mime_type, size_bytes, uploaded_by)
  values ('${BILL}', 'FINAL_BILL', 'bill.pdf', 'bills/${BILL}/bill.pdf', 'application/pdf', 1000, '${U.hosp}')`));
await as(U.hosp, () => q(`select rpc_submit_bill('${BILL}')`));
ok((await one(`select status from hospital_bills where id='${BILL}'`)).status === 'SUBMITTED', 'Bill submitted');
const nSub = (await q(`select user_id, title, details from notifications where event = 'BILL_SUBMITTED'`)).rows;
const toAmo = nSub.find((n) => n.user_id === U.amo), toHosp = nSub.find((n) => n.user_id === U.hosp);
ok(nSub.length === 2 && toAmo && toHosp, 'Bill submitted: BOTH hospital and AMO notified (one message each)');
ok(toAmo.title.includes(tn.tracking_no) && toAmo.details.reference === tn.tracking_no, `Message quotes the reference number ${tn.tracking_no}`);
ok(toHosp.details.your_side === 'raised_by' && toAmo.details.your_side === 'raised_to'
   && toAmo.details.raised_by_party === 'ABC Multispeciality Hospital' && toAmo.details.raised_to === 'Dr. Sharma (AMO, Talcher Area)',
   `Raised by "${toAmo.details.raised_by_party}" → raised to "${toAmo.details.raised_to}"`);
ok((await one(`select count(*)::int n from notifications where user_id = '${U.hosp2}'`)).n === 0, 'Other hospital receives nothing');
await expectError('Hospital cannot edit items after submission', () => as(U.hosp, async () => {
  const r = await q(`update hospital_bill_items set rate_claimed = 1 where bill_id='${BILL}'`);
  if (r.affectedRows === 0) throw new Error('row-level security: 0 rows updated');
}), /row-level security/);
await expectError('Hospital cannot change status directly', () => as(U.hosp, () => q(`update hospital_bills set status='PENDING_FINANCE' where id='${BILL}'`)), /permission denied/);

// ---------------------------------------------------------------- verification round 1
console.log('\nAMO verification');
const items = (await q(`select id, line_no from hospital_bill_items where bill_id='${BILL}' order by line_no`)).rows;
const engine = [
  { bill_item_id: items[0].id, match_status: 'RED', match_note: 'exceeds', cghs_rate: 120000, ceiling_amount: 120000, proposed_qty: 1, proposed_rate: 120000 },
  { bill_item_id: items[1].id, match_status: 'GREEN', match_note: 'ok', cghs_rate: 500, ceiling_amount: 5000, proposed_qty: 10, proposed_rate: 500 },
  { bill_item_id: items[2].id, match_status: 'YELLOW', match_note: 'non-admissible', proposed_qty: 0, proposed_rate: 0 },
];
await expectError('AMO cannot call engine RPC directly (service-role only)', () => as(U.amo, () =>
  q(`select rpc_create_round($1, $2, '{}', $3)`, [BILL, U.amo, JSON.stringify(engine)])), /permission denied/);
await expectError('Engine refuses round for non-assigned AMO', () => as(null, () =>
  q(`select rpc_create_round($1, $2, '{}', $3)`, [BILL, U.amo2, JSON.stringify(engine)])), /Not authorised/);
const r1 = (await as(null, () => q(`select rpc_create_round($1, $2, '{"v":1}', $3) id`, [BILL, U.amo, JSON.stringify(engine)]))).rows[0].id;
ok(!!r1, 'Round 1 created by server engine');
ok((await as(U.hosp, () => q(`select * from bill_verification where bill_id='${BILL}'`))).rows.length === 0, 'Hospital cannot see draft round');
await expectError('Submit blocked while items pending', () => as(U.amo, () => q(`select rpc_send_to_hospital('${r1}')`)), /must be decided/);
const n = (await as(U.amo, () => q(`select rpc_approve_green('${r1}') n`))).rows[0].n;
ok(n === 1, 'Bulk-approved 1 green item');
await expectError('Disallow without remark rejected', () => as(U.amo, () => q(`update bill_verification_items set decision='DISALLOWED',
  admissible_qty=0, decided_by='${U.amo}' where verification_id='${r1}' and bill_item_id='${items[2].id}'`)), /check constraint/);
await as(U.amo, () => q(`update bill_verification_items set decision='DISALLOWED', admissible_qty=0, remarks='Attendant diet not admissible',
  decided_by='${U.amo}' where verification_id='${r1}' and bill_item_id='${items[2].id}'`));
await as(U.amo, () => q(`update bill_verification_items set decision='MODIFIED', remarks='Restricted to CGHS rate',
  decided_by='${U.amo}' where verification_id='${r1}' and bill_item_id='${items[0].id}'`));
await expectError('AMO cannot overwrite engine CGHS rate', () => as(U.amo, () => q(`update bill_verification_items set cghs_rate=999999
  where verification_id='${r1}'`)), /permission denied/);
await expectError('Other AMO cannot decide items', () => as(U.amo2, async () => {
  const r = await q(`update bill_verification_items set remarks='hack', decided_by='${U.amo2}' where verification_id='${r1}'`);
  if (r.affectedRows === 0) throw new Error('row-level security: 0 rows');
}), /row-level security/);
const dl = (await as(U.amo, () => q(`select rpc_send_to_hospital('${r1}') d`))).rows[0].d;
const b1 = await one(`select status, final_admissible from hospital_bills where id='${BILL}'`);
ok(b1.status === 'SENT_TO_HOSPITAL' && Number(b1.final_admissible) === 125000, `Sent to hospital, admissible ₹${b1.final_admissible}, deadline ${new Date(dl).toISOString()}`);
await expectError('Submitted round is immutable', () => q(`update bill_verification_items set remarks='x' where verification_id='${r1}'`), /cannot be changed/);
ok(Number((await one(`select count(*) n from audit_logs where bill_id='${BILL}' and action in ('ITEM_DECISION','ITEM_OVERRIDE')`)).n) >= 3, 'Item decisions audited');

// ---------------------------------------------------------------- query → round 2 → accept
console.log('\nQuery & acceptance');
await as(U.hosp, () => q(`select rpc_raise_query($1, $2)`, [BILL, JSON.stringify([{ bill_item_id: items[0].id, query_type: 'MODIFIED_RATE', reason: 'Complex PTCA with two vessels, see notes' }])]));
ok((await one(`select status from hospital_bills where id='${BILL}'`)).status === 'QUERY_RAISED', 'Query raised, bill back with AMO');
const qid = (await one(`select id from hospital_queries where bill_id='${BILL}'`)).id;
await as(U.amo, () => q(`select rpc_respond_query('${qid}', 'MODIFIED', 'Accepted partly, revised to ₹1,30,000')`));
const r2 = (await as(null, () => q(`select rpc_create_round($1, $2, '{"v":2}', $3) id`, [BILL, U.amo, JSON.stringify(engine)]))).rows[0].id;
const carried = await one(`select count(*)::int n from bill_verification_items where verification_id='${r2}' and decision <> 'PENDING'`);
ok(carried.n === 3, 'Round 2 carries forward round-1 decisions');
await as(U.amo, () => q(`update bill_verification_items set admissible_rate=130000, remarks='Revised after query',
  decided_by='${U.amo}' where verification_id='${r2}' and bill_item_id='${items[0].id}'`));
await as(U.amo, () => q(`select rpc_send_to_hospital('${r2}')`));
ok(Number((await one(`select final_admissible from hospital_bills where id='${BILL}'`)).final_admissible) === 135000, 'Revised admissible ₹1,35,000');
ok((await one(`select count(*)::int n from bill_verification where bill_id='${BILL}'`)).n === 2, 'Both rounds preserved');
await as(U.hosp, () => q(`select rpc_accept_bill('${BILL}')`));
ok((await one(`select status from hospital_bills where id='${BILL}'`)).status === 'PENDING_FINANCE', 'Accepted → forwarded to Finance');
const again = await one(`select app.forward_to_finance('${BILL}', 'ACCEPTED') f`);
ok(again.f === false && (await one(`select count(*)::int n from finance_processing`)).n === 1, 'Re-forwarding is idempotent');

// ---------------------------------------------------------------- finance
console.log('\nFinance');
await expectError('AMO cannot run finance actions', () => as(U.amo, () => q(`select rpc_finance_action('${BILL}', 'APPROVE', '{"sanctioned_amount":1}')`)), /Not authorised/);
await expectError('Sanction above admissible rejected', () => as(U.fin, () => q(`select rpc_finance_action('${BILL}', 'APPROVE', '{"sanctioned_amount":200000}')`)), /between 0/);
await as(U.fin, () => q(`select rpc_finance_action('${BILL}', 'APPROVE', '{"sanctioned_amount":135000}')`));
await as(U.fin, () => q(`select rpc_finance_action('${BILL}', 'PROCESS', '{"voucher_no":"V-1001","sap_doc_no":"5100001234"}')`));
await as(U.fin, () => q(`select rpc_finance_action('${BILL}', 'COMPLETE', '{"payment_date":"2026-11-27"}')`));
ok((await one(`select status from hospital_bills where id='${BILL}'`)).status === 'PAYMENT_COMPLETED', 'Payment Completed');
ok((await one(`select count(*)::int n from notifications where user_id='${U.hosp}' and event='PAYMENT_COMPLETED'`)).n === 1, 'Hospital notified of payment');
const flow = (await q(`select event, string_agg(case user_id when '${U.hosp}' then 'H' when '${U.amo}' then 'A' when '${U.fin}' then 'F' else '?' end, '' order by user_id) who
  from notifications where details ->> 'reference' = '${tn.tracking_no}' group by event order by event`)).rows;
const who = Object.fromEntries(flow.map((r) => [r.event, [...r.who].sort().join('')]));
ok(who.VERIFIED_BILL_SENT === 'AAHH' && who.QUERY_RAISED === 'AH',
   'Verified bill sent (rounds 1 and 2) and query raised: AMO + hospital both notified each time');
ok(who.FORWARDED_TO_FINANCE === 'AFH', 'Accepted & forwarded: hospital, AMO and Finance notified');
ok(who.FINANCIALLY_APPROVED === 'AFH' && who.PAYMENT_PROCESSED === 'AFH' && who.PAYMENT_COMPLETED === 'AFH', 'Finance steps: Finance, hospital and AMO notified');
ok((await one(`select count(*)::int n from notifications where event in ('BILL_RECEIVED','VERIFIED_BILL_RECEIVED','BILL_FORWARDED','PAYMENT_STATUS','CLARIFICATION_RECEIVED')`)).n === 0,
   'Old one-sided messages switched off (no duplicates)');

// ---------------------------------------------------------------- deemed acceptance job
console.log('\n7-day deemed acceptance');
await db.exec(`
  insert into patient_referrals (id, referral_no, patient_id, employee_id, referring_amo_id, area_id, hospital_id, diagnosis, ward_entitled)
  values ('50000000-0000-0000-0000-000000000002', 'MCL/REF/2026/002', '31000000-0000-0000-0000-000000000001',
    '30000000-0000-0000-0000-000000000001', '${U.amo}', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'Fever', 'SEMI_PRIVATE');
  insert into hospital_bills (id, referral_id, hospital_id, amo_id, hospital_bill_no, bill_date, status, final_admissible, query_deadline)
  values ('60000000-0000-0000-0000-000000000002', '50000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000001',
    '${U.amo}', 'ABC/IP/900', '2026-11-10', 'SENT_TO_HOSPITAL', 9000, now() - interval '1 minute');
  insert into bill_verification (bill_id, round_no, amo_id, status) values ('60000000-0000-0000-0000-000000000002', 1, '${U.amo}', 'SUBMITTED');
`);
await expectError('Query after deadline rejected', () => as(U.hosp, () => q(`select rpc_raise_query($1, $2)`,
  ['60000000-0000-0000-0000-000000000002', JSON.stringify([{ query_type: 'OTHER', reason: 'late query here' }])])), /expired/);
const j1 = (await as(null, () => q('select job_forward_expired_bills() n'))).rows[0].n;
const j2 = (await as(null, () => q('select job_forward_expired_bills() n'))).rows[0].n;
const fwd = await one(`select status, forward_mode from hospital_bills where id='60000000-0000-0000-0000-000000000002'`);
ok(j1 === 1 && j2 === 0 && fwd.status === 'PENDING_FINANCE' && fwd.forward_mode === 'DEEMED', 'Expired bill deemed accepted once; second run no-op');
const deemed = (await q(`select user_id, details ->> 'raised_by' rb from notifications n join hospital_bills b on b.tracking_no = n.details ->> 'reference'
  where b.id = '60000000-0000-0000-0000-000000000002' and n.event = 'FORWARDED_TO_FINANCE'`)).rows;
ok(deemed.length === 3 && deemed.every((d) => d.rb === 'System (automatic)'), 'Deemed acceptance: hospital, AMO and Finance all told (raised by System)');
ok((await one(`select count(*)::int n from audit_logs where action='DEEMED_ACCEPTED_NO_QUERY' and actor_label='SYSTEM'`)).n === 1, 'System action audited');
const dlc = await one(`select to_char(app.compute_deadline('2026-11-27 10:00+05:30', 7) at time zone 'Asia/Kolkata', 'YYYY-MM-DD HH24:MI:SS') d`);
ok(dlc.d === '2026-12-04 23:59:59', `Deadline for sending on 27-Nov 10:00 IST = ${dlc.d} IST`);

// ---------------------------------------------------------------- visibility
console.log('\nVisibility');
ok((await as(U.fin, () => q('select * from hospital_bills'))).rows.length === 2, 'Finance sees only forwarded bills');
ok((await as(U.hosp2, () => q('select * from hospital_bills'))).rows.length === 0, 'Other hospital sees no bills');
ok((await as(U.mgmt, () => q('select * from hospital_bills'))).rows.length === 2, 'Management sees all bills (read-only)');
await expectError('Management cannot modify rate master', () => as(U.mgmt, () => q(`insert into cghs_rate_master (version_id, code, name, category, base_rate)
  values ('40000000-0000-0000-0000-000000000001', 'X', 'X', 'PACKAGE', 1)`)), /row-level security/);
const ov = (await as(U.hosp, () => q('select tracking_no, patient_name, amo_name, sap_doc_no from bill_overview'))).rows;
ok(ov.length === 2 && ov.some((r) => r.amo_name === 'Dr. Sharma' && r.sap_doc_no === '5100001234'), 'bill_overview joins names & SAP no. for hospital');
ok((await as(U.hosp2, () => q('select * from bill_overview'))).rows.length === 0, 'bill_overview respects RLS for other hospital');
const refNo = await as(U.amo, () => q(`insert into patient_referrals (patient_id, employee_id, referring_amo_id, area_id, hospital_id, diagnosis, ward_entitled)
  values ('31000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', '${U.amo}', '10000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000001', 'Test', 'GENERAL') returning referral_no`));
ok(/^MCL\/REF\/\d{4}\/\d{4}$/.test(refNo.rows[0].referral_no), `Referral number auto-assigned: ${refNo.rows[0].referral_no}`);
await db.exec(`update users set login_id = 'dr.sharma' where id = '${U.amo}'`);
ok((await one(`select email from users where login_id = 'dr.sharma'`)).email === 'amo@demo.mcl', 'User ID maps to login email');
await expectError('User ID must be lowercase letters/numbers', () => db.exec(`update users set login_id = 'Bad ID!' where id = '${U.fin}'`), /users_login_id_format/);
await expectError('User IDs are unique', () => db.exec(`update users set login_id = 'dr.sharma' where id = '${U.fin}'`), /duplicate key/);
await expectError('Audit log is append-only', () => as(U.admin, () => q('delete from audit_logs')), /permission denied/);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

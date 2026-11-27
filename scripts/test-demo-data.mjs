// Applies all migrations + supabase/demo/demo-data.sql to an in-memory Postgres (PGlite)
// and checks the result. Run: node scripts/test-demo-data.mjs
import { PGlite } from '@electric-sql/pglite';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
import { btree_gist } from '@electric-sql/pglite/contrib/btree_gist';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const db = new PGlite({ extensions: { pg_trgm, btree_gist, pgcrypto } });
let failed = 0;
const ok = (c, m) => { console.log(c ? '  ✔' : '  ✘', m); if (!c) failed++; };
await db.exec(`
  create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
  create schema auth; create schema storage; create schema cron;
  create table auth.users (instance_id uuid, id uuid primary key, aud text, role text, email text, encrypted_password text,
    email_confirmed_at timestamptz, created_at timestamptz, updated_at timestamptz, raw_app_meta_data jsonb, raw_user_meta_data jsonb,
    confirmation_token text, recovery_token text, email_change_token_new text, email_change text);
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
  create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text);
  alter table storage.objects enable row level security;
  create function storage.foldername(name text) returns text[] language sql immutable as $$ select string_to_array(name, '/') $$;
  create function cron.schedule(n text, s text, c text) returns bigint language sql as $$ select 1::bigint $$;
`);
for (const f of readdirSync('supabase/migrations').filter((f) => f.endsWith('.sql')).sort()) {
  await db.exec(readFileSync(join('supabase/migrations', f), 'utf8').replace(/create extension if not exists pg_cron;/g, ''));
}
const demo = readFileSync('supabase/demo/demo-data.sql', 'utf8');
try { await db.exec(demo); } catch (e) { console.error('DEMO SQL FAILED:', e.message, e.where ?? ''); process.exit(1); }
const one = async (q) => (await db.query(q)).rows[0];

console.log('Demo data checks');
const c = await one(`select (select count(*) from hospitals)::int h, (select count(*) from users)::int u, (select count(*) from employees)::int e,
  (select count(*) from patient_referrals)::int r, (select count(*) from hospital_bills)::int b, (select count(*) from hospital_bill_items)::int i,
  (select count(*) from bill_verification)::int v, (select count(*) from finance_processing)::int f, (select count(*) from payment_records)::int p,
  (select count(*) from users where role = 'admin')::int admins`);
console.log('  counts:', JSON.stringify(c));
ok(c.h === 5 && c.u === 11 && c.e === 21 && c.r === 36 && c.b === 36, '5 hospitals, 11 staff, 21 employees, 36 referrals, 36 bills');
ok(c.admins === 0, 'No admin created (first-admin setup page stays available)');
const s = (await db.query(`select status, count(*)::int n from hospital_bills group by status order by status`)).rows;
console.log('  statuses:', s.map((x) => `${x.status}=${x.n}`).join(', '));
ok(s.length === 10, 'Bills at 10 different workflow stages');
const raj = await one(`select b.total_claimed, b.status, (select count(*) from hospital_bill_items i where i.bill_id = b.id)::int items
  from hospital_bills b join patient_referrals r on r.id = b.referral_id where r.referral_no = 'MCL/REF/2026/001'`);
ok(Number(raj.total_claimed) === 250000 && raj.items === 28 && raj.status === 'SUBMITTED', `Rajesh Kumar bill: ₹${raj.total_claimed}, ${raj.items} items, ${raj.status}`);
const mism = await one(`select count(*)::int n from hospital_bills b join bill_verification v on v.bill_id = b.id and v.status = 'SUBMITTED'
  where b.final_admissible <> v.total_admissible`);
ok(mism.n === 0, 'Bill admissible amounts equal their verification totals');
const fin = await one(`select count(*)::int n from finance_processing f where f.sanctioned_amount > f.final_admissible`);
ok(fin.n === 0, 'No sanction exceeds the admissible amount');
const fut = await one(`select count(*)::int n from hospital_bills where greatest(submitted_at, sent_to_hospital_at, accepted_at, updated_at) > now() + interval '1 minute'`);
ok(fut.n === 0, 'No events dated in the future');
const dl = await one(`select count(*)::int n from hospital_bills where status = 'SENT_TO_HOSPITAL' and query_deadline > now()`);
ok(dl.n === 3, '3 bills awaiting hospital with open (future) deadlines');
const sum = await one(`select round(sum(total_claimed)) claimed, round(sum(final_admissible)) adm,
  round(sum(sanctioned_amount) filter (where status = 'PAYMENT_COMPLETED')) paid from bill_overview`);
console.log(`  totals: claimed ₹${sum.claimed}, admissible ₹${sum.adm}, paid ₹${sum.paid}`);
await db.exec(demo);
const again = await one(`select count(*)::int b from hospital_bills`);
ok(again.b === 36, 'Running it a second time changes nothing');
console.log(failed ? `${failed} check(s) failed` : 'All demo data checks passed');
process.exit(failed ? 1 : 0);

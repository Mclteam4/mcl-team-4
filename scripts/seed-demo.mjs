// Demo data for the master-brief scenario (§21). FICTIONAL people and DEMO rates only.
//   npm run seed:demo        (reads .env.local: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
// Creates 6 demo logins with random passwords written to demo-credentials.local.txt (git-ignored).
//
// Scenario: ABC Multispeciality Hospital bills ₹2,50,000 for Rajesh Kumar (MCL/2020/001), referred by
// Dr. Sharma: 20 medicines, 5 investigations, 3 procedures. Against the DEMO rate schedules 6 items exceed
// the rate; restricting them to the rate and disallowing the protein supplement gives exactly ₹2,10,000.
import { createClient } from '@supabase/supabase-js';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import readline from 'node:readline';

if (existsSync('.env.local')) {
  for (const line of readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*"?([^"]*)"?\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}

// Prompt for a secret: shows * instead of the characters typed/pasted.
function askSecret(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    let muted = false;
    rl._writeToOutput = (s) => rl.output.write(muted ? (s.includes('\n') || s.includes('\r') ? '' : '*') : s);
    rl.question(question, (answer) => { rl.close(); process.stdout.write('\n'); resolve(answer); });
    muted = true;
  });
}
// Keeps asking (empty Enter no longer quits, so a later paste cannot fall through to PowerShell).
async function getSecretKey() {
  for (let attempt = 1; attempt <= 5; attempt++) {
    const raw = await askSecret(attempt === 1
      ? 'Paste the Supabase SECRET key (sb_secret_...) and press Enter. You will see * instead of the key: '
      : 'That was empty or not a secret key. Paste the key that starts with sb_secret_ and press Enter: ');
    const k = raw.replace(/\x1b\[20[01]~/g, '').trim();
    if (/^(sb_secret_|eyJ)/.test(k)) return k;
  }
  return null;
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
let key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url) { console.error('Set NEXT_PUBLIC_SUPABASE_URL (in .env.local or the terminal) and run again.'); process.exit(1); }
if (!key) key = await getSecretKey();
if (!key) { console.error('No valid key entered. Nothing was changed.'); process.exit(1); }
console.log('✔ Key received. Creating demo data (about 20 seconds)...');
const db = createClient(url, key, { auth: { persistSession: false } });
const must = (r, what) => { if (r.error) { console.error(`✘ ${what}:`, r.error.message); process.exit(1); } return r.data; };
const pw = () => randomBytes(9).toString('base64url') + '7a';

// ------------------------------------------------------------------ master data
const area = must(await db.from('areas').upsert({ code: 'TLC', name: 'Talcher Area' }, { onConflict: 'code' }).select().single(), 'area');
await db.from('areas').upsert({ code: 'HQ', name: 'MCL Headquarters, Burla' }, { onConflict: 'code' });
const abc = must(await db.from('hospitals').upsert({
  code: 'ABC-BBSR', name: 'ABC Multispeciality Hospital', city: 'Bhubaneswar', state: 'Odisha', city_class: 'TIER_I',
  nabh: true, super_specialty: false, empanelled: true, contact_email: 'billing@abc-hospital.example',
}, { onConflict: 'code' }).select().single(), 'hospital ABC');
const xyz = must(await db.from('hospitals').upsert({
  code: 'XYZ-CTC', name: 'XYZ Heart Institute', city: 'Cuttack', state: 'Odisha', city_class: 'TIER_II', nabh: false, empanelled: true,
}, { onConflict: 'code' }).select().single(), 'hospital XYZ');
const { data: mouExisting } = await db.from('hospital_mou_details').select('*').eq('mou_no', 'MCL/MOU/ABC/2026').maybeSingle();
const mou = mouExisting ?? must(await db.from('hospital_mou_details').insert({
  hospital_id: abc.id, mou_no: 'MCL/MOU/ABC/2026', valid_from: '2026-01-01', valid_to: '2028-12-31', apply_factors: true, discount_pct: 0,
  remarks: 'DEMO MOU',
}).select().single(), 'MOU');

// ------------------------------------------------------------------ users
const PEOPLE = [
  { key: 'admin', login_id: 'admin.demo', email: 'admin.demo@mcl-demo.example', full_name: 'MCL System Administrator', role: 'admin' },
  { key: 'amo', login_id: 'dr.sharma', email: 'dr.sharma@mcl-demo.example', full_name: 'Dr. Sharma', role: 'amo', area_id: area.id, designation: 'Area Medical Officer, Talcher' },
  { key: 'amo2', login_id: 'dr.mishra', email: 'dr.mishra@mcl-demo.example', full_name: 'Dr. Mishra', role: 'amo', area_id: area.id, designation: 'Area Medical Officer' },
  { key: 'hospital', login_id: 'abc.billing', email: 'billing@abc-demo.example', full_name: 'ABC Hospital Billing Desk', role: 'hospital', hospital_id: abc.id },
  { key: 'hospital2', login_id: 'xyz.billing', email: 'billing@xyz-demo.example', full_name: 'XYZ Billing Desk', role: 'hospital', hospital_id: xyz.id },
  { key: 'finance', login_id: 'finance.demo', email: 'finance.demo@mcl-demo.example', full_name: 'Finance Officer (Medical Bills)', role: 'finance' },
  { key: 'management', login_id: 'gm.medical', email: 'gm.medical@mcl-demo.example', full_name: 'GM (Medical Services)', role: 'management' },
];
const ids = {}; const creds = [];
const { data: existingUsers } = await db.from('users').select('id, email');
for (const p of PEOPLE) {
  const found = existingUsers?.find((u) => u.email === p.email);
  if (found) { ids[p.key] = found.id; creds.push(`${p.role.padEnd(11)} user ID: ${p.login_id.padEnd(13)} (already existed — password unchanged)`); continue; }
  const password = pw();
  const { data, error } = await db.auth.admin.createUser({ email: p.email, password, email_confirm: true });
  if (error) { console.error('✘ create user', p.email, error.message); process.exit(1); }
  ids[p.key] = data.user.id;
  const { key: _k, ...profile } = p;
  must(await db.from('users').insert({ id: data.user.id, ...profile }), `profile ${p.email}`);
  creds.push(`${p.role.padEnd(11)} user ID: ${p.login_id.padEnd(13)} password: ${password}`);
}

// ------------------------------------------------------------------ DEMO rate schedules (NOT official CGHS values)
async function schedule(rate_type, version_label, rows) {
  const { data: ex } = await db.from('cghs_rate_versions').select('id').eq('version_label', version_label).maybeSingle();
  if (ex) return ex.id;
  const v = must(await db.from('cghs_rate_versions').insert({
    rate_type, version_label, notification_ref: 'DEMO DATA — replace with official schedule', effective_from: '2026-01-01',
    status: 'ACTIVE', row_count: rows.length, source_filename: 'seed-demo.mjs', uploaded_by: ids.admin, activated_by: ids.admin, activated_at: new Date().toISOString(),
  }).select().single(), version_label);
  must(await db.from('cghs_rate_master').insert(rows.map((r) => ({ specification: '', unit: '', ...r, version_id: v.id }))), `${version_label} rows`);
  return v.id;
}
await schedule('CGHS', 'DEMO-CGHS-2026', [
  { code: 'DEMO-P101', name: 'Coronary angiography', category: 'PROCEDURE', unit: 'Procedure', base_rate: 12000 },
  { code: 'DEMO-P102', name: 'PTCA single vessel (excluding stent)', category: 'PROCEDURE', unit: 'Procedure', base_rate: 95000 },
  { code: 'DEMO-P103', name: 'Temporary pacemaker implantation', category: 'PROCEDURE', unit: 'Procedure', base_rate: 18000 },
  { code: 'DEMO-P104', name: 'Upper GI endoscopy', category: 'PROCEDURE', unit: 'Procedure', base_rate: 2000 },
  { code: 'DEMO-I201', name: '2D Echocardiography', category: 'INVESTIGATION', unit: 'Test', base_rate: 1300 },
  { code: 'DEMO-I202', name: 'Complete blood count', category: 'INVESTIGATION', unit: 'Test', base_rate: 150 },
  { code: 'DEMO-I203', name: 'Liver function test', category: 'INVESTIGATION', unit: 'Test', base_rate: 390 },
  { code: 'DEMO-I204', name: 'Kidney function test', category: 'INVESTIGATION', unit: 'Test', base_rate: 360 },
  { code: 'DEMO-I205', name: 'ECG', category: 'INVESTIGATION', unit: 'Test', base_rate: 120 },
  { code: 'DEMO-I206', name: 'X-ray chest PA view', category: 'INVESTIGATION', unit: 'Test', base_rate: 220 },
]);
const MEDS = [ // [code, name, spec, unit, qty, claimed rate, schedule rate]
  ['DEMO-M01', 'Inj. Heparin', '5000 IU', 'Vial', 20, 180, 180],
  ['DEMO-M02', 'Tab. Clopidogrel', '75 mg', 'Tablet', 30, 8, 9],
  ['DEMO-M03', 'Tab. Aspirin', '75 mg', 'Tablet', 30, 2, 2],
  ['DEMO-M04', 'Tab. Atorvastatin', '40 mg', 'Tablet', 30, 25, 26],
  ['DEMO-M05', 'Inj. Tirofiban', '5 mg/100 ml', 'Vial', 2, 9500, 9800],
  ['DEMO-M06', 'Inj. Pantoprazole', '40 mg', 'Vial', 10, 60, 62],
  ['DEMO-M07', 'Inj. Ceftriaxone', '1 g', 'Vial', 10, 75, 80],
  ['DEMO-M08', 'IV Normal saline', '500 ml', 'Bottle', 20, 35, 35],
  ['DEMO-M09', 'IV Dextrose 5%', '500 ml', 'Bottle', 10, 40, 40],
  ['DEMO-M10', 'Contrast Iohexol', '350 mgI/ml 100 ml', 'Bottle', 2, 4200, 4300],
  ['DEMO-M11', 'Inj. Nitroglycerin', '25 mg', 'Ampoule', 5, 260, 260],
  ['DEMO-M12', 'Tab. Metoprolol', '25 mg', 'Tablet', 30, 6, 6],
  ['DEMO-M13', 'Inj. Ondansetron', '4 mg', 'Ampoule', 10, 25, 25],
  ['DEMO-M14', 'Inj. Amiodarone', '150 mg', 'Ampoule', 6, 120, 125],
  ['DEMO-M15', 'Tab. Ticagrelor', '90 mg', 'Tablet', 60, 45, 46],
  ['DEMO-M16', 'Inj. Paracetamol infusion', '1 g/100 ml', 'Bottle', 10, 180, 185],
  ['DEMO-M17', 'Inj. Bivalirudin', '250 mg', 'Vial', 1, 14000, 14500],
  ['DEMO-M18', 'Inj. Tenecteplase', '40 mg', 'Vial', 1, 21470, 22000],
  ['DEMO-M19', 'Inj. Enoxaparin', '60 mg', 'Prefilled syringe', 10, 650, 486],   // exceeds
  ['DEMO-M20', 'Protein supplement powder', '400 g', 'Tin', 5, 1700, 1700],       // AMO disallows: nutritional supplement
];
await schedule('MEDICINE', 'DEMO-MEDICINE-2026', MEDS.map(([code, name, specification, unit, , , rate]) => ({ code, name, category: 'MEDICINE', specification, unit, base_rate: rate })));

// ------------------------------------------------------------------ employee, patient, referral
const emp = must(await db.from('employees').upsert({ employee_code: 'MCL/2020/001', full_name: 'Rajesh Kumar', area_id: area.id,
  department: 'Mining', designation: 'Senior Overman', basic_pay: 48000, ward_entitlement: 'SEMI_PRIVATE' }, { onConflict: 'employee_code' }).select().single(), 'employee');
const { data: patEx } = await db.from('patients').select('*').eq('employee_id', emp.id).eq('full_name', 'Rajesh Kumar').maybeSingle();
const pat = patEx ?? must(await db.from('patients').insert({ employee_id: emp.id, full_name: 'Rajesh Kumar', category: 'Employee', gender: 'M' }).select().single(), 'patient');
const { data: refEx } = await db.from('patient_referrals').select('*').eq('referral_no', 'MCL/REF/2026/001').maybeSingle();
const ref = refEx ?? must(await db.from('patient_referrals').insert({
  referral_no: 'MCL/REF/2026/001', patient_id: pat.id, employee_id: emp.id, referring_amo_id: ids.amo, area_id: area.id,
  establishment: 'Area Hospital, Talcher', hospital_id: abc.id, mou_id: mou.id, referral_date: '2026-11-10',
  admission_date: '2026-11-10', discharge_date: '2026-11-17', diagnosis: 'Acute coronary syndrome — single vessel CAD',
  treatment_details: 'CAG followed by PTCA; temporary pacing', ward_entitled: 'SEMI_PRIVATE', ward_occupied: 'SEMI_PRIVATE', created_by: ids.amo,
}).select().single(), 'referral');

// ------------------------------------------------------------------ bill (left in DRAFT so the hospital user submits it in the demo)
const { data: billEx } = await db.from('hospital_bills').select('id').eq('hospital_bill_no', 'ABC/IPD/2026/7781').maybeSingle();
if (!billEx) {
  const bill = must(await db.from('hospital_bills').insert({ referral_id: ref.id, hospital_id: abc.id, amo_id: ids.amo,
    hospital_bill_no: 'ABC/IPD/2026/7781', bill_date: '2026-11-17', bill_type: 'FINAL', created_by: ids.hospital }).select().single(), 'bill');
  const items = [
    ['PROCEDURE', 'Coronary angiography', 'DEMO-P101', '', 'Procedure', 1, 15000, '2026-11-10'],                 // exceeds 12,000
    ['PROCEDURE', 'PTCA single vessel (excluding stent)', 'DEMO-P102', '', 'Procedure', 1, 120000, '2026-11-11'], // exceeds 95,000
    ['PROCEDURE', 'Temporary pacemaker implantation', 'DEMO-P103', '', 'Procedure', 1, 18000, '2026-11-11'],
    ['INVESTIGATION', '2D Echocardiography', 'DEMO-I201', '', 'Test', 1, 2500, '2026-11-10'],                     // exceeds 1,300
    ['INVESTIGATION', 'Complete blood count', 'DEMO-I202', '', 'Test', 3, 300, '2026-11-12'],                     // exceeds 150
    ['INVESTIGATION', 'Liver function test', 'DEMO-I203', '', 'Test', 1, 600, '2026-11-10'],                      // exceeds 390
    ['INVESTIGATION', 'Kidney function test', 'DEMO-I204', '', 'Test', 2, 360, '2026-11-13'],
    ['INVESTIGATION', 'ECG', 'DEMO-I205', '', 'Test', 3, 120, '2026-11-14'],
    ...MEDS.map(([code, name, spec, unit, qty, rate]) => ['MEDICINE', name, code, spec, unit, qty, rate, '2026-11-12']),
  ];
  must(await db.from('hospital_bill_items').insert(items.map(([category, description, cghs_code, specification, unit, quantity, rate_claimed, service_date], i) => ({
    bill_id: bill.id, line_no: i + 1, category, description, cghs_code, specification, unit, quantity, rate_claimed, service_date,
  }))), 'bill items');
  // a small placeholder PDF as the "final hospital bill"
  const pdf = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj 3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 595 842]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj 4 0 obj<</Length 88>>stream\nBT /F1 14 Tf 60 780 Td (DEMO - ABC Multispeciality Hospital - Final bill ABC/IPD/2026/7781) Tj ET\nendstream endobj 5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF');
  const path = `bills/${bill.id}/demo-final-bill.pdf`;
  must(await db.storage.from('mcl-documents').upload(path, pdf, { contentType: 'application/pdf', upsert: true }), 'upload pdf');
  must(await db.from('supporting_documents').insert({ bill_id: bill.id, doc_type: 'FINAL_BILL', file_name: 'demo-final-bill.pdf',
    storage_path: path, mime_type: 'application/pdf', size_bytes: pdf.length, uploaded_by: ids.hospital }), 'document');
  const { data: b } = await db.from('hospital_bills').select('tracking_no, total_claimed').eq('id', bill.id).single();
  console.log(`✔ Demo bill ${b.tracking_no} created (DRAFT) — total claimed ₹${Number(b.total_claimed).toLocaleString('en-IN')}`);
}

writeFileSync('demo-credentials.local.txt',
  `MCL Medical Bill Management System — DEMO logins (fictional users; delete before production)\n` +
  `Sign in with the user ID (or the email) and the password below.\n` +
  `Generated ${new Date().toISOString()}\n\n${creds.join('\n')}\n`);
console.log('✔ Demo data ready. Demo logins written to demo-credentials.local.txt (do not commit or share publicly).');

// ------------------------------------------------------------------ optional: your own personal login
// The person running this types their own user ID, email and password; the password is
// shown only as * and is never printed or saved anywhere.
const askLine = (q) => new Promise((resolve) => {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  rl.question(q, (a) => { rl.close(); resolve(a.replace(/\x1b\[20[01]~/g, '').trim()); });
});
const LOGIN_ID = /^[a-z0-9][a-z0-9._-]{2,39}$/;
console.log('\nOptional: create YOUR OWN login now. You choose the password; it is never shown or saved.');
let myId = (await askLine('Your user ID, for example your first name (or just press Enter to skip): ')).toLowerCase();
while (myId && !LOGIN_ID.test(myId)) {
  myId = (await askLine('User ID must be 3-40 lowercase letters or numbers (dot, dash, underscore allowed). Try again, or Enter to skip: ')).toLowerCase();
}
if (myId) {
  let myEmail = '';
  while (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(myEmail)) myEmail = (await askLine('Your email address (used if you forget the password): ')).toLowerCase();
  const myName = (await askLine('Your name as it should appear in the app: ')) || myId;
  const ROLES = { 1: ['admin', 'Administrator'], 2: ['amo', 'AMO / Doctor'], 3: ['hospital', 'Hospital (ABC)'], 4: ['finance', 'Finance'], 5: ['management', 'Management'] };
  const roleKey = (await askLine('Your role: 1 Administrator, 2 AMO, 3 Hospital, 4 Finance, 5 Management. Type a number [1]: ')) || '1';
  const [myRole, myRoleLabel] = ROLES[roleKey] ?? ROLES[1];
  let pw;
  for (;;) {
    const a = (await askSecret('Choose your password (at least 10 characters, letters AND numbers): ')).replace(/\x1b\[20[01]~/g, '');
    const b = (await askSecret('Type the same password again: ')).replace(/\x1b\[20[01]~/g, '');
    if (a !== b) { console.log('The two passwords did not match. Please try again.'); continue; }
    if (a.length < 10 || !/[A-Za-z]/.test(a) || !/\d/.test(a)) { console.log('Too weak: use at least 10 characters with both letters and numbers. Please try again.'); continue; }
    pw = a; break;
  }
  let uid;
  const created = await db.auth.admin.createUser({ email: myEmail, password: pw, email_confirm: true });
  if (created.error) {
    // already registered: set the newly chosen password on that account
    const { data: list } = await db.auth.admin.listUsers({ page: 1, perPage: 1000 });
    const existing = list?.users?.find((u) => u.email === myEmail);
    if (!existing) { console.error('✘ Could not create your login:', created.error.message); process.exit(1); }
    uid = existing.id;
    must(await db.auth.admin.updateUserById(uid, { password: pw }), 'set your password');
  } else uid = created.data.user.id;
  const { data: clash } = await db.from('users').select('id').eq('login_id', myId).neq('id', uid).maybeSingle();
  if (clash) { console.error(`✘ The user ID "${myId}" is already used by another account. Run again with a different ID.`); process.exit(1); }
  must(await db.from('users').upsert({
    id: uid, email: myEmail, full_name: myName, role: myRole, login_id: myId, active: true,
    hospital_id: myRole === 'hospital' ? abc.id : null, area_id: myRole === 'amo' ? area.id : null,
  }, { onConflict: 'id' }), 'your profile');
  console.log(`✔ Your login is ready: user ID "${myId}" (${myRoleLabel}). Sign in at https://mcl-team-4-psi.vercel.app with your password.`);
}

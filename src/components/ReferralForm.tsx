import { ActionForm, SubmitButton } from './ActionForm';
import { Card, Field } from './ui';
import { WARDS } from '@/lib/status';
import { createReferral } from '@/app/(app)/referrals/actions';

type Opt = { id: string; name: string };

export function ReferralForm({ hospitals, admin }: { hospitals: Opt[]; admin?: { amos: Opt[]; areas: Opt[] } }) {
  const today = new Date().toISOString().slice(0, 10);
  return (
    <ActionForm action={createReferral} className="space-y-5">
      {admin && <input type="hidden" name="return_to" value="admin" />}
      {admin && (
        <Card title="Exception authorisation (administrator)">
          <div className="grid gap-3 md:grid-cols-3">
            <Field label="Referring / responsible AMO"><select name="amo_id" required>{admin.amos.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></Field>
            <Field label="Area"><select name="area_id" required>{admin.areas.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></Field>
            <Field label="Exception reason"><input name="exception_reason" required placeholder="e.g. Emergency admission without prior referral" /></Field>
          </div>
        </Card>
      )}
      <Card title="Employee">
        <div className="grid gap-3 md:grid-cols-4">
          <Field label="Employee ID"><input name="employee_code" required placeholder="MCL/2020/001" /></Field>
          <Field label="Employee name"><input name="employee_name" required /></Field>
          <Field label="Department"><input name="department" /></Field>
          <Field label="Designation"><input name="designation" /></Field>
          <Field label="Basic pay (₹/month)" hint="Used for ward entitlement records"><input name="basic_pay" type="number" min="0" /></Field>
          <Field label="Ward entitlement"><select name="ward_entitled" defaultValue="SEMI_PRIVATE">{WARDS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
        </div>
      </Card>
      <Card title="Patient">
        <div className="grid gap-3 md:grid-cols-4">
          <Field label="Patient category"><select name="patient_category"><option>Employee</option><option>Dependent</option><option>Other</option></select></Field>
          <Field label="Patient name" hint="Leave blank if the patient is the employee"><input name="patient_name" /></Field>
          <Field label="Relationship with employee"><input name="relationship" placeholder="Spouse / Son / Mother…" /></Field>
        </div>
      </Card>
      <Card title="Referral">
        <div className="grid gap-3 md:grid-cols-4">
          <Field label="Hospital" className="md:col-span-2"><select name="hospital_id" required>
            <option value="">Select hospital…</option>{hospitals.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}</select></Field>
          <Field label="Referring establishment"><input name="establishment" placeholder="Area hospital / dispensary" /></Field>
          <Field label="Date of referral"><input name="referral_date" type="date" defaultValue={today} required /></Field>
          <Field label="Date of admission"><input name="admission_date" type="date" /></Field>
          <Field label="Date of discharge"><input name="discharge_date" type="date" /></Field>
          <Field label="Ward occupied"><select name="ward_occupied" defaultValue=""><option value="">Same as entitled</option>{WARDS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
          <Field label="Referral letter (PDF/JPG)"><input type="file" name="letter" accept=".pdf,.jpg,.jpeg,.png" /></Field>
          <Field label="Diagnosis" className="md:col-span-2"><input name="diagnosis" required /></Field>
          <Field label="Treatment details" className="md:col-span-2"><input name="treatment_details" /></Field>
        </div>
      </Card>
      <SubmitButton className="btn-primary">Create referral</SubmitButton>
    </ActionForm>
  );
}

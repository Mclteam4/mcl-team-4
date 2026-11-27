import { NextResponse, type NextRequest } from 'next/server';
import { getUser } from '@/lib/auth';
import { filteredBills } from '@/lib/analytics';
import { toXlsx } from '@/lib/excel';
import { BILL_STATUS } from '@/lib/status';

export async function GET(req: NextRequest) {
  const user = await getUser();
  if (!user) return new NextResponse('Unauthorised', { status: 401 });
  const sp = Object.fromEntries(req.nextUrl.searchParams);
  const bills = await filteredBills({ ...sp, fy: sp.fy ?? 'all' }); // RLS limits rows to what the caller may see
  const rows = bills.map((b) => ({ ...b, status_label: BILL_STATUS[b.status]?.label ?? b.status, reduction: Number(b.total_claimed) - Number(b.final_admissible ?? 0) }));
  const buf = await toXlsx('Bills', [
    { header: 'Tracking no', key: 'tracking_no', width: 24 }, { header: 'Referral no', key: 'referral_no', width: 20 },
    { header: 'Patient', key: 'patient_name', width: 22 }, { header: 'Employee ID', key: 'employee_code' }, { header: 'Area', key: 'area_name' },
    { header: 'Hospital', key: 'hospital_name', width: 30 }, { header: 'AMO', key: 'amo_name', width: 20 }, { header: 'Status', key: 'status_label', width: 26 },
    { header: 'Submitted', key: 'submitted_at', width: 22 }, { header: 'Claimed', key: 'total_claimed', money: true },
    { header: 'Admissible', key: 'final_admissible', money: true }, { header: 'Reduction', key: 'reduction', money: true },
    { header: 'Sanctioned', key: 'sanctioned_amount', money: true }, { header: 'Voucher', key: 'voucher_no' },
    { header: 'SAP doc', key: 'sap_doc_no' }, { header: 'Payment date', key: 'payment_date' },
  ], rows, `MCL Medical Bills — exported ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })} by ${user.full_name}`);
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="mcl-bills-${new Date().toISOString().slice(0, 10)}.xlsx"`,
    },
  });
}

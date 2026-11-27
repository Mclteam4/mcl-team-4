import { NextResponse, type NextRequest } from 'next/server';
import { getUser } from '@/lib/auth';
import { loadBill } from '@/lib/bills';
import { toXlsx } from '@/lib/excel';
import { categoryLabel, DECISION } from '@/lib/status';

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!(await getUser())) return new NextResponse('Unauthorised', { status: 401 });
  const data = await loadBill(id);
  if (!data) return new NextResponse('Not found', { status: 404 });
  const rows = data.items.map((it) => {
    const d = data.decisions.get(it.id);
    return {
      line: it.line_no, category: categoryLabel(it.category), description: it.description, code: it.cghs_code, spec: it.specification, unit: it.unit,
      qty: Number(it.quantity), rate: it.rate_claimed, amount: it.amount_claimed, match: d?.match_status, cghs: d?.cghs_rate,
      adm_qty: d ? Number(d.admissible_qty) : '', adm_rate: d?.admissible_rate, admissible: d?.admissible_amount,
      excess: d ? Number(it.amount_claimed) - Number(d.admissible_amount) : '', decision: d ? DECISION[d.decision]?.label : '', remarks: d?.remarks,
    };
  });
  const buf = await toXlsx('Bill items', [
    { header: '#', key: 'line', width: 5 }, { header: 'Category', key: 'category', width: 14 }, { header: 'Description', key: 'description', width: 36 },
    { header: 'CGHS code', key: 'code' }, { header: 'Specification', key: 'spec' }, { header: 'Unit', key: 'unit', width: 10 },
    { header: 'Qty', key: 'qty', width: 8 }, { header: 'Rate claimed', key: 'rate', money: true }, { header: 'Amount claimed', key: 'amount', money: true },
    { header: 'CGHS check', key: 'match', width: 10 }, { header: 'CGHS rate', key: 'cghs', money: true }, { header: 'Adm. qty', key: 'adm_qty', width: 8 },
    { header: 'Adm. rate', key: 'adm_rate', money: true }, { header: 'Admissible', key: 'admissible', money: true }, { header: 'Excess', key: 'excess', money: true },
    { header: 'Decision', key: 'decision', width: 14 }, { header: 'Remarks', key: 'remarks', width: 40 },
  ], rows, `${data.bill.tracking_no} · ${data.bill.patient_name} · ${data.bill.hospital_name}`);
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${data.bill.tracking_no.replaceAll('/', '-')}.xlsx"`,
    },
  });
}

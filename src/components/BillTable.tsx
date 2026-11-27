import Link from 'next/link';
import { StatusBadge, Empty, TableWrap } from './ui';
import { Countdown } from './Countdown';
import { inr, fmtDate } from '@/lib/format';

/* eslint-disable @typescript-eslint/no-explicit-any */
export function BillTable({ bills, show = [] }: { bills: any[]; show?: ('hospital' | 'amo' | 'deadline' | 'finance' | 'area')[] }) {
  if (!bills.length) return <Empty>No bills found.</Empty>;
  return (
    <TableWrap>
      <table>
        <thead><tr>
          <th>Tracking no.</th><th>Patient / employee</th>
          {show.includes('hospital') && <th>Hospital</th>}
          {show.includes('area') && <th>Area</th>}
          {show.includes('amo') && <th>AMO</th>}
          <th>Status</th>
          <th className="text-right">Claimed</th><th className="text-right">Admissible</th>
          {show.includes('finance') && <><th className="text-right">Sanctioned</th><th>SAP doc</th></>}
          {show.includes('deadline') && <th>Query deadline</th>}
          <th>Updated</th>
        </tr></thead>
        <tbody>
          {bills.map((b) => (
            <tr key={b.id} className="hover:bg-slate-50">
              <td><Link href={`/bills/${b.id}`} className="link whitespace-nowrap">{b.tracking_no}</Link><div className="text-xs text-slate-400">{b.referral_no}</div></td>
              <td>{b.patient_name}<div className="text-xs text-slate-500">{b.employee_code}</div></td>
              {show.includes('hospital') && <td>{b.hospital_name}</td>}
              {show.includes('area') && <td>{b.area_name}</td>}
              {show.includes('amo') && <td>{b.amo_name}</td>}
              <td><StatusBadge status={b.status} />{b.current_round > 1 && <div className="text-xs text-slate-400">round {b.current_round}</div>}</td>
              <td className="text-right tabular-nums">{inr(b.total_claimed)}</td>
              <td className="text-right tabular-nums">{inr(b.final_admissible)}</td>
              {show.includes('finance') && <><td className="text-right tabular-nums">{inr(b.sanctioned_amount)}</td><td className="text-xs">{b.sap_doc_no ?? '—'}</td></>}
              {show.includes('deadline') && <td className="text-xs">{b.status === 'SENT_TO_HOSPITAL' && b.query_deadline ? <Countdown deadline={b.query_deadline} /> : '—'}</td>}
              <td className="whitespace-nowrap text-xs text-slate-500">{fmtDate(b.updated_at)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </TableWrap>
  );
}

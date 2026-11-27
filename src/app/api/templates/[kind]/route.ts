import { NextResponse, type NextRequest } from 'next/server';

const TEMPLATES: Record<string, { name: string; body: string }> = {
  'bill-items': {
    name: 'mcl-bill-items-template.csv',
    body: 'category,description,cghs_code,specification,unit,quantity,rate_claimed,service_date\n'
      + 'MEDICINE,Inj. Heparin,MED-HEP-5000,5000 IU,Vial,10,180,2026-11-02\n'
      + 'INVESTIGATION,Complete blood count,,,Test,2,150,2026-11-01\n'
      + 'PROCEDURE,Coronary angiography,,,Procedure,1,12000,2026-11-02\n'
      + 'ROOM_RENT,Semi-private ward,,,Day,5,3000,\n',
  },
  rates: {
    name: 'mcl-rate-schedule-template.csv',
    body: 'code,name,category,specification,unit,city_class,base_rate,package_days,remarks\n'
      + 'CODE-001,Example procedure name,PROCEDURE,,Procedure,,0.00,,Replace with official CGHS values\n'
      + 'CODE-002,Example package name,PACKAGE,,Package,,0.00,7,\n'
      + 'MED-001,Example medicine,MEDICINE,500 mg,Tablet,,0.00,,Use in a MEDICINE schedule\n',
  },
};

export async function GET(_req: NextRequest, { params }: { params: Promise<{ kind: string }> }) {
  const t = TEMPLATES[(await params).kind];
  if (!t) return new NextResponse('Not found', { status: 404 });
  return new NextResponse('﻿' + t.body, {
    headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${t.name}"` },
  });
}

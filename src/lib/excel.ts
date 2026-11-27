import 'server-only';
import ExcelJS from 'exceljs';

export const normHeader = (h: string) => h.toLowerCase().trim().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') q = false;
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((x) => x.trim() !== ''));
}

function cellText(v: ExcelJS.CellValue): string {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'object') {
    if ('result' in v) return cellText(v.result as ExcelJS.CellValue);
    if ('richText' in v) return v.richText.map((r) => r.text).join('');
    if ('text' in v) return String(v.text);
    return '';
  }
  return String(v);
}

const MAX_BYTES = 10 * 1024 * 1024;
const MAX_ROWS = 20000;

/** Reads the first sheet of an .xlsx or a .csv into objects keyed by normalised header. */
export async function readTabular(file: File): Promise<Record<string, string>[]> {
  if (!file || file.size === 0) throw new Error('Choose a file to upload.');
  if (file.size > MAX_BYTES) throw new Error('File is larger than 10 MB.');
  const name = file.name.toLowerCase();
  let grid: string[][];
  if (name.endsWith('.csv')) {
    grid = parseCsv((await file.text()).replace(/^﻿/, ''));
  } else if (name.endsWith('.xlsx')) {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await file.arrayBuffer());
    const ws = wb.worksheets[0];
    if (!ws) throw new Error('The workbook has no sheets.');
    grid = [];
    ws.eachRow({ includeEmpty: false }, (r) => {
      const vals = r.values as ExcelJS.CellValue[];
      grid.push(vals.slice(1).map(cellText));
    });
  } else {
    throw new Error('Upload an .xlsx or .csv file.');
  }
  if (grid.length < 2) throw new Error('The file has no data rows.');
  if (grid.length > MAX_ROWS + 1) throw new Error(`Too many rows (max ${MAX_ROWS}).`);
  const headers = grid[0].map(normHeader);
  return grid.slice(1).map((r) => Object.fromEntries(headers.map((h, i) => [h, (r[i] ?? '').trim()])));
}

export async function toXlsx(sheet: string, columns: { header: string; key: string; width?: number; money?: boolean }[],
  rows: Record<string, unknown>[], title?: string): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'MCL Medical Bill Management System';
  const ws = wb.addWorksheet(sheet);
  if (title) { ws.addRow([title]).font = { bold: true, size: 13 }; ws.addRow([]); }
  const head = ws.addRow(columns.map((c) => c.header));
  head.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  head.eachCell((c) => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F1F45' } }; });
  rows.forEach((r) => ws.addRow(columns.map((c) => (c.money ? Number(r[c.key] ?? 0) : r[c.key] ?? ''))));
  columns.forEach((c, i) => {
    const col = ws.getColumn(i + 1);
    col.width = c.width ?? 18;
    if (c.money) col.numFmt = '#,##,##0.00';
  });
  return Buffer.from(await wb.xlsx.writeBuffer());
}

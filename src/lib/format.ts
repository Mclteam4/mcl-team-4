const inrFmt = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const inr0 = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });

export const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
export const inr = (v: unknown) => (v === null || v === undefined || v === '' ? '—' : '₹' + inrFmt.format(num(v)));
export const inrShort = (v: unknown) => {
  const n = num(v);
  if (Math.abs(n) >= 1e7) return '₹' + (n / 1e7).toFixed(2) + ' Cr';
  if (Math.abs(n) >= 1e5) return '₹' + (n / 1e5).toFixed(2) + ' L';
  return '₹' + inr0.format(n);
};

const TZ = 'Asia/Kolkata';
export const fmtDate = (v: string | null | undefined) =>
  v ? new Date(v.length === 10 ? v + 'T00:00:00+05:30' : v).toLocaleDateString('en-IN', { timeZone: TZ, day: '2-digit', month: 'short', year: 'numeric' }) : '—';
export const fmtDateTime = (v: string | null | undefined) =>
  v ? new Date(v).toLocaleString('en-IN', { timeZone: TZ, day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';

/** Indian financial year label for a date, e.g. 2026-11-27 → "2026-27". */
export const finYear = (d: string | Date) => {
  const x = typeof d === 'string' ? new Date(d) : d;
  const y = x.getMonth() >= 3 ? x.getFullYear() : x.getFullYear() - 1;
  return `${y}-${String((y + 1) % 100).padStart(2, '0')}`;
};
export const finYearRange = (fy: string) => {
  const y = Number(fy.slice(0, 4));
  return { from: `${y}-04-01`, to: `${y + 1}-03-31` };
};

export function amountInWords(n: number): string {
  const ones = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve',
    'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
  const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
  const two = (x: number) => (x < 20 ? ones[x] : tens[Math.floor(x / 10)] + (x % 10 ? ' ' + ones[x % 10] : ''));
  const three = (x: number) => (x >= 100 ? ones[Math.floor(x / 100)] + ' Hundred' + (x % 100 ? ' ' + two(x % 100) : '') : two(x));
  const words = (x: number): string => {
    if (x === 0) return 'Zero';
    const parts: string[] = [];
    const cr = Math.floor(x / 1e7); x %= 1e7;
    const lk = Math.floor(x / 1e5); x %= 1e5;
    const th = Math.floor(x / 1e3); x %= 1e3;
    if (cr) parts.push(words(cr) + ' Crore');
    if (lk) parts.push(two(lk) + ' Lakh');
    if (th) parts.push(two(th) + ' Thousand');
    if (x) parts.push(three(x));
    return parts.join(' ');
  };
  const r = Math.floor(n); const p = Math.round((n - r) * 100);
  return 'Rupees ' + words(r) + (p ? ' and ' + two(p) + ' Paise' : '') + ' Only';
}

'use client';
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, PieChart, Pie, Cell, Legend, LineChart, Line,
} from 'recharts';

const NAVY = '#1e3a7b';
const PALETTE = ['#1e3a7b', '#0e7490', '#15803d', '#b45309', '#b91c1c', '#6d28d9', '#475569', '#be185d', '#0369a1', '#4d7c0f'];
const inr = (v: number) => '₹' + new Intl.NumberFormat('en-IN', { notation: 'compact', maximumFractionDigits: 1 }).format(v);
const tip = (v: unknown) => '₹' + new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(Number(v));

type Row = Record<string, string | number>;

export function BarCard({ data, x, bars, money = true, height = 260, horizontal }: {
  data: Row[]; x: string; bars: { key: string; label: string; color?: string }[]; money?: boolean; height?: number; horizontal?: boolean;
}) {
  if (!data.length) return <div className="py-10 text-center text-sm text-slate-400">No data for the selected filters</div>;
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} layout={horizontal ? 'vertical' : 'horizontal'} margin={{ left: horizontal ? 20 : 0, right: 10, top: 5 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
        {horizontal ? (
          <>
            <XAxis type="number" tickFormatter={money ? inr : undefined} fontSize={11} />
            <YAxis type="category" dataKey={x} width={140} fontSize={11} />
          </>
        ) : (
          <>
            <XAxis dataKey={x} fontSize={11} />
            <YAxis tickFormatter={money ? inr : undefined} fontSize={11} width={60} allowDecimals={!money ? false : undefined} />
          </>
        )}
        <Tooltip formatter={money ? tip : undefined} />
        {bars.length > 1 && <Legend wrapperStyle={{ fontSize: 12 }} />}
        {bars.map((b, i) => <Bar key={b.key} dataKey={b.key} name={b.label} fill={b.color ?? PALETTE[i]} radius={[3, 3, 0, 0]} />)}
      </BarChart>
    </ResponsiveContainer>
  );
}

export function LineCard({ data, x, lines, height = 260 }: { data: Row[]; x: string; lines: { key: string; label: string }[]; height?: number }) {
  if (!data.length) return <div className="py-10 text-center text-sm text-slate-400">No data for the selected filters</div>;
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ right: 10, top: 5 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
        <XAxis dataKey={x} fontSize={11} />
        <YAxis tickFormatter={inr} fontSize={11} width={60} />
        <Tooltip formatter={tip} />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        {lines.map((l, i) => <Line key={l.key} dataKey={l.key} name={l.label} stroke={PALETTE[i] ?? NAVY} strokeWidth={2} dot={false} />)}
      </LineChart>
    </ResponsiveContainer>
  );
}

export function PieCard({ data, money = false, height = 260 }: { data: { name: string; value: number }[]; money?: boolean; height?: number }) {
  if (!data.length) return <div className="py-10 text-center text-sm text-slate-400">No data for the selected filters</div>;
  return (
    <ResponsiveContainer width="100%" height={height}>
      <PieChart>
        <Pie data={data} dataKey="value" nameKey="name" innerRadius={55} outerRadius={90} paddingAngle={1}>
          {data.map((_, i) => <Cell key={i} fill={PALETTE[i % PALETTE.length]} />)}
        </Pie>
        <Tooltip formatter={money ? tip : undefined} />
        <Legend wrapperStyle={{ fontSize: 11 }} />
      </PieChart>
    </ResponsiveContainer>
  );
}

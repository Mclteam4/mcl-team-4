'use client';
import { useEffect, useState } from 'react';

/** Display-only countdown. The deadline itself is enforced on the server. */
export function Countdown({ deadline }: { deadline: string }) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);
  if (now === null) return null;
  const ms = Date.parse(deadline) - now;
  if (ms <= 0) return <span className="font-semibold text-red-700">Query period over — awaiting automatic forwarding</span>;
  const d = Math.floor(ms / 86_400_000), h = Math.floor((ms % 86_400_000) / 3_600_000), m = Math.floor((ms % 3_600_000) / 60_000);
  const urgent = ms < 48 * 3_600_000;
  return <span className={urgent ? 'font-semibold text-red-700' : 'font-semibold text-navy-800'}>{d}d {h}h {m}m left</span>;
}

'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import clsx from 'clsx';
import {
  LayoutDashboard, Users, Building2, FileSpreadsheet, Settings, ScrollText, ClipboardList, Search, Bell,
  BarChart3, Wallet, Stethoscope, Menu, X, LogOut, FilePlus2,
} from 'lucide-react';
import type { Role } from '@/lib/auth';

type Item = { href: string; label: string; icon: React.ComponentType<{ className?: string }> };
const NAV: Record<Role, Item[]> = {
  admin: [
    { href: '/admin', label: 'Dashboard', icon: LayoutDashboard },
    { href: '/admin/users', label: 'Users & AMO mapping', icon: Users },
    { href: '/admin/hospitals', label: 'Hospitals & MOUs', icon: Building2 },
    { href: '/admin/rates', label: 'CGHS rate master', icon: FileSpreadsheet },
    { href: '/admin/referrals', label: 'Referrals & exceptions', icon: ClipboardList },
    { href: '/admin/settings', label: 'Settings', icon: Settings },
    { href: '/admin/audit', label: 'Audit log', icon: ScrollText },
    { href: '/management', label: 'Reports', icon: BarChart3 },
  ],
  hospital: [
    { href: '/hospital', label: 'Dashboard', icon: LayoutDashboard },
    { href: '/hospital/referrals', label: 'Referred patients', icon: ClipboardList },
  ],
  amo: [
    { href: '/amo', label: 'Verification dashboard', icon: Stethoscope },
    { href: '/amo/referrals', label: 'My referrals', icon: ClipboardList },
    { href: '/amo/referrals/new', label: 'New referral', icon: FilePlus2 },
  ],
  finance: [{ href: '/finance', label: 'Reimbursements', icon: Wallet }],
  management: [{ href: '/management', label: 'Dashboard', icon: BarChart3 }],
};
const COMMON: Item[] = [
  { href: '/search', label: 'Search & track', icon: Search },
  { href: '/notifications', label: 'Notifications', icon: Bell },
];

export function Sidebar({ role, name, roleLabel, unread, signOut }: {
  role: Role; name: string; roleLabel: string; unread: number; signOut: () => Promise<void>;
}) {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const items = [...NAV[role], ...COMMON];
  const isActive = (href: string) => path === href || (href.split('/').length > 2 && path.startsWith(href + '/'));

  return (
    <>
      <div className="no-print sticky top-0 z-30 flex items-center justify-between bg-navy-900 px-4 py-3 text-white lg:hidden">
        <span className="text-sm font-semibold">MCL Medical Bill Management</span>
        <button onClick={() => setOpen(!open)} aria-label="Toggle menu">{open ? <X /> : <Menu />}</button>
      </div>
      <aside className={clsx('no-print fixed inset-y-0 left-0 z-40 flex w-64 flex-col bg-navy-900 text-slate-200 transition-transform lg:translate-x-0',
        open ? 'translate-x-0' : '-translate-x-full')}>
        <div className="border-b border-white/10 px-5 py-4">
          <div className="text-[11px] font-semibold uppercase tracking-widest text-sky-300">Mahanadi Coalfields Ltd</div>
          <div className="mt-1 text-sm font-bold leading-tight text-white">MCL MEDICAL BILL<br />MANAGEMENT SYSTEM</div>
          <div className="mt-1 text-[11px] text-slate-400">Hospital Bill Verification &amp; Reimbursement Portal</div>
        </div>
        <nav className="flex-1 space-y-0.5 overflow-y-auto px-3 py-3">
          {items.map(({ href, label, icon: Icon }) => (
            <Link key={href} href={href} onClick={() => setOpen(false)}
              className={clsx('flex items-center gap-2.5 rounded-md px-3 py-2 text-sm',
                isActive(href) ? 'bg-white/10 font-semibold text-white' : 'hover:bg-white/5 hover:text-white')}>
              <Icon className="h-4 w-4 shrink-0" />
              <span className="flex-1">{label}</span>
              {href === '/notifications' && unread > 0 && (
                <span className="rounded-full bg-red-600 px-1.5 text-xs font-semibold text-white">{unread}</span>
              )}
            </Link>
          ))}
        </nav>
        <div className="border-t border-white/10 px-4 py-3">
          <div className="truncate text-sm font-medium text-white">{name}</div>
          <div className="text-xs text-slate-400">{roleLabel}</div>
          <form action={signOut}>
            <button className="mt-2 flex items-center gap-1.5 text-xs text-slate-300 hover:text-white"><LogOut className="h-3.5 w-3.5" /> Sign out</button>
          </form>
        </div>
      </aside>
      {open && <div className="fixed inset-0 z-30 bg-black/40 lg:hidden" onClick={() => setOpen(false)} />}
    </>
  );
}

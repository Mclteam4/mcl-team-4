import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: { default: 'MCL Medical Bill Management System', template: '%s · MCL Medical Bills' },
  description: 'Hospital Bill Verification & Reimbursement Portal — Mahanadi Coalfields Limited',
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-IN">
      <body>{children}</body>
    </html>
  );
}

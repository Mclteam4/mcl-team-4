import Link from 'next/link';

export default function NotFound() {
  return (
    <main className="flex min-h-[60vh] items-center justify-center p-6 text-center">
      <div>
        <h1 className="text-xl font-semibold">Not found or not authorised</h1>
        <p className="mt-1 text-sm text-slate-500">The record does not exist, or your role does not have access to it.</p>
        <Link href="/" className="btn btn-primary mt-4">Go to dashboard</Link>
      </div>
    </main>
  );
}

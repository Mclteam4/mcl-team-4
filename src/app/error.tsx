'use client';

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="flex min-h-[60vh] items-center justify-center p-6 text-center">
      <div>
        <h1 className="text-xl font-semibold">Something went wrong</h1>
        <p className="mt-1 text-sm text-slate-500">Please try again. If the problem continues, contact the MCL administrator{error.digest ? ` (ref ${error.digest})` : ''}.</p>
        <button onClick={reset} className="btn btn-primary mt-4">Try again</button>
      </div>
    </main>
  );
}

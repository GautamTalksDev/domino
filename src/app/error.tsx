'use client';

import Link from 'next/link';
import { RotateCcw } from 'lucide-react';

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="card card-glow mx-auto mt-20 max-w-lg p-8 text-center sm:mt-28 sm:p-10">
      <p className="kicker">Something went wrong</p>
      <h1 className="font-display mt-3 text-3xl font-semibold sm:text-4xl">A domino fell the wrong way</h1>
      <p className="mt-4 leading-relaxed text-bone-2">
        The details are in the server log, never on this page. If it keeps happening, check that FalkorDB is running, then try again.
      </p>
      {error.digest && <p className="mono mt-3 text-[11px] text-mute">reference {error.digest}</p>}
      <div className="mt-7 flex flex-wrap justify-center gap-3">
        <button className="btn btn-primary" onClick={reset}>
          <RotateCcw size={15} /> Try again
        </button>
        <Link href="/" className="btn btn-ghost">
          Home
        </Link>
      </div>
    </div>
  );
}

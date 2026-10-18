import Link from 'next/link';
import { ArrowRight } from 'lucide-react';

export default function NotFound() {
  return (
    <div className="mx-auto mt-20 max-w-lg text-center sm:mt-28">
      {/* One domino left standing: the page you wanted isn't in the chain. */}
      <svg width="132" height="84" viewBox="0 0 132 84" className="mx-auto" aria-hidden>
        <g transform="rotate(-78 34 78)">
          <rect x="22" y="14" width="26" height="64" rx="5" fill="#2a2730" stroke="rgba(244,239,228,0.18)" />
        </g>
        <g transform="rotate(-78 70 78)">
          <rect x="58" y="14" width="26" height="64" rx="5" fill="#2a2730" stroke="rgba(244,239,228,0.18)" />
        </g>
        <rect x="98" y="14" width="26" height="64" rx="5" fill="#f4ecdd" />
        <line x1="102" y1="46" x2="120" y2="46" stroke="#17151a" strokeWidth="1.5" opacity="0.7" />
        <circle cx="111" cy="30" r="3.2" fill="#ff5b3a" />
        <circle cx="111" cy="62" r="3.2" fill="#17151a" />
      </svg>
      <p className="kicker mt-8">404</p>
      <h1 className="font-display mt-3 text-4xl font-semibold sm:text-5xl">Nothing fell here</h1>
      <p className="mt-4 text-bone-2">That page or patient isn’t in this clinic’s graph.</p>
      <div className="mt-8 flex flex-wrap justify-center gap-3">
        <Link href="/patients" className="btn btn-primary">
          Back to patients <ArrowRight size={15} />
        </Link>
        <Link href="/" className="btn btn-ghost">
          Home
        </Link>
      </div>
      <p className="mt-6 text-xs text-mute">
        Or press <kbd className="kbd">/</kbd> to jump anywhere.
      </p>
    </div>
  );
}

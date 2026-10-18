'use client';

import { Compass } from 'lucide-react';
import { startJudgeTour } from './JudgeTour';

/** Starts the guided three-minute tour of all three tracks. */
export function TourButton({ className = 'btn btn-hot', label = 'Take the 3-minute tour' }: { className?: string; label?: string }) {
  return (
    <button onClick={startJudgeTour} className={className}>
      <Compass size={16} /> {label}
    </button>
  );
}

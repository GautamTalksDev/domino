'use client';

import Link from 'next/link';
import type { ComponentProps, PointerEvent } from 'react';

// A link card that tilts toward the pointer with a soft glare, like a physical card under a light.
// Pure CSS transforms driven by two custom properties; nothing happens under prefers-reduced-motion.
export function TiltLink({ className = '', children, ...props }: ComponentProps<typeof Link>) {
  const move = (e: PointerEvent<HTMLAnchorElement>) => {
    if (e.pointerType !== 'mouse') return;
    const r = e.currentTarget.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width;
    const y = (e.clientY - r.top) / r.height;
    e.currentTarget.style.setProperty('--rx', `${(0.5 - y) * 7}deg`);
    e.currentTarget.style.setProperty('--ry', `${(x - 0.5) * 9}deg`);
    e.currentTarget.style.setProperty('--gx', `${x * 100}%`);
    e.currentTarget.style.setProperty('--gy', `${y * 100}%`);
  };
  const leave = (e: PointerEvent<HTMLAnchorElement>) => {
    e.currentTarget.style.setProperty('--rx', '0deg');
    e.currentTarget.style.setProperty('--ry', '0deg');
  };
  return (
    <Link {...props} className={`tilt ${className}`} onPointerMove={move} onPointerLeave={leave}>
      {children}
    </Link>
  );
}

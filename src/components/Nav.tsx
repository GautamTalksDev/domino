'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import { Menu, Search, X } from 'lucide-react';
import { CommandPalette, openCommandPalette } from './CommandPalette';
import { Shortcuts } from './Shortcuts';
import { ActivityBell } from './ActivityBell';
import { useModKey } from '@/lib/useModKey';
import { Wordmark } from './Logo';
import { StatusPill } from './StatusPill';
import { ScopeSwitcher, type ScopeInfo } from './ScopeSwitcher';

const LINKS = [
  { href: '/patients', label: 'Patients' },
  { href: '/inbox', label: 'Inbox' },
  { href: '/team', label: 'Care team' },
  { href: '/check', label: 'Prescriber check' },
  { href: '/checkup', label: 'Try a list' },
  { href: '/population', label: 'Population' },
  { href: '/graph', label: 'Graph' },
  { href: '/evaluation', label: 'Evaluation' },
  { href: '/how', label: 'How it works' },
];

export function Nav({ scope }: { scope: ScopeInfo }) {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const mod = useModKey();
  return (
    <header className="no-print sticky top-0 z-40 border-b hairline bg-ink/80 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-[1360px] items-center gap-4 px-4 sm:px-6 2xl:gap-6">
        <Link href="/" aria-label="Domino home" className="shrink-0">
          <Wordmark />
        </Link>
        <nav aria-label="Main" className="hidden flex-1 items-center gap-0.5 xl:flex">
          {LINKS.map((l) => {
            const active = path === l.href || path.startsWith(l.href + '/');
            return (
              <Link
                key={l.href}
                href={l.href}
                aria-current={active ? 'page' : undefined}
                className={`nav-link whitespace-nowrap rounded-lg px-2.5 py-1.5 text-sm transition-colors ${active ? 'text-bone' : 'text-dim hover:bg-white/[0.04] hover:text-bone'}`}
              >
                {l.label}
              </Link>
            );
          })}
        </nav>
        <div className="ml-auto flex items-center gap-2.5">
          <button
            onClick={openCommandPalette}
            className="group flex items-center gap-2 rounded-xl border hairline bg-white/[0.03] py-1.5 pl-2.5 pr-1.5 text-xs text-dim transition hover:border-white/20 hover:text-bone"
            aria-label={`Search ${mod}K: patients, pages and actions`}
          >
            <Search size={14} />
            <span className="hidden 2xl:inline">Search</span>
            <span className="kbd hidden min-w-[44px] sm:inline-flex">{mod}K</span>
          </button>
          <StatusPill />
          <ActivityBell key={`${scope.clinic.id}:${scope.user.id}`} me={scope.user.name} />
          <ScopeSwitcher scope={scope} />
          <button className="btn btn-ghost px-2.5 xl:hidden" aria-label={open ? 'Close menu' : 'Open menu'} onClick={() => setOpen(!open)}>
            {open ? <X size={18} /> : <Menu size={18} />}
          </button>
        </div>
      </div>
      <CommandPalette scope={scope} />
      <Shortcuts />
      {open && (
        <nav aria-label="Mobile" className="border-t hairline px-4 py-3 xl:hidden">
          <div className="grid grid-cols-2 gap-1">
            {LINKS.map((l) => {
              const active = path === l.href || path.startsWith(l.href + '/');
              return (
                <Link
                  key={l.href}
                  href={l.href}
                  onClick={() => setOpen(false)}
                  aria-current={active ? 'page' : undefined}
                  className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm hover:bg-white/5 ${active ? 'bg-white/[0.06] text-bone' : 'text-bone-2'}`}
                >
                  {active && <span className="h-1.5 w-1.5 rounded-full bg-vermilion" />}
                  {l.label}
                </Link>
              );
            })}
          </div>
        </nav>
      )}
    </header>
  );
}

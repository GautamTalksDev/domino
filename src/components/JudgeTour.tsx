'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { ArrowLeft, ArrowRight, Compass, Sparkles, X } from 'lucide-react';

// A guided walk through all three tracks in about three minutes, across pages: a floating card says what to look at,
// a soft ring marks it, and the one action each step needs is a button. Start it from the landing page, ⌘K, or
// any URL with ?judge=1. It never blocks the page: everything stays clickable.

interface Step {
  path: string;
  /** What to ring, as a [data-tour] name. */
  target?: string;
  track: string;
  title: string;
  body: string;
  action?: { label: string; run: () => void };
  /** What the action opens, to bring into view once it appears (defaults to the step's target). */
  reveal?: string;
}

const fill = () =>
  window.dispatchEvent(
    new CustomEvent('domino:fill-note', {
      detail: {
        kind: 'handover',
        title: 'Beatrice has a dry cough',
        text: 'Beatrice Hale has had a dry, tickly cough for three weeks; it keeps her up at night. Her daughter asked if she could have something for it.',
      },
    }),
  );

const clickText = (text: string) => {
  const b = [...document.querySelectorAll<HTMLButtonElement>('button')].find((x) => x.textContent?.trim().startsWith(text));
  b?.click();
};

const STEPS: Step[] = [
  {
    path: '/',
    target: 'hero',
    track: 'The problem',
    title: 'Some pills are treating other pills',
    body: 'Beatrice, 84, takes nine medicines from five prescribers. A side effect of the first was mistaken for a new illness and treated with a second drug, then a third. That chain is a path in a graph.',
  },
  {
    path: '/patients/p-beatrice?tour=1',
    target: 'agents',
    track: 'Track 01 · Agents on connected data',
    title: 'Three agents review her on FalkorDB',
    body: 'The Detective walks her slice of the graph for multi-hop cascades, hands off to the Pharmacist through a signed message stored in the graph, and the Scribe proposes tasks. Open any step to see the exact Cypher it ran.',
  },
  {
    path: '/patients/p-beatrice?tour=1',
    target: 'provenance',
    track: 'Track 01 · Explainable results',
    title: 'How Domino got here',
    body: 'Every finding has a provenance graph: the run, the agent step, the queries, the drugs, pattern and references it rests on, and the task it led to. Provenance is edges in FalkorDB, not log lines.',
    action: { label: 'Open the provenance graph', run: () => clickText('How Domino got here') },
  },
  {
    path: '/patients/p-beatrice?tour=1',
    target: 'agents',
    track: 'Track 01 · Names resolved, never guessed',
    title: 'Not in the graph is not safe',
    body: 'Ask about a medicine Domino doesn’t know. Every name is resolved against the graph’s full-text index; Entresto is not among its 116 medicines, so Domino says it did not check it instead of guessing. An EHR order or a pasted list gets the same answer.',
    action: {
      label: 'Ask “Is Entresto safe with her amlodipine?”',
      run: () => window.dispatchEvent(new CustomEvent('domino:ask', { detail: { question: 'Is Entresto safe with her amlodipine?' } })),
    },
  },
  {
    path: '/check?patient=p-rosa',
    target: 'check-examples',
    track: 'Track 01 · Acting before harm',
    title: 'Stop the next cascade before it is written',
    body: 'Prescribe benztropine for Rosa and the same engine says “stop and check”: it treats a side effect of her risperidone. Replayed over a synthetic cohort’s 2,443 prescriptions, this check would have stopped three in four cascades at the first downstream drug.',
    action: { label: 'Try Rosa + benztropine', run: () => clickText('Rosa + benztropine') },
  },
  {
    path: '/ehr',
    target: 'ehr',
    track: 'Track 01 · Inside the EHR',
    title: 'The same check, where orders are signed',
    body: 'Prescribers sign orders in their EHR, so Domino answers there too, over CDS Hooks, the HL7 standard behind order-entry alerts. Sign benztropine for Rosa in this fictional EHR: a standard card pauses the order, one click holds it, and the prescriber’s answer is stored in FalkorDB as memory.',
    action: { label: 'Sign benztropine for Rosa', run: () => window.dispatchEvent(new Event('domino:ehr-example')) },
    reveal: '[role="alertdialog"]',
  },
  {
    path: '/patients/p-walter',
    target: 'agents',
    track: 'Track 02 · Memory',
    title: 'The same question twice',
    body: 'Walter’s review flags tamsulosin → meclizine for his dizziness, but his doctor knows the meclizine is for vertigo diagnosed first. This runs his review, signs that decision into the graph, and runs the review again: the Detective reads it, stops raising the link and says what changed. If another visitor did this today, both runs already agree; the demo resets every night.',
    action: {
      label: 'Review, decide, review again',
      run: () =>
        window.dispatchEvent(
          new CustomEvent('domino:review-twice', {
            detail: { from: 'tamsulosin', to: 'meclizine', verdict: 'not_cascade', reason: 'Meclizine is for his vertigo, diagnosed by ENT before the tamsulosin.' },
          }),
        ),
    },
  },
  {
    path: '/inbox',
    target: 'inbox',
    track: 'Track 02 · Memory and coordination',
    title: 'Every decision teaches it, and everyone sees it',
    body: 'Tasks are signed proposals. Dismiss a “high blood pressure from Naproxen” task and procedural memory re-learns who those tasks go to. Mark a review done and the agents schedule their own four-week follow-up. Open this page in a second browser as Dr. Okafor: her decisions reach yours within seconds.',
  },
  {
    path: '/team#team-notes',
    target: 'notes',
    track: 'Track 03 · The care-team brain',
    title: 'A handover becomes an agent action',
    body: 'Notes, tasks and chats live in the same graph as the medicines. Save this handover and the Detective reads it against Beatrice’s drugs: lisinopril causes a dry cough and nothing treats it yet, so it raises a signed task before a cough syrup is prescribed.',
    action: { label: 'Fill in the example handover', run: fill },
  },
  {
    path: '/graph',
    target: 'graph3d',
    track: 'Why FalkorDB',
    title: 'One graph, every path',
    body: 'Every drug, every side effect, every CAUSES and TREATED_BY edge, with Beatrice’s cascade lit inside it. Remove FalkorDB and nothing works: findings, memory, leases, search and tenancy are all graph queries.',
  },
];

const KEY = 'domino:judge-tour';

export function startJudgeTour() {
  window.dispatchEvent(new Event('domino:judge-tour'));
}

export function JudgeTour() {
  const router = useRouter();
  const path = usePathname();
  const [step, setStep] = useState<number | null>(null);
  const [ring, setRing] = useState<DOMRect | null>(null);
  const [mini, setMini] = useState(false);
  const target = useRef<HTMLElement | null>(null);
  const moved = useRef(false);
  // When a person moves between steps (or reopens the card), keep keyboard and screen-reader focus in the tour, on the
  // new step's title. The title remounts with each step, so a callback ref catches it whenever it appears.
  const headingEl = useRef<HTMLHeadingElement | null>(null);
  const heading = useCallback((el: HTMLHeadingElement | null) => {
    headingEl.current = el;
    if (el && moved.current) {
      moved.current = false;
      el.focus({ preventScroll: true });
    }
  }, []);
  // "Take me there" keeps the same step (the title does not remount): when the page arrives, focus the title, so focus
  // is not left on the button that just disappeared.
  useEffect(() => {
    if (!moved.current || !headingEl.current) return;
    moved.current = false;
    headingEl.current.focus({ preventScroll: true });
  }, [step, mini, path]);

  const save = (n: number | null) => {
    try {
      if (n === null) sessionStorage.removeItem(KEY);
      else sessionStorage.setItem(KEY, String(n));
    } catch {
      /* private mode: the tour still works for this page view */
    }
  };

  const go = useCallback(
    (n: number) => {
      moved.current = true;
      setStep(n);
      setMini(false);
      save(n);
      const s = STEPS[n];
      const here = window.location.pathname + window.location.search;
      if (here !== s.path.split('#')[0]) router.push(s.path);
    },
    [router],
  );

  // Start from the button, from ⌘K, or from ?judge=1; carry on after a reload.
  useEffect(() => {
    const onStart = () => go(0);
    window.addEventListener('domino:judge-tour', onStart);
    const params = new URLSearchParams(window.location.search);
    if (params.get('judge') === '1') go(0);
    else {
      try {
        const saved = sessionStorage.getItem(KEY);
        if (saved !== null && STEPS[Number(saved)]) setStep(Number(saved));
      } catch {
        /* ignore */
      }
    }
    return () => window.removeEventListener('domino:judge-tour', onStart);
  }, [go]);

  // Find the step's target on the page (it may render a moment after navigation) and keep the ring on it.
  useEffect(() => {
    if (step === null) return;
    const s = STEPS[step];
    target.current = null;
    setRing(null);
    let tries = 0;
    let scrolled = false;
    const find = () => {
      const el = s.target ? document.querySelector<HTMLElement>(`[data-tour="${s.target}"]`) : null;
      if (el) {
        target.current = el;
        if (!scrolled) {
          scrolled = true;
          const r = el.getBoundingClientRect();
          if (r.top < 70 || r.top > window.innerHeight * 0.45) window.scrollTo({ top: Math.max(0, r.top + window.scrollY - 96), behavior: 'smooth' });
        }
        setRing(el.getBoundingClientRect());
      } else if (tries++ < 40) setRing(null);
    };
    find();
    const t = setInterval(find, 250);
    const onScroll = () => target.current && setRing(target.current.getBoundingClientRect());
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      clearInterval(t);
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
    };
  }, [step, path]);

  const end = () => {
    setStep(null);
    setRing(null);
    save(null);
  };

  if (step === null) return null;
  const s = STEPS[step];
  const last = step === STEPS.length - 1;
  const onPage = typeof window !== 'undefined' && window.location.pathname === s.path.split(/[?#]/)[0];

  return (
    <>
      {ring && ring.width > 0 && (
        <div
          aria-hidden
          className="pointer-events-none fixed z-[60] rounded-[22px] transition-all duration-300"
          style={{
            left: ring.left - 8,
            top: ring.top - 8,
            width: ring.width + 16,
            height: ring.height + 16,
            boxShadow: '0 0 0 2px rgba(255,91,58,0.85), 0 0 0 7px rgba(255,91,58,0.14), 0 0 40px 4px rgba(255,91,58,0.18)',
          }}
        />
      )}
      <AnimatePresence mode="wait">
        <motion.aside
          key={mini ? 'mini' : 'card'}
          role="region"
          aria-label="Guided tour"
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 8 }}
          transition={{ type: 'spring', stiffness: 320, damping: 30 }}
          className="no-print fixed bottom-4 left-4 right-4 z-[85] sm:right-auto sm:w-[400px]"
        >
          {mini ? (
            <button
              onClick={() => {
                moved.current = true;
                setMini(false);
              }}
              className="card card-pop flex items-center gap-2 px-3.5 py-2.5 text-sm text-bone"
            >
              <Compass size={15} className="text-vermilion-2" /> Tour · step {step + 1} of {STEPS.length}
            </button>
          ) : (
            <div className="card card-pop overflow-hidden">
              <div className="h-0.5 bg-white/[0.06]">
                <div className="h-full bg-gradient-to-r from-vermilion/70 to-vermilion transition-all duration-500" style={{ width: `${((step + 1) / STEPS.length) * 100}%` }} />
              </div>
              <div className="p-4 sm:p-5">
                <div className="flex items-start justify-between gap-3">
                  <p className="kicker text-vermilion-2">
                    {step + 1} / {STEPS.length} · {s.track}
                  </p>
                  <div className="-mr-1.5 -mt-1.5 flex">
                    <button onClick={() => setMini(true)} className="rounded-lg px-2 py-1 text-[11px] text-mute hover:text-bone" aria-label="Minimise the tour">
                      hide
                    </button>
                    <button onClick={end} className="rounded-lg p-1.5 text-mute hover:text-bone" aria-label="End the tour">
                      <X size={15} />
                    </button>
                  </div>
                </div>
                <div aria-live="polite" aria-atomic="true">
                  <motion.div key={step} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.22 }}>
                    <h2 ref={heading} tabIndex={-1} className="font-display mt-2 text-xl font-semibold leading-snug outline-none">
                      {s.title}
                    </h2>
                    <p className="mt-2 text-[13.5px] leading-relaxed text-bone-2">{s.body}</p>
                  </motion.div>
                </div>
                {s.action && onPage && (
                  <button
                    onClick={() => {
                      s.action!.run();
                      // Bring what the action opened into view, once it appears (an action may wait on the network).
                      const sel = s.reveal ?? (s.target ? `[data-tour="${s.target}"]` : null);
                      let waited = 0;
                      const show = () => {
                        const el = sel ? document.querySelector<HTMLElement>(sel) : null;
                        if (el) window.scrollTo({ top: Math.max(0, el.getBoundingClientRect().top + window.scrollY - 96), behavior: 'smooth' });
                        else if ((waited += 200) < 8000) setTimeout(show, 200);
                      };
                      setTimeout(show, 350);
                    }}
                    className="btn btn-ghost mt-3 w-full justify-center border-vermilion/30 text-vermilion-2 hover:text-bone"
                  >
                    <Sparkles size={14} /> {s.action.label}
                  </button>
                )}
                {!onPage && (
                  <button onClick={() => go(step)} className="btn btn-ghost mt-3 w-full justify-center">
                    Take me there <ArrowRight size={14} />
                  </button>
                )}
                <div className="mt-4 flex items-center justify-between">
                  <button onClick={() => step > 0 && go(step - 1)} disabled={step === 0} className="btn btn-ghost px-3 disabled:opacity-30">
                    <ArrowLeft size={14} /> Back
                  </button>
                  {last ? (
                    <button onClick={end} className="btn btn-hot">
                      Finish
                    </button>
                  ) : (
                    <button onClick={() => go(step + 1)} className="btn btn-hot">
                      Next <ArrowRight size={14} />
                    </button>
                  )}
                </div>
              </div>
            </div>
          )}
        </motion.aside>
      </AnimatePresence>
    </>
  );
}

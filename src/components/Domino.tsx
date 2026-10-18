'use client';
import { motion } from 'motion/react';
import type { CascadeTree, Link } from '@/lib/engine/types';

const PIPS: Record<number, number[]> = {
  0: [],
  1: [4],
  2: [0, 8],
  3: [0, 4, 8],
  4: [0, 2, 6, 8],
  5: [0, 2, 4, 6, 8],
  6: [0, 2, 3, 5, 6, 8],
};

export type TileState = 'idle' | 'hit' | 'freed' | 'planned' | 'lifted';

export function DominoTile({
  name,
  sub,
  pips = 1,
  state = 'idle',
  root = false,
  size = 'md',
  delay = 0,
  animate = true,
  onClick,
  label,
}: {
  name: string;
  sub?: string;
  pips?: number;
  state?: TileState;
  root?: boolean;
  size?: 'md' | 'sm';
  delay?: number;
  animate?: boolean;
  onClick?: () => void;
  label?: string;
}) {
  const cls = [
    'tile',
    size === 'sm' ? 'tile-sm' : '',
    root ? 'is-root' : '',
    state === 'hit' ? 'is-hit' : '',
    state === 'freed' ? 'is-freed' : '',
    state === 'planned' ? 'is-planned' : '',
  ]
    .filter(Boolean)
    .join(' ');
  const positions = PIPS[Math.max(0, Math.min(6, pips))];
  const Comp = onClick ? motion.button : motion.div;
  return (
    <div className="relative flex flex-col items-center">
      <Comp
        type={onClick ? 'button' : undefined}
        onClick={onClick}
        aria-label={label ?? name}
        className={cls}
        initial={animate ? { rotate: 0, y: 0 } : false}
        animate={
          state === 'lifted'
            ? { y: -16, opacity: 0.45, rotate: -4 }
            : state === 'hit' && animate
              ? { rotate: [0, 11, -2, 0], y: 0, opacity: 1 }
              : { rotate: 0, y: 0, opacity: 1 }
        }
        transition={{ duration: state === 'hit' ? 0.55 : 0.45, delay, ease: 'easeOut' }}
        style={state === 'lifted' ? { outline: '2px dashed rgb(244 239 228 / 0.5)', outlineOffset: 4 } : undefined}
      >
        <div className="tile-top">
          <div>
            <div className={`font-display font-semibold leading-tight ${size === 'sm' ? 'text-[13px]' : 'text-[15px]'}`}>{name}</div>
            {sub && <div className="mt-1 text-[10.5px] leading-tight text-[#5b5650]">{sub}</div>}
          </div>
        </div>
        <div className="tile-split" />
        <div className="tile-bottom">
          {Array.from({ length: 9 }, (_, i) => (
            <span key={i} className={positions.includes(i) ? `pip ${root && i === positions[0] ? 'pip-root' : ''}` : ''} />
          ))}
        </div>
      </Comp>
      {state === 'freed' && <span className="mt-2 rounded-full bg-sage/15 px-2 py-0.5 text-[11px] font-medium text-sage">may not be needed</span>}
      {state === 'planned' && <span className="mt-2 rounded-full bg-iris/15 px-2 py-0.5 text-[11px] font-medium text-iris">planned companion</span>}
      {state === 'lifted' && <span className="mt-2 rounded-full bg-white/10 px-2 py-0.5 text-[11px] font-medium text-bone-2">under review</span>}
    </div>
  );
}

const TIER_COLOR: Record<string, string> = {
  likely: 'var(--color-vermilion)',
  possible: 'var(--color-amber)',
  intentional: 'var(--color-iris)',
  unlikely: 'var(--color-mute)',
  dismissed: 'var(--color-mute)',
  excluded: 'var(--color-mute)',
};

export function Connector({ link, delay = 0, onSelect, selected }: { link: Link; delay?: number; onSelect?: (l: Link) => void; selected?: boolean }) {
  const color = TIER_COLOR[link.tier];
  const weeks = link.gap < 14 ? `${link.gap}d` : link.gap < 90 ? `${Math.round(link.gap / 7)}w` : `${Math.round(link.gap / 30.4)}mo`;
  return (
    <button
      type="button"
      onClick={() => onSelect?.(link)}
      className={`group relative mx-0.5 flex w-[112px] shrink-0 flex-col items-center gap-1.5 rounded-xl px-1 py-2 text-center transition ${selected ? 'bg-white/[0.06]' : 'hover:bg-white/[0.04]'}`}
      aria-label={`${link.fromName} causes ${link.effectPlain}, treated by ${link.toName}. ${link.tier}, score ${link.score.toFixed(2)}`}
    >
      <span className="text-[11.5px] font-medium leading-tight text-bone-2">{link.effectPlain}</span>
      <svg width="104" height="14" viewBox="0 0 116 14" aria-hidden>
        <motion.line
          x1="2"
          y1="7"
          x2="106"
          y2="7"
          stroke={color}
          strokeWidth="2"
          strokeDasharray={link.tier === 'possible' ? '5 4' : link.tier === 'intentional' ? '2 4' : undefined}
          strokeLinecap="round"
          initial={{ pathLength: 0 }}
          animate={{ pathLength: 1 }}
          transition={{ duration: 0.5, delay }}
        />
        <motion.path
          d="M104 2 L112 7 L104 12"
          fill="none"
          stroke={color}
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: delay + 0.45 }}
        />
      </svg>
      <span className="mono text-[10.5px] text-dim">
        <span style={{ color }}>{link.tier}</span> · {link.score.toFixed(2)} · {weeks}
      </span>
    </button>
  );
}

interface Node {
  id: string;
  name: string;
  via?: Link;
  children: Node[];
  depth: number;
}

function buildTree(tree: CascadeTree): Node {
  const root: Node = { id: tree.root, name: tree.rootName, children: [], depth: 0 };
  for (const chain of tree.chains) {
    let cur = root;
    for (const l of chain.links) {
      let next = cur.children.find((c) => c.id === l.to);
      if (!next) {
        next = { id: l.to, name: l.toName, via: l, children: [], depth: cur.depth + 1 };
        cur.children.push(next);
      }
      cur = next;
    }
  }
  return root;
}

export function DominoTree({
  tree,
  untangled,
  run,
  selected,
  onSelect,
  classNames,
}: {
  tree: CascadeTree;
  untangled: boolean;
  run: number;
  selected?: string;
  onSelect?: (l: Link) => void;
  classNames?: Record<string, string>;
}) {
  const root = buildTree(tree);
  const unneeded = new Map(tree.untangle.unnecessary.map((u) => [u.id, u]));
  const step = 0.42;

  const render = (n: Node): React.ReactNode => {
    let state: TileState = run > 0 ? 'hit' : 'idle';
    if (untangled) {
      if (n.depth === 0) state = 'lifted';
      else if (unneeded.get(n.id)?.planned) state = 'planned';
      else if (unneeded.has(n.id)) state = 'freed';
      else state = 'idle';
    }
    return (
      <div className="flex items-center" key={`${n.id}-${n.depth}`}>
        <DominoTile
          key={`${n.id}-${run}-${untangled}`}
          name={n.name}
          sub={classNames?.[n.id]}
          pips={Math.min(6, n.depth + 1)}
          size="sm"
          root={n.depth === 0}
          state={state}
          delay={n.depth * step}
        />
        {n.children.length > 0 && (
          <div className="flex flex-col gap-5">
            {n.children.map((c) => (
              <div className="flex items-center" key={c.id}>
                {c.via && (
                  <Connector key={`${c.via.key}-${run}`} link={c.via} delay={n.depth * step + 0.2} onSelect={onSelect} selected={selected === c.via.key} />
                )}
                {render(c)}
              </div>
            ))}
          </div>
        )}
      </div>
    );
  };

  // Centred when it fits; scrolls from the root (never clipped on the left) when it doesn't.
  return (
    <div className="overflow-x-auto pb-4 pt-6">
      <div className="mx-auto w-max">{render(root)}</div>
    </div>
  );
}

import { describe, expect, it } from 'vitest';
import { CAUSES, CLASS, COMBOS, DRUG, DRUGS, EFFECT, EFFECTS, PATTERNS, RAISES, TREATS, AVOID_WITH } from '../src/data/knowledge';
import { REF } from '../src/data/references';
import { PERSONAS } from '../src/data/personas';
import { generateCohort } from '../src/data/generator';

describe('knowledge graph integrity', () => {
  it('has unique ids', () => {
    expect(new Set(DRUGS.map((d) => d.id)).size).toBe(DRUGS.length);
    expect(new Set(EFFECTS.map((e) => e.id)).size).toBe(EFFECTS.length);
    expect(new Set(PATTERNS.map((p) => p.id)).size).toBe(PATTERNS.length);
  });
  it('every drug has a known class', () => {
    for (const d of DRUGS) expect(CLASS[d.cls], d.id).toBeTruthy();
  });
  it('every CAUSES and TREATS edge points at known nodes with sane onset windows', () => {
    for (const [d, e, , onset] of CAUSES) {
      expect(DRUG[d], d).toBeTruthy();
      expect(EFFECT[e], e).toBeTruthy();
      if (onset) expect(onset[0]).toBeLessThanOrEqual(onset[1]);
    }
    for (const [e, d] of TREATS) {
      expect(EFFECT[e], e).toBeTruthy();
      expect(DRUG[d], d).toBeTruthy();
    }
    for (const [a, b] of RAISES) expect(EFFECT[a] && EFFECT[b]).toBeTruthy();
    for (const [a, b] of AVOID_WITH) expect(CLASS[a] && CLASS[b]).toBeTruthy();
  });
  it('patterns and combos reference real classes, effects and references', () => {
    for (const p of PATTERNS) {
      expect(EFFECT[p.effect], p.id).toBeTruthy();
      for (const c of [...p.index, ...p.marker]) expect(CLASS[c], `${p.id}:${c}`).toBeTruthy();
      for (const r of p.refs) expect(REF[r], `${p.id}:${r}`).toBeTruthy();
      // a documented pattern must be expressible in the graph: some index drug causes the effect, some marker drug treats it
      expect(
        CAUSES.some(([d, e]) => e === p.effect && p.index.includes(DRUG[d]!.cls)),
        `${p.id} cause`,
      ).toBe(true);
      expect(
        TREATS.some(([e, d]) => e === p.effect && p.marker.includes(DRUG[d]!.cls)),
        `${p.id} treat`,
      ).toBe(true);
    }
    for (const c of COMBOS) for (const g of c.groups) for (const cls of g) expect(CLASS[cls], c.id).toBeTruthy();
  });
  it('personas only use known drugs and conditions', () => {
    for (const p of PERSONAS) {
      for (const m of p.meds) expect(DRUG[m.drug], `${p.id}:${m.drug}`).toBeTruthy();
      for (const c of p.conditions) expect(EFFECT[c.id], `${p.id}:${c.id}`).toBeTruthy();
    }
  });
  it('the cohort generator is deterministic', () => {
    const a = generateCohort(50, 7);
    const b = generateCohort(50, 7);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(a.patients.every((p) => p.age >= 65)).toBe(true);
  });
});

describe('the cascades the 3D graph lights up', () => {
  it('walk only real CAUSES and TREATED_BY edges', async () => {
    const { GRAPH_PRESETS } = await import('../src/data/graphPresets');
    const causes = new Set(CAUSES.map(([d, e]) => `${d}>${e}`));
    const treats = new Set(TREATS.map(([e, d]) => `${e}>${d}`));
    for (const p of GRAPH_PRESETS) {
      p.path.forEach((id, k) => expect(k % 2 === 0 ? DRUG[id] : EFFECT[id], `${p.id}: ${id}`).toBeTruthy());
      for (let k = 0; k < p.path.length - 1; k++) {
        const pair = `${p.path[k]}>${p.path[k + 1]}`;
        expect(k % 2 === 0 ? causes.has(pair) : treats.has(pair), `${p.id}: ${pair}`).toBe(true);
      }
    }
  });
});

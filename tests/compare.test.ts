// "Same question. Same model. One has a graph." The model's answer is scored against what the graph shows, and the
// handoff fact-check catches a chokepoint the algorithm never returned.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { dbAvailable } from './setup-db';
import { closeDb } from '../src/lib/db';
import { runComparison, UNKNOWN_DRUG } from '../src/lib/compare';
import { factCheckChokepoints } from '../src/lib/agent/runner';
import type { Provider } from '../src/lib/agent/providers/types';

let ok = false;
beforeAll(async () => {
  ok = await dbAvailable();
});
afterAll(async () => closeDb());

const fake = (text: string): Provider => ({ id: 'openai', model: 'fake', chat: async () => ({ text, toolCalls: [], model: 'fake' }) });

describe('with and without the graph', () => {
  it('scores a partial, overconfident answer against the graph', async () => {
    if (!ok) return;
    let prompt = '';
    const p: Provider = {
      id: 'openai',
      model: 'fake',
      chat: async (_s, messages) => {
        prompt = String(messages[0].content);
        return {
          text:
            '```json\n' +
            JSON.stringify({
              cascades: [
                { from: 'Amlodipine', effect: 'edema', to: 'Furosemide' },
                { from: 'Furosemide', effect: 'low potassium', to: 'Potassium chloride' },
                { from: 'Atorvastatin', effect: 'myalgia', to: 'Naproxen' },
              ],
              loops: [],
              combinations: [{ drugs: ['Lisinopril', 'Potassium chloride'], risk: 'hyperkalaemia' }],
              newDrug: { verdict: 'caution', reason: 'An ACE inhibitor; avoid with lisinopril.' },
            }) +
            '\n```',
          toolCalls: [],
          model: 'fake',
        };
      },
    };
    const c = await runComparison('p-beatrice', undefined, { provider: p });
    // The model sees the whole record, so the comparison is fair: every medicine with its start date and reason.
    expect(prompt).toContain('Amlodipine');
    expect(prompt).toContain('started');
    expect(prompt).toContain(UNKNOWN_DRUG);
    expect(c.graph.links.found.length).toBe(4);
    expect(c.plain.links.found).toEqual(['Amlodipine → Furosemide']);
    expect(c.plain.links.missed.length).toBe(3);
    expect(c.plain.links.plannedFlagged).toEqual(['Furosemide → Potassium chloride']);
    expect(c.plain.links.unsupported).toEqual(['Atorvastatin → Naproxen']);
    expect(c.plain.loop).toEqual({ expected: 1, found: 0 });
    expect(c.plain.combos.found.length).toBe(1);
    expect(c.plain.unknown.honest).toBe(false);
    expect(c.graph.unknown.honest).toBe(true);
    expect(c.graph.queries).toBeGreaterThan(5);
  });

  it('an unreadable answer scores as empty, never as a crash', async () => {
    if (!ok) return;
    const c = await runComparison('p-beatrice', undefined, { provider: fake('I cannot help with that.') });
    expect(c.plain.parseError).toBeTruthy();
    expect(c.plain.links.found).toEqual([]);
  });

  it('an honest "unknown" for the made-up medicine scores', async () => {
    if (!ok) return;
    const c = await runComparison('p-beatrice', undefined, { provider: fake('{"cascades":[],"loops":[],"combinations":[],"newDrug":{"verdict":"unknown","reason":"I do not know this drug."}}') });
    expect(c.plain.unknown.honest).toBe(true);
  });
});

describe('fact-checking a handoff against the graph', () => {
  const ctx = () => ({ cache: {} }) as never;
  it('flags a drug called a chokepoint that betweenness did not return', async () => {
    if (!ok) return;
    // Donepezil and naproxen are drug chokepoints (betweenness); furosemide and lisinopril are not.
    const out = await factCheckChokepoints(ctx(), 'Graph analysis identifies donepezil, naproxen, furosemide and lisinopril as key cascade chokepoints.');
    expect(out).toMatch(/Furosemide, Lisinopril are not among/);
    expect(out).not.toMatch(/Donepezil|Naproxen/);
  });
  it('stays quiet when the claim matches the algorithm, or when there is no claim', async () => {
    if (!ok) return;
    expect(await factCheckChokepoints(ctx(), 'Donepezil and naproxen are chokepoints of the cascade graph.')).toBeNull();
    expect(await factCheckChokepoints(ctx(), 'Naproxen raises blood pressure.')).toBeNull();
    expect(await factCheckChokepoints(ctx(), 'Naproxen is not a chokepoint.')).toBeNull();
  });
});

import type { Metadata } from 'next';
import { Checkup } from '@/components/Checkup';

export const metadata: Metadata = { title: 'Check a medicine list' };

export default function CheckupPage() {
  return (
    <div className="pt-10">
      <p className="kicker">Try it with a real-looking list</p>
      <h1 className="font-display mt-3 text-5xl font-semibold">Is one pill treating another?</h1>
      <p className="mt-3 max-w-2xl text-bone-2">
        Paste a medication list the way a family member would write it: brand names, typos, rough dates. Domino maps it onto its FalkorDB knowledge graph and
        the agents look for prescribing cascades.
      </p>
      <Checkup />
    </div>
  );
}

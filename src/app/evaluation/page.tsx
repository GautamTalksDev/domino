import type { Metadata } from 'next';
import evalResult from '@/data/generated/eval.json';
import { EvalView } from '@/components/EvalView';

export const metadata: Metadata = { title: 'Evaluation' };

export default function EvaluationPage() {
  return (
    <div className="pt-10">
      <p className="kicker">Does it work?</p>
      <h1 className="font-display mt-3 text-5xl font-semibold">Evaluation</h1>
      <p className="mt-3 max-w-3xl text-bone-2">
        The synthetic cohort generator hides prescribing cascades inside {evalResult.patients} patients by sampling real CAUSES and TREATED_BY edges, and mixes
        in the confounders a real record has: drugs prescribed for a genuine diagnosis, deliberate pairs started together, and drugs started in the wrong order.
        The ground truth never enters the graph. Each row adds one graph signal.
      </p>
      <EvalView initial={evalResult} />
    </div>
  );
}

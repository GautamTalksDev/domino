/**
 * The only moves a review task can make. Approving or dismissing is the outcome procedural memory learns from, so it is
 * final: an approved task can only be completed, never turned into a dismissal afterwards.
 */
export const TASK_NEXT: Readonly<Record<string, readonly string[]>> = { proposed: ['approved', 'dismissed'], approved: ['done'] };

export function canMoveTask(from: string, to: string): boolean {
  return (TASK_NEXT[from] ?? []).includes(to);
}

import type { Metadata } from 'next';
import { Inbox } from '@/components/Inbox';
import { currentClinic, currentUser } from '@/lib/tenant';

export const metadata: Metadata = { title: 'Inbox' };

export default async function InboxPage() {
  const [user, clinic] = await Promise.all([currentUser(), currentClinic()]);
  return (
    <div className="pt-10">
      <p className="kicker">Human in the loop · {clinic.name}</p>
      <h1 className="font-display mt-3 text-5xl font-semibold">Care team inbox</h1>
      <p className="mt-3 max-w-2xl text-bone-2">
        Everything the agents want done lands here as a proposal. Nothing happens until a person approves it. Each task is signed by the run that created it, so
        a task written into the database by anything else is flagged. Tasks go to the role a learned procedure picked, addressed to the prescriber who owns the
        root drug.
      </p>
      {/* Keyed by clinic and person: switching either starts from that clinic's own graph. */}
      <Inbox key={`${clinic.id}:${user.id}`} userName={user.name} role={user.role} />
    </div>
  );
}

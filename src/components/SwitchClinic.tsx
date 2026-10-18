'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { ArrowRight, Loader2 } from 'lucide-react';
import { postJson } from '@/lib/client';
import { toast } from '@/lib/toast';

/** Switches the session to another clinic's graph, then reloads the current page in it. */
export function SwitchClinic({ clinic, name, className = 'btn btn-hot' }: { clinic: string; name: string; className?: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <button
      className={className}
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          await postJson('/api/session', { clinic });
          toast({ tone: 'info', title: `Now in ${name}`, body: 'Every query, memory and learned procedure now comes from this clinic’s own FalkorDB graph.' });
          router.refresh();
        } catch (err) {
          toast({ tone: 'error', title: 'Could not switch', body: err instanceof Error ? err.message : undefined });
          setBusy(false);
        }
      }}
    >
      {busy ? <Loader2 size={15} className="animate-spin" /> : null} Switch to {name} {busy ? null : <ArrowRight size={15} />}
    </button>
  );
}

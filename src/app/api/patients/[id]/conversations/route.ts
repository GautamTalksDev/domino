import { NextResponse, type NextRequest } from 'next/server';
import { guard, handle, HttpError, parsePatientId } from '@/lib/api';
import { listConversations, readConversation } from '@/lib/memory/conversations';
import { currentUser } from '@/lib/tenant';

export const dynamic = 'force-dynamic';

// The session person's conversations about this patient, or one of them with its messages.
export const GET = handle(async (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => {
  guard(req);
  const pid = parsePatientId((await ctx.params).id);
  const user = await currentUser();
  const cid = req.nextUrl.searchParams.get('id');
  if (cid) {
    if (!/^c-[0-9a-f-]{36}$/.test(cid)) throw new HttpError(400, 'Invalid conversation id.');
    return NextResponse.json({ id: cid, messages: await readConversation(pid, user.id, cid) });
  }
  return NextResponse.json({ user: user.name, conversations: await listConversations(pid, user.id) });
});

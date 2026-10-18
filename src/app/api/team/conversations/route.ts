import { NextResponse, type NextRequest } from 'next/server';
import { guard, handle, HttpError } from '@/lib/api';
import { listConversations, readConversation } from '@/lib/memory/conversations';
import { currentClinic, currentUser } from '@/lib/tenant';

export const dynamic = 'force-dynamic';

export const GET = handle(async (req: NextRequest) => {
  guard(req);
  const [user, clinic] = await Promise.all([currentUser(), currentClinic()]);
  const cid = req.nextUrl.searchParams.get('id');
  if (cid) {
    if (!/^c-[0-9a-f-]{36}$/.test(cid)) throw new HttpError(400, 'Invalid conversation id.');
    return NextResponse.json({ id: cid, messages: await readConversation(clinic.id, user.id, cid) });
  }
  return NextResponse.json({ user: user.name, conversations: await listConversations(clinic.id, user.id) });
});

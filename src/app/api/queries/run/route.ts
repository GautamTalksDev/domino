import { NextResponse, type NextRequest } from 'next/server';
import { guard, handle, HttpError } from '@/lib/api';
import { run } from '@/lib/db';
import { consoleQuery, FIXED_PARAMS, paramsOf, userMaySet } from '@/lib/console';

export const dynamic = 'force-dynamic';

const PATTERNS: Record<string, RegExp> = {
  pid: /^p-?[a-z0-9-]{2,40}$/,
  drug: /^[a-z0-9_]{2,40}$/,
  effect: /^[a-z0-9_]{2,40}$/,
  id: /^[a-z0-9_]{2,40}$/,
  to: /^[a-z0-9_]{2,40}$/,
  from: /^[a-z0-9_]{2,40}$/,
};

// Read-only by construction: only catalog queries in "read" mode, run through GRAPH.RO_QUERY.
export const GET = handle(async (req: NextRequest) => {
  guard(req);
  const sp = req.nextUrl.searchParams;
  const q = consoleQuery(sp.get('q') ?? '');
  if (!q) throw new HttpError(400, 'Unknown or non-read query.');
  const params: Record<string, unknown> = {};
  for (const name of paramsOf(q)) {
    const given = sp.get(name);
    if (given != null && Object.hasOwn(PATTERNS, name) && userMaySet(q, name)) {
      if (!PATTERNS[name].test(given)) throw new HttpError(400, `Invalid ${name}.`);
      params[name] = given;
    } else if (name in FIXED_PARAMS) {
      params[name] = FIXED_PARAMS[name];
    } else {
      throw new HttpError(400, `Missing parameter ${name}.`);
    }
  }
  const t0 = performance.now();
  const rows = await run(q, params);
  return NextResponse.json({
    id: q.id,
    title: q.title,
    cypher: q.cypher,
    params,
    ms: Math.round((performance.now() - t0) * 10) / 10,
    total: rows.length,
    rows: rows.slice(0, 40),
  });
});

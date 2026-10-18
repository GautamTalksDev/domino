// End-to-end smoke test against a running server:  npm run dev  (then)  npm run smoke
// Against a deployment, with the extra checks a judge's visit depends on:  DOMINO_URL=https://your-app npm run smoke
// (add CRON_SECRET=... to also call the keep-alive with it).
export {};
const base = process.env.DOMINO_URL || 'http://localhost:3000';
let failed = 0;
const check = async (name: string, fn: () => Promise<string | void>) => {
  try {
    const note = await fn();
    console.log(`  ✓ ${name}${note ? `: ${note}` : ''}`);
  } catch (e) {
    failed++;
    console.log(`  ✗ ${name}: ${(e as Error).message}`);
  }
};
const get = async (path: string) => {
  const r = await fetch(base + path);
  if (!r.ok) throw new Error(`${path} → ${r.status}`);
  return r;
};
const post = async (path: string, body: unknown) =>
  fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json', origin: base }, body: JSON.stringify(body) });

console.log(`\nSmoke test against ${base}\n`);
await check('health', async () => {
  const j = await (await get('/api/health')).json();
  if (!j.db.ok) throw new Error(`FalkorDB: ${j.db.error}`);
  if (!j.seeded) throw new Error('graph empty, run npm run setup');
  if (j.signing === 'missing') throw new Error('production server without DOMINO_SIGNING_SECRET: set it, run npm run seed, restart');
  return `FalkorDB ${j.db.ms} ms, agents: ${j.agent}`;
});
for (const p of [
  '/',
  '/patients',
  '/patients/p-beatrice',
  '/patients/p-beatrice/brief',
  '/check',
  '/ehr',
  '/checkup',
  '/inbox',
  '/team',
  '/population',
  '/graph',
  '/evaluation',
  '/how',
]) {
  await check(`page ${p}`, async () => {
    const r = await get(p);
    if (!r.headers.get('content-security-policy')) throw new Error('missing CSP header');
  });
}
await check('analysis finds Beatrice’s root', async () => {
  const j = await (await get('/api/patients/p-beatrice')).json();
  if (j.analysis.trees[0]?.root !== 'amlodipine') throw new Error('unexpected root');
  return `${j.analysis.summary.likely} likely links`;
});
await check('prescriber check', async () => {
  const r = await post('/api/patients/p-rosa/check', { drug: 'benztropine' });
  const j = await r.json();
  if (j.verdict !== 'stop_and_check') throw new Error(`verdict ${j.verdict}`);
  return j.headline;
});
await check('CDS Hooks: discovery and an order-sign call', async () => {
  const d = await (await get('/cds-services')).json();
  if (d.services?.length !== 2) throw new Error('discovery should list two services');
  const r = await fetch(base + '/cds-services/domino-order-sign', {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: 'https://ehr.example' },
    body: JSON.stringify({
      hook: 'order-sign',
      hookInstance: `smoke-${Date.now()}`,
      context: {
        patientId: 'p-rosa',
        draftOrders: {
          resourceType: 'Bundle',
          entry: [{ resource: { resourceType: 'MedicationRequest', id: 'smoke-1', status: 'draft', medicationCodeableConcept: { text: 'Benztropine 1 mg' } } }],
        },
      },
    }),
  });
  if (r.headers.get('access-control-allow-origin') !== '*') throw new Error('missing CORS header');
  const j = await r.json();
  if (j.cards?.[0]?.indicator !== 'warning') throw new Error(`expected a warning card, got ${JSON.stringify(j).slice(0, 200)}`);
  return j.cards[0].summary;
});
await check('agent review streams and finishes', async () => {
  const r = await post('/api/patients/p-henry/review', { mode: 'planner' });
  const text = await r.text();
  if (!text.includes('"type":"done"')) throw new Error(text.match(/"message":"([^"]+)"/)?.[1] ?? 'no done event');
  return `${(text.match(/"type":"tool"/g) ?? []).length} tool calls`;
});
await check('provenance: how Domino got to a finding', async () => {
  const j = await (await get('/api/patients/p-henry/trace?link=' + encodeURIComponent('naproxen>hydrochlorothiazide'))).json();
  if (!j.trace?.steps?.length) throw new Error('no provenance recorded');
  return `${j.trace.steps.length} steps, ${j.trace.steps.reduce((n: number, s: { queries: unknown[] }) => n + s.queries.length, 0)} queries, written by ${j.trace.tool}`;
});
await check('counterfactual replay', async () => {
  const j = await (await get('/api/patients/p-beatrice/replay')).json();
  if (j.firstCatch?.drug !== 'furosemide') throw new Error(`first catch ${j.firstCatch?.drug}`);
  return `${j.avoidable.length} prescriptions might never have been written`;
});
await check('care-team brain: memory search and who knows what', async () => {
  const s = await (await get('/api/team/search?q=' + encodeURIComponent('swelling amlodipine'))).json();
  const team = await (await get('/api/team')).json();
  if (!team.procedures?.length) throw new Error('no learned procedures');
  return `${s.hits?.length ?? 0} search hits, ${team.procedures.length} procedures`;
});
await check('team notes are linked to what they mention', async () => {
  const j = (await (await get('/api/team/docs')).json()) as { docs: { title: string; drugs: unknown[]; patients: { id: string }[] }[] };
  if (!j.docs?.length) throw new Error('no team notes: run npm run setup');
  const linked = j.docs.filter((d) => d.drugs.length).length;
  return `${j.docs.length} notes, ${linked} linked to drugs, ${j.docs.filter((d) => d.patients.length).length} to a patient`;
});
await check('check-up parses brand names and typos', async () => {
  const r = await post('/api/checkup/parse', { text: 'Norvasc since March 2025\nLasix\nAricpet', conditions: '' });
  const j = await r.json();
  const ids = (j.meds ?? []).map((m: { match?: { id: string } }) => m.match?.id);
  if (ids.join() !== 'amlodipine,furosemide,donepezil') throw new Error(ids.join());
  return ids.join(', ');
});
await check('clinics are separate graphs', async () => {
  const r = await fetch(base + '/api/patients/p-beatrice', { headers: { cookie: 'domino_clinic=lakeview' } });
  if (r.status !== 404) throw new Error(`Beatrice visible from Lakeview: ${r.status}`);
  return 'Riverside patient is a 404 in Lakeview';
});
await check('inbox lists signed tasks', async () => {
  const r = await fetch(base + '/api/tasks');
  const j = (await r.json()) as { tasks?: { verified: boolean }[]; error?: string };
  if (!r.ok || !j.tasks) throw new Error(j.error ?? `status ${r.status}`);
  const verified = j.tasks.filter((t) => t.verified).length;
  if (j.tasks.length && !verified) throw new Error('no task verifies: was the graph seeded with a different DOMINO_SIGNING_SECRET?');
  return `${j.tasks.length} tasks, ${verified} verified`;
});
await check('cross-site write is refused', async () => {
  const r = await fetch(base + '/api/patients/p-beatrice/check', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'sec-fetch-site': 'cross-site' },
    body: '{"drug":"meclizine"}',
  });
  // check is a read; try a write instead
  const w = await fetch(base + '/api/patients/p-beatrice/decisions', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'sec-fetch-site': 'cross-site' },
    body: '{}',
  });
  if (w.status !== 403) throw new Error(`expected 403, got ${w.status}`);
  return `read ${r.status}, write ${w.status}`;
});
// A deployment (anything not on this machine) gets the checks a judge's visit depends on.
const remote = process.env.SMOKE_DEPLOYMENT === '1' || !/^https?:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(base);
if (remote) {
  console.log('\nDeployment checks\n');
  const h = await (await get('/api/health')).json();
  await check('language model is live (not the planner fallback)', async () => {
    if (String(h.agent).startsWith('Graph planner')) throw new Error('no LLM key on the deployment: set GEMINI_API_KEY');
    if (h.modelPaused) throw new Error(`model paused: ${h.modelPaused}`);
    return h.agent;
  });
  await check('search by meaning is on', async () => {
    if (/^off/.test(String(h.semantic))) throw new Error(String(h.semantic));
    return String(h.semantic);
  });
  await check('production secrets', async () => {
    if (h.devSecret) throw new Error('using the development signing secret: set DOMINO_SIGNING_SECRET');
    if (!h.cron) throw new Error('CRON_SECRET is missing or shorter than 16 characters: the nightly job and keep-alive cannot run');
    return 'signing secret and cron secret set';
  });
  await check('access key guards admin actions; visitors can try the rest', async () => {
    if (!h.writeKey) return 'no access key set: every write is open, admin included (set DOMINO_WRITE_KEY and DOMINO_OPEN_DEMO=true for a public demo)';
    const r = await post('/api/population/sweep', {});
    if (r.status !== 401) throw new Error(`a sweep without the key got ${r.status}, expected 401`);
    return h.openDemo ? 'open demo: the key is needed only for admin actions' : 'key needed for every write (set DOMINO_OPEN_DEMO=true so judges can try the product)';
  });
  await check('scheduled jobs are protected and the demo resets nightly', async () => {
    const r = await fetch(base + '/api/cron/keepalive');
    if (r.status !== 401) throw new Error(`keep-alive without the cron secret got ${r.status}, expected 401`);
    if (process.env.CRON_SECRET) {
      const k = await fetch(base + '/api/cron/keepalive', { headers: { authorization: `Bearer ${process.env.CRON_SECRET}` } });
      if (!k.ok) throw new Error(`keep-alive with the cron secret got ${k.status}`);
    }
    return h.demoReset ? 'nightly reset on' : 'nightly reset off (set DOMINO_DEMO_RESET=nightly for a public demo)';
  });
  await check('HTTPS hardening headers', async () => {
    const r = await get('/');
    if (base.startsWith('https:') && !r.headers.get('strict-transport-security')) throw new Error('missing Strict-Transport-Security');
    if (r.headers.get('x-content-type-options') !== 'nosniff') throw new Error('missing X-Content-Type-Options');
    return 'CSP, HSTS, nosniff';
  });
  await check('README and submission have no placeholders left', async () => {
    const { readFileSync } = await import('node:fs');
    const left = ['README.md', 'docs/SUBMISSION.md'].flatMap((f) =>
      [...readFileSync(f, 'utf8').matchAll(/TODO_[A-Z_]+|TODO\(gautam\)/g)].map((m) => `${f}: ${m[0]}`),
    );
    if (left.length) throw new Error(`${left.length} left: ${[...new Set(left)].join(', ')}`);
    return 'all filled';
  });
}

console.log(failed ? `\n${failed} check(s) failed\n` : '\nAll good.\n');
process.exitCode = failed ? 1 : 0;

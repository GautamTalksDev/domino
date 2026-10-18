// Doctor: checks everything Domino needs and says what to fix.
import './env';
import { ping, run, closeDb } from '../src/lib/db';
import { Q } from '../src/lib/cypher';
import { getProvider } from '../src/lib/agent/providers';
import { usingDevSecret } from '../src/lib/agent/sign';
import { CLINICS, graphFor, runInScope } from '../src/lib/tenant';

const ok = (m: string) => console.log(`  ✓ ${m}`);
const warn = (m: string) => console.log(`  ! ${m}`);
const bad = (m: string) => console.log(`  ✗ ${m}`);

console.log('\nDomino doctor\n');
const [major] = process.versions.node.split('.').map(Number);
major >= 20 ? ok(`Node ${process.versions.node}`) : bad(`Node ${process.versions.node}: need 20.9 or newer`);
const p = await ping();
if (!p.ok) {
  bad(`FalkorDB unreachable: ${p.error}`);
  console.log('    → npm run db   (or set FALKORDB_URL for FalkorDB Cloud)');
} else {
  ok(`FalkorDB reachable (${p.ms} ms) at ${process.env.FALKORDB_URL ? process.env.FALKORDB_URL.replace(/\/\/[^@]*@/, '//***@') : 'localhost:6379'}`);
  for (const clinic of CLINICS) {
    await runInScope({ clinic: clinic.id }, async () => {
      const meta = await run<{ patients: number; version: string }>(Q.meta);
      if (meta.length) ok(`${clinic.short}: graph "${graphFor(clinic.id)}" seeded with ${meta[0].patients} patients, knowledge v${meta[0].version}`);
      else {
        bad(`${clinic.short}: graph "${graphFor(clinic.id)}" is empty`);
        console.log('    → npm run setup');
        return;
      }
      if (clinic.personas) {
        const mem = await run<{ decisions: { id: string; from: string; to: string; verdict: string; by: string; reason: string; sig: string }[] }>(Q.memory, {
          pid: 'p-frank',
        });
        const d = (mem[0]?.decisions ?? []).filter((x) => x && x.id)[0];
        if (d) {
          const { decisionPayload, verifyPayload } = await import('../src/lib/agent/sign');
          verifyPayload(decisionPayload({ ...d, patientId: 'p-frank' }), d.sig)
            ? ok(`${clinic.short}: seeded memory verifies with the current signing secret`)
            : bad(`${clinic.short}: seeded decisions were signed with a different secret → npm run setup (after setting DOMINO_SIGNING_SECRET)`);
        }
      }
      const swept = await run<{ reviewedAt: number | null }>(Q.patientList);
      const n = swept.filter((r) => r.reviewedAt).length;
      n ? ok(`${clinic.short}: population sweep done for ${n} patients`) : warn(`${clinic.short}: no population sweep yet → npm run scan`);
    });
  }
}
const { provider, label } = getProvider();
provider
  ? ok(`Agents use ${label}`)
  : warn('No LLM key: agents run as the deterministic graph planner (fine for demos). Add GEMINI_API_KEY, ANTHROPIC_API_KEY or OPENAI_API_KEY for LLM agents.');
usingDevSecret() ? warn('DOMINO_SIGNING_SECRET not set: using the development secret (set it before deploying)') : ok('Signing secret set');
process.env.DOMINO_WRITE_KEY
  ? ok('Write key set: writes need the access key')
  : warn('DOMINO_WRITE_KEY not set: writes are open (fine locally; set it for a public deployment)');
console.log('');
await closeDb();

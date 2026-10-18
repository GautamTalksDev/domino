// Track 2 and 3 features: conversations, procedural memory, provenance, tenants, leases, the care-team brain.
import { afterAll, describe, expect, it } from 'vitest';
import { dbAvailable } from './setup-db';
import { adminQuery, closeDb, run } from '../src/lib/db';
import { Q } from '../src/lib/cypher';
import { askDomino, askTeam, runReview, BusyError } from '../src/lib/agent/runner';
import { listConversations, readConversation } from '../src/lib/memory/conversations';
import { learnProcedure, procedureFor } from '../src/lib/memory/procedures';
import { proposeTask } from '../src/lib/agent/actions';
import { traceFinding } from '../src/lib/provenance';
import { careTeam, searchMemory, toSearchQuery, whoKnows } from '../src/lib/careteam';
import { linkEntities, listDocs, patientDocs, previewLinks, saveDoc } from '../src/lib/docs';
import { noticeFromNote } from '../src/lib/noticed';
import { scheduleFollowUp } from '../src/lib/followup';
import { canMoveTask } from '../src/lib/taskFlow';
import { analyzePatient, NotFoundError } from '../src/lib/engine/analyze';
import { CLINICS, runInScope } from '../src/lib/tenant';
import type { AgentEvent } from '../src/lib/agent/events';
import { callTool, type ToolContext } from '../src/lib/agent/tools';

afterAll(async () => closeDb());

describe.runIf(await dbAvailable())('memory, coordination and the care-team brain', () => {
  it('remembers a conversation per person and resolves follow-ups from it', async () => {
    const events: AgentEvent[] = [];
    await askDomino('p-beatrice', 'Why is she on furosemide?', (e) => events.push(e));
    const conv = events.find((e): e is Extract<AgentEvent, { type: 'conversation' }> => e.type === 'conversation')!;
    expect(conv.resumed).toBe(false);
    const second: AgentEvent[] = [];
    const answer = await askDomino('p-beatrice', 'What could replace it?', (e) => second.push(e), undefined, undefined, { conversationId: conv.id });
    expect(second.find((e) => e.type === 'conversation' && e.resumed)).toBeTruthy();
    expect(answer).toMatch(/earlier in this conversation/);
    expect(answer).toMatch(/Amlodipine/);
    const msgs = await readConversation('p-beatrice', 'lee', conv.id);
    expect(msgs.map((m) => m.role)).toEqual(['user', 'assistant', 'user', 'assistant']);
    expect(msgs[1].sources.length).toBeGreaterThan(0);
    // Another person cannot read it, and does not see it in their list.
    expect(await readConversation('p-beatrice', 'okafor', conv.id)).toEqual([]);
    expect((await listConversations('p-beatrice', 'okafor')).some((c) => c.id === conv.id)).toBe(false);
  });

  it('routes tasks by learned procedure, and learns a new one from outcomes', async () => {
    // Seeded memory: CCB swelling tasks go to prescribers at Riverside.
    expect((await procedureFor('ccb_edema_diuretic')).role).toBe('prescriber');
    const events: AgentEvent[] = [];
    await runReview({ patientId: 'p-beatrice', mode: 'planner', emit: (e) => events.push(e) });
    const task = events.find((e): e is Extract<AgentEvent, { type: 'task' }> => e.type === 'task' && /Amlodipine/.test(e.title));
    expect(task?.role).toBe('prescriber');
    expect(task?.owner).toMatch(/Patel/);

    // New outcomes for a pattern with no procedure yet: three prescribers act, three pharmacists dismiss.
    const pattern = 'alpha_dizziness_vestibular';
    const ids: string[] = [];
    for (const [role, status] of [
      ['prescriber', 'done'],
      ['prescriber', 'done'],
      ['prescriber', 'approved'],
      ['pharmacist', 'dismissed'],
      ['pharmacist', 'dismissed'],
      ['pharmacist', 'dismissed'],
    ] as const) {
      const r = await proposeTask({
        pid: 'p-walter',
        runId: null,
        title: `Test task ${ids.length}`,
        body: 'Could the dizziness be from tamsulosin?',
        role,
        link: null,
        pattern,
        tier: 'likely',
      });
      if (!r.proposed) throw new Error('not proposed');
      ids.push(r.id);
      await run(Q.setTask, { id: r.id, from: ['proposed'], status, by: 'Test', byId: 'test', at: Date.now(), note: null, counted: true });
    }
    // An approval is final: it can be completed, never turned into a dismissal.
    expect(canMoveTask('approved', 'dismissed')).toBe(false);
    expect(canMoveTask('approved', 'done')).toBe(true);
    expect(canMoveTask('dismissed', 'approved')).toBe(false);
    // A decided task cannot be decided again (the write only applies from the status the person saw).
    expect(
      (await run(Q.setTask, { id: ids[0], from: ['proposed'], status: 'dismissed', by: 'X', byId: 'x', at: Date.now(), note: null, counted: true })).length,
    ).toBe(0);
    // A task recorded straight as done (history) still says who decided it.
    const direct = (await adminQuery('MATCH (t:Task {id: $id}) RETURN t.decidedBy AS by', { id: ids[0] })) as { data?: { by: string }[] };
    expect(direct.data?.[0]?.by).toBe('Test');
    // Completing an approved task keeps who approved it and adds who did it.
    await run(Q.setTask, { id: ids[2], from: ['approved'], status: 'done', by: 'Doer', byId: 'doer', at: Date.now(), note: null, counted: true });
    const done = (await adminQuery('MATCH (t:Task {id: $id}) RETURN t.decidedBy AS approvedBy, t.doneBy AS doneBy, t.status AS status', { id: ids[2] })) as {
      data?: { approvedBy: string; doneBy: string; status: string }[];
    };
    expect(done.data?.[0]).toEqual({ approvedBy: 'Test', doneBy: 'Doer', status: 'done' });
    try {
      const learned = await learnProcedure(pattern);
      expect(learned.changed).toBe(true);
      expect(learned.procedure.role).toBe('prescriber');
      const hist = await run<{ procedure: { version: number }; tasks: { id: string }[] }>(Q.procedureHistory, { key: pattern });
      expect(hist[0].tasks.length).toBe(6);
    } finally {
      await adminQuery(`MATCH (pr:Procedure {key: $k}) DETACH DELETE pr`, { k: pattern });
      await adminQuery(`MATCH (t:Task) WHERE t.id IN $ids DETACH DELETE t`, { ids });
    }
  });

  it('traces a finding back to the step, queries and evidence behind it', async () => {
    await runReview({ patientId: 'p-henry', mode: 'planner' });
    const t = await traceFinding('p-henry', 'naproxen>hydrochlorothiazide');
    expect(t?.run?.mode).toBe('planner');
    expect(t?.tool).toBe('record_findings');
    expect(t?.agent).toBe('detective');
    expect(t?.steps.some((s) => s.queries.some((q) => q.id === 'cascade_paths'))).toBe(true);
    expect(t?.pattern?.id).toBe('nsaid_bp_antihypertensive');
    expect(t?.handoffs.length).toBeGreaterThan(0);
    expect(t?.tasks.length).toBeGreaterThan(0);
  });

  it('says what changed since the last review', async () => {
    const events: AgentEvent[] = [];
    await runReview({ patientId: 'p-henry', mode: 'planner', emit: (e) => events.push(e) });
    expect(events.some((e) => e.type === 'thought' && /Since the last review/.test(e.text))).toBe(true);
  });

  it('keeps clinics in separate graphs', async () => {
    const other = CLINICS[1];
    await runInScope({ clinic: other.id }, async () => {
      await expect(analyzePatient('p-beatrice')).rejects.toBeInstanceOf(NotFoundError);
      const meta = await run<{ seed: number }>(Q.meta);
      expect(meta[0].seed).toBe(other.cohortSeed);
      expect((await procedureFor('ssri_insomnia_hypnotic')).role).toBe('prescriber');
      expect((await procedureFor('ccb_edema_diuretic')).key).toBe('default');
    });
  });

  it('lets only one review per patient run at a time (graph lease)', async () => {
    const results = await Promise.allSettled(Array.from({ length: 5 }, () => runReview({ patientId: 'p-walter', mode: 'planner' })));
    expect(results.filter((r) => r.status === 'fulfilled').length).toBe(1);
    expect(results.filter((r) => r.status === 'rejected' && r.reason instanceof BusyError).length).toBe(4);
  });

  it('answers clinic-wide questions with sources', async () => {
    const events: AgentEvent[] = [];
    const answer = await askTeam('Who on the team knows calcium channel blocker swelling cascades?', (e) => events.push(e));
    expect(answer).toMatch(/Sam Lee/);
    const a = events.find((e): e is Extract<AgentEvent, { type: 'answer' }> => e.type === 'answer');
    expect(a?.sources?.[0].tool).toBe('who_knows');
    expect(a?.sources?.[0].via).toBe('mcp');
    expect(a?.sources?.[0].queries).toContain('who_knows');
    const hits = await searchMemory('cough cold');
    expect(hits.some((h) => h.kind === 'task' && /cold/i.test(String(h.text)))).toBe(true);
    // Conversations stay private in search too: Sam Lee's question is not in Dr Okafor's results.
    await askDomino('p-beatrice', 'Why is she on furosemide?', () => {});
    const own = await searchMemory('furosemide');
    expect(own.some((h) => h.kind === 'message')).toBe(true);
    const other = await runInScope({ clinic: CLINICS[0].id, user: 'okafor' }, () => searchMemory('furosemide'));
    expect(other.some((h) => h.kind === 'message')).toBe(false);
    const team = await careTeam();
    expect(team.totals.links).toBeGreaterThan(0);
    expect((await whoKnows('ccb_edema_diuretic')).map((e) => e.person)).toContain('Dr. Amara Okafor');
  });

  it('links a team note to the drugs, symptoms and patients it names, and finds it again', async () => {
    const res = await saveDoc({
      kind: 'handover',
      title: 'Handover: Walter Brooks dizzy on standing',
      text: 'Walter Brooks felt lightheaded getting up this morning. He takes Flomax and the meclizine from the walk-in clinic. Drink more water, he says.',
    });
    expect(res.patients).toEqual(['p-walter']);
    expect(res.drugs.sort()).toEqual(['meclizine', 'tamsulosin']);
    expect(res.effects).toContain('orthostatic_hypotension');
    // "water" alone is not "water pill": no furosemide.
    expect(res.drugs).not.toContain('furosemide');
    expect((await patientDocs('p-walter')).some((d) => d.id === res.id)).toBe(true);
    // A note that names Walter does not show up for another patient on the same drugs.
    expect((await patientDocs('p-beatrice')).some((d) => d.id === res.id)).toBe(false);
    const hits = await searchMemory('lightheaded flomax');
    expect(hits.some((h) => h.kind === 'doc' && h.patientId === 'p-walter')).toBe(true);
    expect((await linkEntities('-foo | "bar" %baz% @x:y')).drugs).toEqual([]);
  });

  it("gives the Detective what the team's notes report, read against the graph (never the raw note text)", async () => {
    const made: string[] = [];
    try {
      const cough = await saveDoc({ kind: 'handover', title: 'Beatrice coughing', text: 'Beatrice Hale has had a dry tickly cough for three weeks.' });
      const ruled = await saveDoc({ kind: 'handover', title: 'Beatrice seen', text: 'Beatrice Hale seen today: no dizziness, ankles fine.' });
      made.push(cough.id, ruled.id);
      const ctx: ToolContext = {
        runId: null,
        patientId: 'p-beatrice',
        role: 'detective',
        tracer: () => {},
        cache: {},
        step: null,
        counters: { findings: 0, tasks: 0, notes: 0 },
        emit: () => {},
        artifacts: { findings: [], findingKeys: [], tasks: [], notes: [] },
      };
      const r = await callTool(ctx, 'recall_memory', {});
      expect(r.ok).toBe(true);
      expect(r.summary).toMatch(/"Beatrice coughing"[^\n]*Reports dry cough, which Lisinopril on this list can cause; nothing on the list treats it yet/);
      const reports = (r.data as { reports: { note: string; effect: string }[] }).reports;
      expect(reports.filter((x) => x.note === 'Beatrice coughing').map((x) => x.effect)).toContain('dry_cough');
      // A note that rules symptoms out reports none of them.
      expect(reports.some((x) => x.note === 'Beatrice seen')).toBe(false);
      // The note's own words never reach the model.
      expect(r.summary).not.toMatch(/tickly/);
    } finally {
      await adminQuery(`MATCH (d:Doc) WHERE d.id IN $ids DETACH DELETE d`, { ids: made });
    }
  });

  it('reads a note against the graph and turns it into a signed review task linked back to the note', async () => {
    const made: string[] = [];
    try {
      // Prevention: Beatrice takes lisinopril and nothing treats her cough yet.
      const cough = await saveDoc({ kind: 'handover', title: 'Beatrice has a dry cough', text: 'Beatrice Hale has had a dry tickly cough for weeks.' });
      const n1 = await noticeFromNote({ id: cough.id, title: 'Beatrice has a dry cough', kind: 'handover', by: 'Test' }, cough);
      const c = n1.find((x) => x.drug === 'lisinopril');
      expect(c?.kind).toBe('prevention');
      expect(c?.pattern?.id).toBe('acei_cough_antitussive');
      expect(c?.task?.status).toBe('proposed');
      made.push(c!.task!.id);
      expect((await listDocs()).find((d) => d.id === cough.id)?.tasks?.map((t) => t.id)).toEqual([c!.task!.id]);
      // Saying it again links the same open task instead of creating a second one.
      const again = await noticeFromNote({ id: cough.id, title: 'Beatrice has a dry cough', kind: 'handover', by: 'Test' }, cough);
      expect(again.find((x) => x.drug === 'lisinopril')?.task?.status).toBe('existing');
      // In progress: Walter's dizziness is already being treated with meclizine, which the engine rates likely.
      const dizzy = await saveDoc({ kind: 'chat', title: 'Walter dizzy', text: 'Walter Brooks gets dizzy on standing since the Flomax.' });
      const n2 = await noticeFromNote({ id: dizzy.id, title: 'Walter dizzy', kind: 'chat', by: 'Test' }, dizzy);
      const w = n2.find((x) => x.drug === 'tamsulosin');
      expect(w?.kind).toBe('in_progress');
      expect(w?.treatedWith.map((t) => t.id)).toContain('meclizine');
      expect(w?.link?.tier).toBe('likely');
      if (w?.task?.status === 'proposed') made.push(w.task.id);
      // A note that names no patient acts on nobody.
      expect(await noticeFromNote({ id: 'x', title: 'x', kind: 'chat', by: 'Test' }, { patients: [], effects: ['dry_cough'] })).toEqual([]);
      // A note naming two patients (or a name two patients share) cannot say whose symptom it is: no action.
      const both = await saveDoc({ kind: 'handover', title: 'Two patients', text: 'Beatrice Hale and Walter Brooks: Beatrice has a dry cough, Walter is dizzy.' });
      expect(both.patients.length).toBe(2);
      expect(await noticeFromNote({ id: both.id, title: 'Two patients', text: 'Beatrice Hale and Walter Brooks: Beatrice has a dry cough, Walter is dizzy.', kind: 'handover', by: 'Test' }, both)).toEqual([]);
      // A note that rules a symptom out is not a report of it.
      const negText = 'Beatrice Hale seen today: no cough, denies dizziness.';
      const neg = await saveDoc({ kind: 'handover', title: 'Beatrice review', text: negText });
      expect(await noticeFromNote({ id: neg.id, title: 'Beatrice review', text: negText, kind: 'handover', by: 'Test' }, neg)).toEqual([]);
      // A second person's note about the same open question backs the task up; it does not take it over.
      const second = await saveDoc({ kind: 'chat', title: 'Cough again', text: 'Beatrice Hale still coughing at night.' });
      const n3 = await noticeFromNote({ id: second.id, title: 'Cough again', text: 'Beatrice Hale still coughing at night.', kind: 'chat', by: 'Okafor' }, second);
      expect(n3.find((x) => x.drug === 'lisinopril')?.task).toMatchObject({ id: c!.task!.id, status: 'existing' });
      const docs = await listDocs();
      expect(docs.find((d) => d.id === second.id)?.tasks).toEqual([expect.objectContaining({ id: c!.task!.id, how: 'corroborates' })]);
      expect(docs.find((d) => d.id === cough.id)?.tasks).toEqual([expect.objectContaining({ id: c!.task!.id, how: 'raised' })]);
      const own = (await adminQuery(`MATCH (:Task {id: $id})-[:FROM_NOTE]->(d:Doc) RETURN d.id AS doc`, { id: c!.task!.id })) as { data?: { doc: string }[] };
      expect(own.data?.map((r) => r.doc)).toEqual([cough.id]);
    } finally {
      await adminQuery(`MATCH (t:Task) WHERE t.id IN $ids DETACH DELETE t`, { ids: made });
    }
  });

  it('does not call a symptom a prevention window when something already treated it before the drug began', async () => {
    try {
      await adminQuery(
        `CREATE (p:Patient {id: 'p-tmp-note', name: 'Tess Example', age: 70, sex: 'F', medCount: 2})
         WITH p MATCH (a:Drug {id: 'lisinopril'}), (b:Drug {id: 'benzonatate'})
         CREATE (p)-[:TAKES {start: 300, prescriber: 'Dr. Test'}]->(a), (p)-[:TAKES {start: 100, prescriber: 'Dr. Test'}]->(b)`,
      );
      const signals = await noticeFromNote(
        { id: 'doc-none', title: 'Tess cough', text: 'Tess Example has a dry cough.', kind: 'chat', by: 'Test' },
        { patients: ['p-tmp-note'], effects: ['dry_cough'] },
      );
      // Benzonatate was started 200 days before lisinopril: neither "nothing treats it yet" nor a new cascade.
      expect(signals.find((x) => x.drug === 'lisinopril')).toBeUndefined();
    } finally {
      await adminQuery(`MATCH (p:Patient {id: 'p-tmp-note'}) DETACH DELETE p`);
    }
  });

  it('still raises a live cascade when another treater of the same symptom was set aside', async () => {
    const { decisionPayload, signPayload } = await import('../src/lib/agent/sign');
    const made: string[] = [];
    try {
      await adminQuery(
        `CREATE (p:Patient {id: 'p-tmp-aside', name: 'Ivy Example', age: 80, sex: 'F', medCount: 3})
         WITH p MATCH (a:Drug {id: 'amlodipine'}), (b:Drug {id: 'furosemide'}), (c:Drug {id: 'spironolactone'})
         CREATE (p)-[:TAKES {start: 100, prescriber: 'Dr. Test'}]->(a), (p)-[:TAKES {start: 140, prescriber: 'Dr. Test'}]->(b),
                (p)-[:TAKES {start: 160, prescriber: 'Dr. Test'}]->(c)`,
      );
      const d = { id: 'dec-tmp-aside', patientId: 'p-tmp-aside', from: 'amlodipine', to: 'furosemide', verdict: 'not_cascade', by: 'Test', reason: 'Heart failure' };
      await run(Q.recordDecision, { pid: d.patientId, ...d, day: 200, at: Date.now(), sig: signPayload(decisionPayload(d)), pattern: '' });
      const signals = await noticeFromNote(
        { id: 'doc-none', title: 'Ivy swelling', text: 'Ivy Example has ankle swelling again.', kind: 'chat', by: 'Test' },
        { patients: ['p-tmp-aside'], effects: ['peripheral_edema'] },
      );
      const s = signals.find((x) => x.drug === 'amlodipine');
      expect(s?.kind).toBe('in_progress');
      expect(s?.link?.key).toBe('amlodipine>spironolactone');
      if (s?.task?.status === 'proposed') made.push(s.task.id);
    } finally {
      await adminQuery(`MATCH (t:Task) WHERE t.id IN $ids DETACH DELETE t`, { ids: made });
      await adminQuery(`MATCH (p:Patient {id: 'p-tmp-aside'}) OPTIONAL MATCH (p)<-[:ABOUT|FOR]-(x) DETACH DELETE x, p`);
    }
  });

  it('gives every activity event an id, and shows a first learned procedure', async () => {
    const since = Date.now() - 1000;
    await adminQuery(`CREATE (:Procedure {key: 'tmp_activity_pattern', version: 1, role: 'nurse', reason: 'test', at: $at})`, { at: Date.now() });
    try {
      const events = await run<{ type: string; id: string; at: number; title: string }>(Q.activity, { since });
      expect(events.every((e) => typeof e.id === 'string' && e.id.length > 0)).toBe(true);
      expect(events.find((e) => e.type === 'procedure' && e.id === 'tmp_activity_pattern@1')).toBeTruthy();
    } finally {
      await adminQuery(`MATCH (p:Procedure {key: 'tmp_activity_pattern'}) DETACH DELETE p`);
    }
  });

  it('schedules its own follow-up when a review task is completed', async () => {
    const made: string[] = [];
    try {
      const t = await proposeTask({
        pid: 'p-beatrice',
        runId: null,
        title: `Review Amlodipine (follow-up test ${Date.now()})`,
        body: 'Could the ankle swelling be from amlodipine?',
        role: 'pharmacist',
        link: 'amlodipine>furosemide',
        tier: 'likely',
      });
      // The review may already have proposed this question; either way there is a task about the link.
      const tid = t.proposed ? t.id : t.existing!.id;
      if (t.proposed) made.push(t.id);
      const f = await scheduleFollowUp({ id: tid, title: 'Review Amlodipine', patientId: 'p-beatrice', finding: 'amlodipine>furosemide', role: 'pharmacist' }, 'Test');
      expect(f).not.toBeNull();
      made.push(f!.id);
      expect(f!.title).toMatch(/ankle and leg swelling settled since the Amlodipine review/);
      expect(f!.downstream).toEqual(expect.arrayContaining(['Furosemide', 'Oxybutynin', 'Donepezil']));
      const edge = (await adminQuery('MATCH (n:Task {id: $n})-[:FOLLOWS_UP]->(p:Task) RETURN p.id AS prev, n.due AS due', { n: f!.id })) as { data?: { prev: string }[] };
      expect(edge.data?.[0]?.prev).toBe(tid);
      // A task with no cascade link has nothing to follow up.
      expect(await scheduleFollowUp({ id: 'x', title: 'x', patientId: 'p-beatrice', finding: null, role: 'pharmacist' }, 'Test')).toBeNull();
      // Nor does one about a pair the engine does not rate as a cascade (the follow-up is about the task's own link).
      expect(await scheduleFollowUp({ id: 'x', title: 'x', patientId: 'p-beatrice', finding: 'amlodipine>lisinopril', role: 'pharmacist' }, 'Test')).toBeNull();
    } finally {
      await adminQuery(`MATCH (t:Task) WHERE t.id IN $ids DETACH DELETE t`, { ids: made });
    }
  });

  it('previews what a note will link to, with names, and stores nothing', async () => {
    const docCount = async () => ((await adminQuery('MATCH (d:Doc) RETURN count(d) AS n')) as { data?: { n: number }[] }).data?.[0]?.n;
    const before = await docCount();
    const p = await previewLinks('Walter Brooks dizzy on standing. Says the room spins since the Flomax; the walk-in gave him Antivert.');
    expect(p.patients).toEqual([{ id: 'p-walter', name: 'Walter Brooks' }]);
    expect(p.drugs.map((d) => d.name).sort()).toEqual(['Meclizine', 'Tamsulosin']);
    expect(p.effects.length).toBeGreaterThan(0);
    expect(await docCount()).toBe(before);
  });

  it('never passes search operators from user text to the index', () => {
    expect(toSearchQuery('-foo | "bar" %baz% @x:y')).toBe('foo*|bar*|baz*');
    expect(toSearchQuery('the and for')).toBeNull();
  });
});

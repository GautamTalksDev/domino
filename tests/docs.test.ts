// The docs state how many queries and tools Domino has. Those numbers come from the code, and this keeps them in step
// whenever a query or a tool is added or removed.
import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { QUERY_LIST } from '../src/lib/cypher';
import { TOOLS } from '../src/lib/agent/tools';

const files = ['README.md', ...readdirSync('docs').filter((f) => f.endsWith('.md')).map((f) => `docs/${f}`)];
const read = (f: string) => readFileSync(f, 'utf8');
const n = QUERY_LIST.length;
const reads = QUERY_LIST.filter((q) => q.mode === 'read').length;
const writes = n - reads;

describe('docs agree with the code', () => {
  it('every count of catalog queries is the real one', () => {
    const wrong: string[] = [];
    for (const f of files) {
      // "106 named queries", "106 Cypher queries", "the 106 catalog queries", "106 named, parameterised queries", "All 106 queries"
      for (const m of read(f).matchAll(/\b(\d{2,3}) (?:named,? |Cypher |catalog |parameterised )*quer(?:y|ies)\b/g)) {
        if (Number(m[1]) >= 50 && Number(m[1]) !== n) wrong.push(`${f}: "${m[0]}"`);
      }
    }
    expect(wrong, `the catalog has ${n} queries`).toEqual([]);
  });

  it('read and write counts, and tool counts, match', () => {
    expect(read('README.md')).toContain(`All ${n} queries (${reads} read, ${writes} write)`);
    expect(read('README.md')).toContain(`${TOOLS.length} tools · ${n} named queries`);
    expect(read('docs/CYPHER.md')).toContain(`${reads} read queries, ${writes} write templates`);
    expect(read('docs/ARCHITECTURE.md')).toContain(`GRAPH.RO_QUERY for ${reads} reads`);
    expect(read('docs/ARCHITECTURE.md')).toContain(`${TOOLS.length} tools, role-scoped`);
    expect(read('docs/TRACKS.md')).toContain(`${TOOLS.length} tools over a catalog of ${n} parameterised queries`);
    for (const f of files)
      for (const m of read(f).matchAll(/\b(\d+) read(?: queries)?, (\d+) write\b/g)) expect([Number(m[1]), Number(m[2])], `${f}: "${m[0]}"`).toEqual([reads, writes]);
  });

  it('documents every agent tool', () => {
    const tools = read('docs/TOOLS.md');
    for (const t of TOOLS) expect(tools, t.name).toContain(`\`${t.name}\``);
  });
});

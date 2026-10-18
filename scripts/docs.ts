// Regenerates docs/CYPHER.md and docs/TOOLS.md from the code, so the docs never drift.
import { writeFileSync } from 'node:fs';
import { QUERY_LIST } from '../src/lib/cypher';
import { TOOLS } from '../src/lib/agent/tools';
import { createMcpServer } from '../src/lib/mcp';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

// What an MCP client actually sees: list the server's tools and resources over a real MCP connection.
const server = createMcpServer({ allowWrites: true });
const [a, b] = InMemoryTransport.createLinkedPair();
await server.connect(a);
const client = new Client({ name: 'docs', version: '1' });
await client.connect(b);
const { tools: mcpTools } = await client.listTools();
const { resources } = await client.listResources();
await client.close();

const reads = QUERY_LIST.filter((q) => q.mode === 'read');
const writes = QUERY_LIST.filter((q) => q.mode === 'write');
const block = (q: (typeof QUERY_LIST)[number]) =>
  `### ${q.title}\n\n\`${q.id}\` · ${q.mode === 'read' ? 'read-only (GRAPH.RO_QUERY)' : 'write (fixed template)'}\n\n${q.purpose}\n\n\`\`\`cypher\n${q.cypher}\n\`\`\`\n`;

writeFileSync(
  'docs/CYPHER.md',
  `# The Cypher catalog

Every query Domino runs while it serves a request or runs an agent, generated from \`src/lib/cypher.ts\` by \`npx tsx scripts/docs.ts\`. The
only other Cypher is the seeder's schema and bulk-load statements (\`src/lib/seed.ts\`), which build the graph and never run at request time.
User input only ever reaches FalkorDB as a parameter (\`$pid\`, \`$drug\`, …), read queries run through \`GRAPH.RO_QUERY\`
so the database itself refuses writes, and the agents can only write through the ${writes.length} fixed templates at the end.

${reads.length} read queries, ${writes.length} write templates.

## Read queries

${reads.map(block).join('\n')}
## Write templates (agent memory and actions)

${writes.map(block).join('\n')}`,
);

writeFileSync(
  'docs/TOOLS.md',
  `# Agent tools

Generated from \`src/lib/agent/tools.ts\`. A review run is bound to one patient, so no tool takes a patient id from the model.
Arguments are validated with zod before anything touches the graph.

| Tool | Agents | Kind | What it does |
| - | - | - | - |
${TOOLS.map((t) => `| \`${t.name}\` | ${t.roles.join(', ')} | ${t.write ? '**write**' : 'read'} | ${t.description.replace(/\|/g, '/')} |`).join('\n')}

## Over MCP

\`npm run mcp\` serves these over stdio to any MCP client, for one clinic per process (\`DOMINO_CLINIC\`). Inside the app, Ask Domino and the
care-team brain use the same server through an in-memory transport. Patient tools take an explicit \`patient_id\` (Ask Domino injects it, so the
model cannot reach another record). Every result carries \`_meta["domino/queries"]\`: the catalog query ids it ran, which become cited sources.

| MCP tool | Read-only | What it does |
| - | - | - |
${mcpTools.map((t) => `| \`${t.name}\` | ${t.annotations?.readOnlyHint ? 'yes' : '**no** (only with \`DOMINO_MCP_ALLOW_WRITES=true\`)'} | ${(t.description ?? '').replace(/\|/g, '/').replace(/\n/g, ' ')} |`).join('\n')}

| MCP resource | What it is |
| - | - |
${resources.map((r) => `| \`${r.uri}\` | ${(r.description ?? r.name).replace(/\|/g, '/')} |`).join('\n')}
`,
);
console.log(
  `docs/CYPHER.md: ${QUERY_LIST.length} queries · docs/TOOLS.md: ${TOOLS.length} agent tools, ${mcpTools.length} MCP tools, ${resources.length} MCP resources`,
);

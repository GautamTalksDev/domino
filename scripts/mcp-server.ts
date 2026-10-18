// stdio MCP server. stdout carries the protocol, so all logging goes to stderr.
import './env';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createMcpServer } from '../src/lib/mcp';
import { defaultClinic } from '../src/lib/tenant';

console.log = (...args: unknown[]) => console.error(...args);
// One clinic per MCP server process: DOMINO_CLINIC picks the graph (default: the first clinic),
// so a connected assistant only ever sees that clinic's data.
const clinic = defaultClinic();
const server = createMcpServer({ allowWrites: process.env.DOMINO_MCP_ALLOW_WRITES === 'true' });
await server.connect(new StdioServerTransport());
console.error(`[domino] MCP server ready on stdio for ${clinic.name}`);

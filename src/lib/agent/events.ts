export type AgentRole = 'detective' | 'pharmacist' | 'scribe' | 'domino' | 'brain';

export const AGENT_INFO: Record<AgentRole, { name: string; job: string }> = {
  detective: { name: 'Detective', job: 'Walks the graph to find cascades, loops and combined harm, then records findings.' },
  pharmacist: { name: 'Pharmacist', job: 'Checks the evidence, other reasons, safer options and the what-if for each root.' },
  scribe: { name: 'Scribe', job: 'Turns the findings into review tasks and draft notes for humans to approve.' },
  domino: { name: 'Domino', job: 'Answers questions about one patient using the same graph tools, read-only.' },
  brain: { name: 'Care-team brain', job: 'Answers questions about the whole clinic: what the team decided, who knows what, where cascades cross prescribers.' },
};

export type AgentEvent =
  | { type: 'run'; runId: string | null; mode: 'llm' | 'planner'; model: string; patientId: string; trigger: string }
  | { type: 'agent'; agent: AgentRole; status: 'start' | 'done'; text?: string }
  | { type: 'thought'; agent: AgentRole; text: string }
  | { type: 'tool'; agent: AgentRole; id: string; name: string; args: unknown; via?: 'mcp' }
  | {
      type: 'result';
      agent: AgentRole;
      id: string;
      name: string;
      ok: boolean;
      summary: string;
      ms: number;
      queries: { id: string; title: string; ms: number; rows: number }[];
    }
  | { type: 'handoff'; from: AgentRole; to: AgentRole; id: string; verified: boolean; text: string }
  | { type: 'finding'; agent: AgentRole; id: string; label: string; tier: string; score: number }
  | { type: 'task'; agent: AgentRole; id: string; title: string; role: string; owner?: string; memory?: string }
  | { type: 'note'; agent: AgentRole; id: string; kind: string; text: string }
  | { type: 'conversation'; id: string; resumed: boolean; turns: number }
  | { type: 'answer'; text: string; sources?: { tool: string; queries: string[]; summary: string; via?: 'mcp' }[]; conversationId?: string }
  | { type: 'warning'; text: string }
  | { type: 'error'; message: string }
  | { type: 'done'; runId: string | null; summary: string; findings: number; tasks: number; notes: number; ms: number };

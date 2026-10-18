// Guardrails for anything an agent writes or anything that flows from untrusted text into a prompt.
// Maps to OWASP LLM01 (prompt injection), LLM05 (improper output handling), LLM09 (misinformation)
// and Agentic ASI01 (goal hijack) / ASI09 (human-agent trust exploitation).

const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F‪-‮⁦-⁩]/g;

/** Strip control and bidi-override characters, collapse whitespace and cap length. */
export function cleanText(input: unknown, max = 2000): string {
  const s = typeof input === 'string' ? input : input == null ? '' : String(input);
  return s
    .replace(CONTROL, '')
    .replace(/[ \t]{3,}/g, '  ')
    .trim()
    .slice(0, max);
}

// Domino never tells anyone to stop, start or change a medicine. Agents may only raise questions.
const DIRECTIVE = [
  /\bstop (taking|the|her|his|their)\b/i,
  /\bdiscontinue\b/i,
  /\bdeprescribe (it|this|the)\b/i,
  /\b(increase|decrease|double|halve) the dose\b/i,
  /\bstart (taking|her on|him on|them on)\b/i,
  /\bswitch (her|him|them) to\b/i,
  /\byou should (stop|take|start)\b/i,
  // An instruction at the start of a sentence, line or bullet: "Stop amlodipine." "Switch to an ARB." "Hold the furosemide."
  // ("Taper if changed" is a safety caution, not an instruction, so taper is not on this list.)
  /(?:^|[.!?;:]\s+|\n\s*(?:[-*•]\s*|\d+[.)]\s*)?)(?:stop|cease|withdraw|deprescribe|start|begin|initiate|switch|swap|replace|substitute|reduce|prescribe|hold)\b(?!\s*(?:date|:))/i,
  // "... should be stopped", "must start", "needs to be switched"
  /\b(?:should|must|needs? to|ought to|has to|have to)\s+(?:be\s+)?(?:stop(?:ped)?|discontinued|ceased|withdrawn|deprescribed|start(?:ed)?|switch(?:ed)?|swapped|replaced|reduced|increased|decreased|lowered|held|hold)\b/i,
  // Dose changes: "reduce the dose", "lower her dose", "cut his dose"
  /\b(?:reduce|lower|decrease|increase|raise|cut|double|halve)\s+(?:the|her|his|their)\s+dose\b/i,
];

export interface GuardResult {
  ok: boolean;
  reason?: string;
}

export function checkClinicalWording(text: string): GuardResult {
  for (const re of DIRECTIVE) {
    if (re.test(text)) {
      return {
        ok: false,
        reason:
          'Rejected by the safety guardrail: Domino may not instruct medication changes. Rephrase as a question for the prescriber or pharmacist (for example "Could the swelling be from amlodipine? Consider reviewing...").',
      };
    }
  }
  return { ok: true };
}

/** Wrap untrusted data before it reaches a model so instructions inside it are treated as data. */
export function asData(label: string, value: unknown): string {
  const json = JSON.stringify(value);
  return `<data source="${label}">\n${json}\n</data>`;
}

export function truncateForModel(text: string, max = 6000): string {
  return text.length > max ? `${text.slice(0, max)}\n…(truncated)` : text;
}

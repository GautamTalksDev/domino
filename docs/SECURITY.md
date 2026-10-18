# Security

Domino handles (synthetic) health data and lets AI agents write to a database, so it is designed against three lists:
the **OWASP Top 10:2025**, the **OWASP Top 10 for LLM Applications (2025)** and the **OWASP Top 10 for Agentic Applications (2026)**.

## Threat model

| Asset | Threat | Control |
| - | - | - |
| The graph | Injection through any input | No user input is ever concatenated into Cypher; 105 named queries with parameters only; every read query has a timeout (15 s by default), so no traversal can hold the database; full-text search terms are reduced to plain lower-case words before they reach the index |
| The graph | An agent (or a hijacked model) writing where it shouldn't | Read tools run as `GRAPH.RO_QUERY`; writes only via fixed templates; per-run write limits |
| Tenants | One clinic reading another clinic's records | A graph per clinic, chosen on the server from an allowlisted cookie; no query, tool or model argument can name a graph (tested) |
| Conversations | One person reading or appending to another's thread | Every conversation query matches on the person in the session and the subject; a foreign id returns nothing; the care-team search returns only your own messages (tested) |
| CDS Hooks endpoints | Anyone on the internet can call `/cds-services` (that is the protocol) | CORS on these routes only; their own rate-limit bucket (so EHR traffic never starves the agents); strict schema with size limits (256 KB); medicines matched only when the generic or brand name is in the text; cards written only at order-sign, once per call (a retry reuses them), never deleting an answered card, at most 50 unanswered per patient and 2,000 overall; one temporary patient per EHR patient and list, found by hash; feedback only on cards Domino issued to the same caller, first answer only, with Domino's own wording for the reason; card ids never appear in the activity feed or on any page; a caller cannot name itself there, and an unverified caller's check never raises a toast. With `DOMINO_WRITE_KEY` set, unauthenticated callers can only check patients Domino holds (no temporary patients, no stored cards). With `DOMINO_CDS_ISSUERS` set, every call needs the EHR's signed token (CDS Hooks "Trusting CDS Clients"): a trusted issuer, a key from its JWKS, an ES384/RS384 signature, `aud` equal to the service URL, at most five minutes old, and a `jti` never seen before (`src/lib/cdsAuth.ts`); the audience is `DOMINO_SITE_URL`, never the request's Host header, and a malformed issuer setting refuses every call instead of switching the check off; an unknown key id refetches the key set at most once a minute (key rotation); only then may an outside EHR write, and its issuer is what the activity feed shows |
| Notes that raise tasks | Using a note to plant work | A note can only lead to a task through `proposeTask`: the same wording guard, procedural memory, dedupe and HMAC signature as an agent's task, at most one per note, only when the note names exactly one patient, only about that patient's own drugs and a symptom the note reports (negated mentions such as "no cough" are ignored). A task the note raised links to it (`FROM_NOTE`); a note about a question already open only `CORROBORATES` it, so a task's source is never rewritten. The live activity feed is read-only and scoped to the session's clinic graph |
| Procedural memory | Steering how tasks are routed | Agents have no tool that writes a procedure; procedures change only from tasks people decided whose signatures verify (the pattern is signed too), by a fixed rule, and keep links to that evidence. Tasks only move forward and an approval is final (it can be completed, never turned into a dismissal), so an outcome cannot be rewritten; a version is written only if the one it learned from is still active |
| Team notes | Prompt injection or junk through a note a person writes | Notes are a same-origin write (and need the key when set), cleaned and length-capped; the entity linker sends only plain lower-case words to the full-text index; agents see note titles only, as data |
| Coordination | Two instances running the same review and writing twice | A lease in the graph (`Lock`), check-and-set in one write query, which FalkorDB serialises per graph (tested) |
| Check-up | Filling the graph with junk patients, or a pasted list lingering | Sandbox patients expire after 2 hours (unreadable from then on, deleted on the next check-up or nightly cron), are capped at 200 in the same write that creates them, take no names, and are excluded from every list, sweep, search and clinic-wide memory; the `heavy` rate-limit bucket |
| Agent memory | Planting a fake "intentional" decision so a cascade is hidden later | Agents cannot write decisions; every decision is HMAC-signed and verified on read |
| Agent coordination | Tampering with a handoff between agents | Handoffs are signed, stored, read back and verified; a failure stops the run |
| Clinicians | An agent persuading a person into an unsafe change | A wording guardrail checks everything an agent writes or says (tasks, notes, follow-ups, handoffs and answers) for instructions to stop, start, switch or change the dose of a medicine: a task or note that fails is refused, a handoff is held back, a model's answer is replaced by the graph planner's (tested); tasks are proposals; every claim shows its evidence |
| Clinicians | "Not found" read as "safe" | A medicine Domino cannot match is never silently dropped: Ask Domino says it is not in the graph and was not checked; a CDS order it cannot match gets an info card saying so, and unmatched medicines on the EHR's list are named on every card; a check-up keeps its unmatched lines on the record and the review says it covered nothing about them (tested) |
| A public demo | Many visitors sharing one graph; vandalism; an idle hosted database | `DOMINO_OPEN_DEMO=true` opens only what a visitor needs to try the product (reviews, questions, decisions, inbox tasks, adding and undoing a prescription, team notes, check-ups, the evaluation re-run, the EHR demo), still same-origin and rate-limited; a visitor's team note may not contain links (the board is shared); the six story patients' medicine lists cannot be changed without the key, so every judge sees the same story; the latest decision on a link wins, so a judge can change one back; the key still guards sweeps and the reset. `DOMINO_DEMO_RESET=nightly` rebuilds every clinic from the seed each night. The keep-alive (`/api/cron/keepalive`, `CRON_SECRET` only) keeps an idle free-tier database running and reseeds a graph that came back empty. Two visitors opening the same review wait for each other's lease instead of failing |
| LLM budget | Abuse of the agent endpoints | Rate limits per IP and bucket, step/token budgets, timeouts, one run per patient; when every Gemini model fails (quota, outage), the model is skipped for a minute and the graph planner answers, so a flood cannot burn the key or stall reviews |
| Semantic memory | Search by meaning leaking someone's conversation, or vectors from different models mixing | The meaning search filters conversation messages to the asking person, exactly like the word search, and check-up patients are excluded; vectors live on the nodes in the clinic's own graph (no separate vector store, no cross-clinic index); each vector records its model and only same-model vectors are compared; the Gemini key is server-side only. With a key, the text of team notes, tasks, decisions and messages is sent to Google's embedding API, which is why Domino uses synthetic data only |
| Secrets | Leaking API keys | Server-side env only, never `NEXT_PUBLIC_*`, never logged, never echoed in errors |

## OWASP Top 10:2025

| Category | Domino |
| - | - |
| **A01 Broken Access Control** | A review run is bound to one patient and tools take no patient id from the model; the MCP patient tools get the patient id injected by Domino. A graph per clinic, selected on the server. Conversations are scoped to the person in the session. Decisions are HMAC-signed with the session's identity; task decisions record the session's identity (approver and, separately, who completed it). Neither ever takes a name from the request body. Mutations, including asking a question (it writes your conversation), need a same-origin request (`Sec-Fetch-Site`, `Origin` checks) and, when `DOMINO_WRITE_KEY` is set, the key (header or httpOnly cookie; the UI asks for it once). Caches are per clinic graph. Only people write decisions. Admin reset always needs the key in production. |
| **A02 Security Misconfiguration** | Nonce-based CSP with `strict-dynamic` (`src/proxy.ts`; the only addition for the 3D is `worker-src 'self' blob:`, for the GPU check's one-line worker), `frame-ancestors 'none'`, `X-Frame-Options: DENY`, `nosniff`, strict referrer policy, permissions policy, COOP/CORP, HSTS on HTTPS, `x-powered-by` off, `Cache-Control: no-store` on the API. FalkorDB is bound to `127.0.0.1` in `docker-compose.yml`. The container runs as a non-root user. |
| **A03 Software Supply Chain Failures** | Exact-pinned dependencies with a lockfile, `npm audit` clean, `npm ci --ignore-scripts` in Docker, no install scripts of our own. The ESLint chain was removed because it pulled a vulnerable transitive dependency. Fonts are self-hosted packages, no CDN scripts. |
| **A04 Cryptographic Failures** | HMAC-SHA256 over canonical JSON for handoffs, tasks and decisions, covering everything a person reads (task title and body, decision verdict and reason) with a record-type field so one kind of signature cannot be replayed as another; constant-time comparison; production refuses to start signing without `DOMINO_SIGNING_SECRET` (16+ chars). TLS to FalkorDB Cloud via `rediss://`. |
| **A05 Injection** | Parameterised Cypher only; JSON bodies must be exactly `application/json` (so a no-preflight `text/plain; charset=application/json` cross-site post is a 415); zod validation with `.strict()` (unknown keys rejected); id formats enforced by regex; id lookups use null-prototype maps, so `constructor` or `__proto__` never resolves to an inherited property; the query console only accepts the parameters each query declares; JSON-only bodies capped at 16 KB; React escapes all text and nothing uses `dangerouslySetInnerHTML`; LLM output is never executed as code or Cypher. |
| **A06 Insecure Design** | Human approval for every action; agents raise questions only (guardrail); deterministic planner as a safe fallback; per-run limits (12 findings, 6 tasks, 2 notes). |
| **A07 Authentication Failures** | Optional access key exchanged at `/api/unlock` for an `httpOnly`, `SameSite=Strict` cookie, `Secure` whenever the request came over HTTPS (directly or via `X-Forwarded-Proto`), 12 h lifetime; HSTS and `upgrade-insecure-requests` are sent on HTTPS only, so a plain-HTTP deployment on a private network still works (use TLS anywhere else); constant-time comparison; rate-limited. The clinic and person switcher is a demo identity, not authentication: the cookies are `httpOnly`, validated against allowlists, and in production would be replaced by an SSO identity mapped to a clinic. |
| **A08 Software or Data Integrity Failures** | Signed records verified on read; unverified tasks are flagged and cannot be approved; unverified decisions are ignored. |
| **A09 Logging & Alerting Failures** | Every agent event is persisted as a `Step` node linked to the queries it ran and what it wrote (a provenance graph, not a log file); server logs record errors without secrets or patient data; `/api/health` reports configuration warnings (dev secret, open writes). |
| **A10 Mishandling of Exceptional Conditions** | Typed errors mapped to safe status codes (400/401/403/404/409/413/415/429/503); no stack traces to clients; LLM timeouts, model fallback with cooldown; the UI degrades to a clear "start FalkorDB" screen. |

## OWASP Top 10 for LLM Applications (2025)

| Risk | Domino |
| - | - |
| **LLM01 Prompt Injection** | Record text and handoffs are wrapped as `<data>` and the role prompts say data is never instructions; tools cannot be steered into other patients or free-form queries; control and bidi-override characters are stripped. |
| **LLM02 Sensitive Information Disclosure** | Synthetic data only; the model sees one patient per run; keys never reach the browser. |
| **LLM03 Supply Chain** | Providers are called over HTTPS with `redirect: 'error'`; base URLs come only from server env (no user-supplied URLs, no SSRF). |
| **LLM04 Data and Model Poisoning** | The knowledge graph is versioned code with integrity tests (`tests/knowledge.test.ts`). |
| **LLM05 Improper Output Handling** | Model text is rendered as plain text, length-capped and checked by the wording guardrail before it is stored or shown: a task or note that fails is refused, a handoff is held back, an answer is replaced by the graph planner's. |
| **LLM06 Excessive Agency** | Least privilege per agent; read tools are database-enforced read-only; write tools only create proposals and drafts. |
| **LLM07 System Prompt Leakage** | Prompts contain no secrets. |
| **LLM08 Vector and Embedding Weaknesses** | With a Gemini key, team memory is also retrieved by vector similarity. Vectors live on the nodes of the clinic's own graph (no shared vector store, nothing crosses clinics); the meaning search filters to the asking person's own messages and drops check-up patients, after fetching enough neighbours that other people's items cannot crowd out the person's own; check-up conversations are never sent for embedding; each vector records its model and only same-model vectors are compared; vectors are written by internal id and node id together, so a reused id never receives another node's vector; a new decision note drops the task's old vector. Retrieved text reaches the model as tool-result data (`asData`), never as instructions, and the wording guard still checks everything an agent stores. |
| **LLM09 Misinformation** | Every claim carries its path, factors and references; evidence levels are labelled; the evaluation is published with its caveats. |
| **LLM10 Unbounded Consumption** | Rate limits, 8 steps and 4 executed calls per turn per agent (extra calls are answered as skipped, never dropped), 2,048 output tokens, 45 s timeouts, one run per patient. |

## OWASP Top 10 for Agentic Applications (2026)

| Risk | Domino |
| - | - |
| **ASI01 Agent Goal Hijack** | Goals are fixed by role and tool subset; injected text cannot add tools or change the patient. |
| **ASI02 Tool Misuse & Exploitation** | zod-validated arguments, role checks, write limits, safe error messages back to the model. |
| **ASI03 Identity & Privilege Abuse** | No shared credentials reach the model; the DB connection is server-side; agents act within a patient-scoped and clinic-scoped context; the care-team brain's tools are read-only and clinic-scoped. |
| **ASI04 Agentic Supply Chain** | One MCP server, ours, read-only by default (patient read tools, care-team tools, resources); writes opt-in with `DOMINO_MCP_ALLOW_WRITES`; one clinic per server process (`DOMINO_CLINIC`). |
| **ASI05 Unexpected Code Execution** | Nothing the model produces is executed. |
| **ASI06 Memory & Context Poisoning** | Only people write decisions; signatures verified on every read; forged records ignored and flagged (tested). Procedures are learned only from human task decisions. Earlier conversation turns are sent to the model as conversation, never as instructions, and are capped at eight messages. |
| **ASI07 Insecure Inter-Agent Communication** | Signed handoffs, stored and verified through the graph; failure stops the run. |
| **ASI08 Cascading Failures** | Safety nets between agents; a failed agent ends the run cleanly instead of passing bad state on; the lease expires if a process dies, so a crashed run never blocks a patient for more than two minutes. |
| **ASI09 Human-Agent Trust Exploitation** | Outputs are questions with evidence, never orders; the what-if is labelled a simulation and names other contributors. |
| **ASI10 Rogue Agents** | Full audit trail of every step, with provenance edges from each finding back to the tool call and queries that wrote it; bounded autonomy; nothing irreversible without a person. |

## Verified behaviour

```
cross-site POST                 → 403 "Cross-site requests are not allowed."
foreign Origin                  → 403 "Cross-origin requests are not allowed."
bad patient id / path traversal → 400 "Invalid patient id."
extra JSON field ("cypher": …)  → 400 "Unrecognized key"
injection in drug id            → 400 "invalid drug id"
non-JSON body                   → 415
20 KB body                      → 413
10 agent runs in a burst        → 8 accepted (the burst size), then 429
read query attempting CREATE    → rejected by FalkorDB (GRAPH.RO_QUERY), tested
forged Decision in the graph    → ignored, warning shown, tested
unknown clinic or person         → 400 (allowlist)
text/plain;charset=application/json → 415
re-deciding a decided task       → 409, tested
approved task then dismissed     → 409 (an approval is final), tested
unsigned task approved           → 409 (it can only be dismissed, and teaches nothing)
expired check-up                 → 404 before the purge, tested
another person's conversation id → empty, tested
Lakeview scope, Riverside patient → 404, tested
5 reviews of one patient at once → 1 runs, 4 refused (BusyError), tested
search "-foo | \"bar\" %baz%"      → foo*|bar*|baz* (operators stripped), tested
```

## Deployment checklist

- Set `DOMINO_SIGNING_SECRET` (32 random bytes), `DOMINO_WRITE_KEY` and `CRON_SECRET` (16+ characters).
- Use `rediss://` with a password where the FalkorDB tier offers TLS; never expose 6379 publicly. FalkorDB Cloud's free tier has no TLS, so
  its traffic (including the password) is unencrypted: use it only for synthetic data, with a password used nowhere else.
- Set `DOMINO_TRUST_PROXY=true` on Vercel or behind a reverse proxy you control. Without it, client IP headers are ignored
  (they can be forged) and every caller shares one rate-limit bucket.
- Keep `DOMINO_MCP_ALLOW_WRITES` off unless you need it.

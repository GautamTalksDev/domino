# Opening Domino in VS Code (Windows + WSL)

These steps assume Windows with WSL (Ubuntu) and Docker Desktop, the same setup used for Porchlight. On macOS or Linux, skip the WSL parts.

## 1. Put the project in WSL

In an Ubuntu (WSL) terminal:

```bash
mkdir -p ~/projects && cd ~/projects
# copy the zip from Windows Downloads into WSL, then unzip it
cp /mnt/c/Users/<your-windows-user>/Downloads/domino.zip .
unzip domino.zip && cd domino
```

Keep the project inside the WSL filesystem (`~/projects`), not under `/mnt/c`: installs and file watching are much faster.

## 2. Open it in VS Code

```bash
code .
```

This opens VS Code connected to WSL (install the **WSL** extension if VS Code asks). Accept the recommended extensions
(Tailwind CSS, Vitest, Docker, Prettier) when prompted. When VS Code asks which TypeScript version to use, pick **Use Workspace Version**.

## 3. Install, start FalkorDB, seed

In the VS Code terminal (`` Ctrl+` ``):

```bash
nvm use 22 || nvm install 22    # Node 20.12+ works; 22 recommended
npm install
cp .env.example .env.local      # edit later for keys
npm run db                      # starts FalkorDB in Docker Desktop on localhost:6379
npm run setup                   # seeds the graph, runs the sweep and the evaluation
npm run dev                     # http://localhost:3000
```

Or use **Terminal → Run Task…**: tasks 1, 2 and 3 do the same three steps.

Docker Desktop must have **WSL integration** enabled for your Ubuntu distro (Settings → Resources → WSL integration).

## 4. Use FalkorDB Cloud instead of Docker (optional)

1. Create a free instance at https://app.falkordb.cloud.
2. Copy the host, port, username and password.
3. In `.env.local`: `FALKORDB_URL=rediss://default:PASSWORD@HOST:PORT` (use `redis://` if TLS is off on your instance).
4. `npm run setup`, then `npm run dev`.

The free tier can pause when idle. Open the console and wake it before you record or demo.

## 5. Add credentials

Only these are needed, all in `.env.local`:

| Variable | Needed? | What for |
| - | - | - |
| `FALKORDB_URL` | yes | the graph |
| `GEMINI_API_KEY` | optional | Gemini agents (3.8 Flash, with fallbacks) and search by meaning (embeddings in a FalkorDB vector index); otherwise the graph planner runs and search is by words |
| `ANTHROPIC_API_KEY` or `OPENAI_API_KEY` | optional | other LLM providers for the agents (embeddings still need the Gemini key) |
| `DOMINO_SIGNING_SECRET` | for deployment | signs handoffs, tasks and decisions |
| `DOMINO_WRITE_KEY` | for a public deployment | protects writes |
| `DOMINO_TRUST_PROXY` | `true` on Vercel | per-client rate limits (otherwise one shared bucket) |
| `DOMINO_CDS_ISSUERS` | optional | CDS Hooks: only EHRs with a valid signed token from these issuers may call (otherwise the open demo); needs `DOMINO_SITE_URL` |
| `DOMINO_SITE_URL` | for deployment | the public URL (sitemap, share card, and the audience EHR tokens are checked against) |

Generate a secret with `node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"`.

`npm run check` tells you what is set, what is missing and what to do.

## 6. Everyday commands

| Command | |
| - | - |
| `npm run dev` | app with hot reload |
| `npm test` | 150+ tests. They seed their own graphs (`domino_test`, `domino_test_lakeview`) on every run, so they never touch the graphs the app uses |
| `npm run typecheck` | TypeScript |
| `npm run setup` | rebuild both clinics' graphs, sweep them and regenerate the evaluation (wipes agent memory too) |
| `npm run seed` | rebuild both clinics' graphs only |
| `npm run scan` | population sweep |
| `npm run eval` | evaluation, updates `src/data/generated/eval.json` |
| `npm run mcp` | MCP server for Claude Desktop or another MCP client (`DOMINO_CLINIC=lakeview` for the other clinic) |
| `npm run bench` | concurrency benchmark against the running database, writes `docs/BENCHMARK.md` |
| `npm run docs` | regenerate `docs/CYPHER.md` and `docs/TOOLS.md` |
| `npm run smoke` | with `npm run dev` running: checks every page, the agents and the security headers |
| `npm run a11y` | with the app running: axe-core accessibility checks on every page and overlay (once: `npx playwright install chromium`) |
| `npm run verify:labels` | cross-checks the knowledge graph against FDA labels (writes `docs/LABEL_CHECK.md`) |

FalkorDB Browser (graph visualisation of the raw data) runs at http://localhost:3001 when you use Docker. Connect to `falkordb:6379` from inside it, or `localhost:6379`.

## 7. Before recording the video

```bash
npm run setup   # fresh graphs for both clinics, sweep results in place
```

Then open `http://localhost:3000/patients/p-beatrice?tour=1` for story mode. See [VIDEO_SCRIPT.md](VIDEO_SCRIPT.md).

## Troubleshooting

| Symptom | Fix |
| - | - |
| "Domino can't reach its graph" | `docker ps` should show `falkordb`; otherwise `npm run db`. Check `FALKORDB_URL`. |
| "Graph empty" in the header | `npm run setup` |
| Port 6379 already used | Another Redis is running. Stop it, or map FalkorDB to another port in `docker-compose.yml` and set `FALKORDB_URL` |
| 429 Too many requests | The agent endpoint allows 6 runs a minute per IP. Wait a minute. |
| "A review for this patient is already running" | Another tab or instance holds the patient's lease. It is released when that run ends, or expires within two minutes. |
| An "Access key" dialog appears | The deployment sets `DOMINO_WRITE_KEY`: paste the key once; it is kept for 12 hours in an httpOnly cookie. |
| The header says "graph planner" | No LLM key set. That is fine; add one to `.env.local` and restart `npm run dev` for LLM agents. |
| The header says "model paused after an error" | Every Gemini model failed in the last minute (quota, invalid key, outage). `/api/health` shows the reason in `modelPaused`; the planner answers meanwhile. |
| Team search says "Searching by words" | No `GEMINI_API_KEY`, `DOMINO_EMBEDDINGS=off`, or the embedding model is over quota. Run `npm run embed` after adding the key. |

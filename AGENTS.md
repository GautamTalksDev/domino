<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Domino: notes for coding agents

- **FalkorDB is the engine.** Never add an in-memory fallback for graph logic; the hackathon rules require the product to fail without FalkorDB.
- **All Cypher lives in `src/lib/cypher.ts`.** Add new queries there with an id, title, purpose and mode, call them through `run()` in `src/lib/db.ts`,
  pass user input only as parameters, and run `npm run docs` afterwards.
- **Read queries must use mode `read`** (they run as `GRAPH.RO_QUERY`). Writes are fixed templates only.
- **Agent tools** are in `src/lib/agent/tools.ts`: validate arguments with zod, never accept a patient id from the model, keep write tools limited to proposals and drafts.
- **Clinical wording:** agents raise questions; `checkClinicalWording()` must pass for anything an agent stores.
- **Signed records:** handoffs, tasks and decisions are signed with `signPayload()` and verified with `verifyPayload()` on read.
- **Next.js 16:** `proxy.ts` (not middleware), async `params`/`searchParams`, the root layout reads `headers()` so the CSP nonce works.
- **Tests:** `npm test` needs FalkorDB running; it seeds its own graphs (`domino_test*`) on every run and never touches the app's graphs.
- **Tenancy:** every request runs in `runInScope()`; never pick a graph from request input. Clinic-wide queries must exclude check-up patients (`p.sandbox IS NULL`).
- **UI kit:** `.card`, `.btn-*`, `.field` for text inputs, `.kbd`, `toast()` from `src/lib/toast.ts` for feedback, `postJson`/`streamPost`/`sendDelete` from `src/lib/client.ts` (they handle the access-key prompt). Overlays that must cover the page portal to `<body>` and use `useDialogFocus`. Keyboard shortcuts live in `src/components/Shortcuts.tsx` (`GO` table); show modifier keys with `useModKey()`.
- **3D:** `src/components/three/*` (plain three.js), always behind `next/dynamic` with `ssr: false`, a WebGL check and a non-3D fallback; pause off screen and respect reduced motion.
- **Style:** dark theme tokens in `src/app/globals.css`; Fraunces for display, Geist for UI and code.

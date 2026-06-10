# Threat Raccoon — Session Handoff Brief

> Working continuity doc so this effort can be picked up cold. Updated 2026-06-10 (end of Linux-box session).
> Now committed to the repo so it travels to the user's Windows 11 work PC.

## 0. READ FIRST — resuming on the Windows 11 work PC

The user (RedTeamRaccoon) is moving development to a **Windows 11 work laptop**
(repo under `%USERPROFILE%\tools\threat-raccoon`, shell is **Windows PowerShell 5.1** — keep any
generated scripts **pure ASCII**; PS 5.1 reads UTF-8-no-BOM as Windows-1252 and a stray em-dash broke parsing
once already, fixed in `e6a11f1f`).

Things that did NOT travel from the Linux box:
- **`.env` is untracked.** The Linux box's `.env` had working Anthropic/OpenAI keys + a Claude Code OAuth token.
  On the work PC **GitHub Copilot is the ONLY authorized provider for confidential data** — generate the token
  with `node scripts/get-copilot-token.mjs` (writes `LLM_COPILOT_API_KEY`/`LLM_ENABLED`/`LLM_PROVIDER` to `.env`),
  or run the full `scripts\setup-windows.ps1`.
- **Claude memory files** (`~/.claude/projects/...` on the Linux box) — the durable decisions are mirrored in
  §5/§9 of this brief; honor them (especially: NO Co-Authored-By trailers, NO algorithmic DFD auto-layout).
- The Linux box also ran dev servers on :3000/:8081 and a Docker TD on :8080 — irrelevant on the work PC.

Likely first task on the work PC: run the Windows setup (or just `npm install` + `npm run build:server`),
mint a Copilot token, and do the **live Copilot E2E** (§6.1) — the last untested provider.

## 1. What this is

A fork of **OWASP Threat Dragon** (`RedTeamRaccoon/threat-raccoon`, fork of `OWASP/threat-dragon`)
adding a headline capability: **chat with an AI agent, share design docs, and have it build a complete
threat model — DFDs + STRIDE threats — that appears live on the X6 canvas**, plus **native MCP** so the
same threat-model operations are drivable by external MCP clients (Claude Code, GitHub Copilot CLI,
OpenCode, Codex, Cursor, Claude Desktop).

- Frontend: `td.vue` — Vue 3 under `@vue/compat` (Options API, bootstrap-vue, Vuex 4, `@antv/x6`).
- Backend: `td.server` — Express 5 + Babel (transpiled to `dist/`).
- Shared core: `shared/tmcore` — dependency-light **ESM** module (`ajv`, `ajv-formats`, `uuid`).
- Desktop: `td.vue/src/desktop` — Electron (BYO key, local stdio MCP).
- PRs target the **fork** (RedTeamRaccoon), not OWASP upstream. Squash-merge, then delete branch.

## 2. Architecture (one screen)

```
External MCP clients ─┐                       In-app chat panel (browser/desktop)
(Copilot CLI, Claude   │                       runs the agent/tool-use loop
 Code, OpenCode, Codex)▼                              │ tool_use → execute → tool_result
              MCP server (stdio + HTTP)               ▼
                     │                         Browser binding (live X6/Vuex canvas)
                     └──────────┬────────────────────┘
                                ▼
              shared/tmcore — ONE operations core (10 ops)
   createDiagram, addElement, connectFlow, addBoundary, addThreat,
   updateElement, removeElement, listThreats, validateModel, getModelSummary
   + AJV v2-schema validation + threat taxonomy + tool defs + MODELING_GUIDANCE
                                │
   LLM proxy (server) / desktop relay — provider-agnostic normalized stream;
   adapters: anthropic | openai | copilot | claudecode(OAuth)
```

**One contract, two bindings.** Server/MCP binding mutates a plain v2 JSON doc (persisted via repo store or
a local file). Browser binding applies the same ops to the live X6 graph + Vuex so the diagram builds in
real time. Both validate against the single canonical v2 schema.

## 3. Current state — DONE (7 PRs on `main`, base OWASP `00f59b5d`)

| PR | Commit | What |
|----|--------|------|
| #1 | `403d8255` | Native MCP + collaborative AI threat modeling (tmcore, MCP stdio+HTTP, in-app assistant, 4 providers, desktop mode) |
| #2 | `97016f34` | Editor UI/UX: dark mode, resizable canvas + fullscreen, z-order right-click, auto-layout **button** (Dagre), snap toggle, word-wrap |
| #3 | `223e4187` | Verified MCP client walkthroughs (Claude Code / OpenCode / Codex) |
| #4 | `b6a4395f` | Shared `MODELING_GUIDANCE` (readable + thorough); MCP `instructions` + `build_threat_model`/`review_coverage` prompts; in-app system prompt; verified 15→37 threats |
| #5 | `cc889b82` | Multi-DFD decomposition guidance (1 spider-web → 6 focused DFDs) |
| #6 | `5523303b` | Fix: root `postinstall` now installs `shared/tmcore` (MCP server needs it as native ESM) |
| #7 | `4910fa4f` | Docs: GitHub Copilot CLI MCP walkthrough |
| #8 | `aec29b91` | Docs: Windows 11 install / run / MCP-config instructions |
| #9 | `c6406a5a` | **fix:** in-app assistant streaming (Express 5 `req.on('close')` killed every SSE stream) + provider-model selection (switching providers sent the global default model → 404). Both found by live E2E. |
| #10 | `b9c6c750` | **test/hardening:** Cypress assistant e2e (SSE→tool_use→canvas); LLM proxy error/log sanitisation (no credential leakage); Copilot token-exchange error handling; desktop relay test. |
| #11 | `743c6035` | **feat:** GitHub Copilot onboarding — `scripts/get-copilot-token.mjs` (device-flow token → `.env`) + `scripts/setup-windows.ps1` (zero-prereq Win11 setup) + README/scripts quick-start. |
| #12 | `c9a903a0` | docs: README leads with the fork's features/setup (🦝 banner, Copilot quick-start, divider, upstream README below). |
| #13 | `1f16ad48` | docs: clone/source/issue references point at the fork (OWASP attribution/resources kept). |
| — | `e6a11f1f` | **fix (direct push, gh API was 401ing):** onboarding scripts made pure ASCII — PS 5.1 parse failure. |
| #14 | `79b188fd` | **fix:** TLS off by default; `APP_USE_TLS` compared as string (`"false"` was truthy) and missing certs now warn + fall back to HTTP instead of crashing `npm start`. |

**Gates (current `main`):** `shared/tmcore` **18** (node --test) · `td.server` **544** (mocha) · `td.vue` **1545**
(jest unit) + **173** (desktop) · cypress assistant suite passes headless (chromium) · builds clean.

**Providers implemented** (`td.server/src/llm/providers/`): `anthropic`, `openai`, `copilot`, `claudecode`
(+ `anthropicStream.js`, `openaiTranslate.js`). **Desktop** (`td.vue/src/desktop/`): `desktop.js`, `keyStore.js`
(safeStorage BYO key), `llm.js` (local relay), `mcpFileStore.js` (stdio MCP over the open file), `menu.js`.

## 4. The in-app chat panel is ALREADY built (important)

It is NOT a remaining task. Implemented and wired:
- UI: `td.vue/src/components/Assistant/{AssistantPanel,AssistantComposer,AssistantMessage,AssistantSettings}.vue`
- Mounted in `td.vue/src/components/Graph.vue` (`<td-assistant-panel :graph="graph"/>`, line ~44; toggle ~14)
- Logic: `td.vue/src/service/assistant/{agentLoop,browserBinding,proxyClient,providerCatalog}.js`,
  `store/modules/assistant.js`, `store/actions/assistant.js`
- Server: `td.server/src/controllers/llmcontroller.js`

**Why it looks "missing":** the toggle is `v-if="aiEnabled"` (`Graph.vue:14`). With the MCP-only flow (no AI
configured in TD), `aiEnabled` is false and the panel is hidden by design. **To see it:** server mode →
`LLM_ENABLED=true` + a provider key (see `docs/configure/configure.md#ai-assistant-and-mcp-environment`);
or desktop mode → BYO key in settings.

## 5. Hard-won gotchas & decisions (read before touching these areas)

- **tmcore generates data-correct but render-incomplete JSON**, because TD's interactive `setName`/`cell:added`
  sync paths don't run on `fromJSON` load. Each was fixed at the tmcore source + a load-path normalizer in
  `td.vue/src/service/diagram/diagram.js`:
  - Boundaries: `zIndex:-1` + registered shape `trust-boundary-curve`/`-box` (legacy `trust-boundary` repaired on load).
  - Flow labels: must be `labels[0].attrs.**label**.text` with numeric `position:0.5` (NOT `labelText`).
- **X6 2.19.2 cannot word-wrap** — `breakWord` is commented out in its `textWrap` handler; `Dom.breakText`
  is character-only. Word-wrap is done by inserting real `\n` (`td.vue/src/service/x6/text-wrap.js`,
  `normalizeModelLabels` called in `diagram.js`).
- **Auto-layout engine was tried and REJECTED.** A `shared/tmcore/layout.js` layered pass made DFDs too
  wide/narrow (bad for 8.5×11 print) and overlapped trust boundaries (false shared-resource signal). The
  user prefers the **LLM's own layout** (multi-DFD guidance) + manually nudging a few labels. **Do not
  re-add algorithmic auto-layout.** (The editor's manual "Auto-arrange" Dagre *button* from PR #2 stays.)
- **shared/tmcore loads as native ESM** from the Babel-CJS server via `td.server/src/mcp/loadTmcore.js`
  (`new Function('s','return import(s)')`). It needs its own `node_modules` → installed via root `postinstall`
  (PR #6). `td.vue` only imports the PURE subpaths (`@tmcore/tools.js`, `@tmcore/guidance.js`) into the
  browser bundle — never the barrel/`validate.js` (they pull `node:module`).
- **No co-author trailer** on commits/PRs (global pref). Squash-merge PRs, delete branch.

## 6. Remaining work

Most of the verification/hardening from the previous handoff is now DONE (PRs #9, #10 + the desktop/cypress agents):
- ✅ In-app assistant verified LIVE end-to-end — **Anthropic** and **OpenAI** both build elements on the X6
  canvas (real key → server proxy → SSE → agent loop → browser binding). Two real bugs found and fixed (#9).
- ✅ Desktop mode verified (Electron builds/runs, BYO-key safeStorage round-trip, stdio MCP 10-tool round-trip).
- ✅ Cypress assistant e2e + provider hardening landed (#10).

- ✅ **Claude Code OAuth seam verified** — provider lists, request authenticates (429 rate-limit, not 401);
  direct OAuth probe also 429, so the token+headers are correct, the account is just usage-capped. Streaming path
  is identical to Anthropic (already proven).

Still open (in likely priority order for the work PC):
1. **Copilot live E2E — the last untested provider, now fully self-service.** The Linux box's
   `LLM_COPILOT_API_KEY` was an expired `gho_` token (401 even on `api.github.com/user`); the exchange CODE
   (token→short-lived Copilot bearer in `copilot.provider.js`) is verified correct and hardened. On the work PC:
   `node scripts/get-copilot-token.mjs` → start the server → drive the in-app panel (needs a Git-provider login,
   see item 2) or POST an SSE request to `/api/llm/complete` with `provider: copilot`, and confirm a tool_use
   round-trip. Also worth a real **Copilot CLI → TD MCP** session (the setup script wires
   `%USERPROFILE%\.copilot\mcp-config.json`).
2. **In-app assistant + local login = no auth (known gap).** `AUTH_SET_LOCAL` sets only `username`, no JWT, so
   the JWT-gated LLM proxy 401s for local-login users — the in-app chat panel only works after a Git-provider
   login. Either steer local users to the Copilot-CLI→MCP path (recommended, documented in scripts/README.md)
   or add a gated local-JWT mint endpoint (security-sensitive — confirm with the user before building).
   A UX nicety would be hiding/explaining the panel for local sessions instead of 401-ing on send.
3. User's **UI/UX backlog** — currently empty (everything raised so far shipped in PR #2); ask for new items.
4. Optional: terser-flow-label guidance nudge (only low-risk lever for label overlap; auto-layout is off the table).

### Environment notes (NOT product bugs)
- **Node 26 + `encryption.helper.js`** (Linux box ran v26.1.0): `Buffer.toString('ascii')` masks the high bit
  there, so the upstream helper's `'ascii'`-encoded JWT IV fails `verifyToken` with `bad decrypt`. Harmless on
  TD's supported Node LTS (18/20/22) — the Windows setup script installs `OpenJS.NodeJS.LTS` for this reason.
  If hardening upstream later: store the IV as `base64`/`hex`.
- **`gh` API auth lapsed repeatedly** on the Linux box (REST and/or GraphQL 401 while `gh auth status` looked
  fine). Workarounds used: `gh api repos/.../pulls` (REST) for PR create/merge, and once a `--ff-only` merge of
  the pushed branch + direct `git push origin main`. If it recurs: `gh auth refresh` / `gh auth login`.
- **Windows PowerShell 5.1**: keep `.ps1` files pure ASCII (see §0). Validate with pwsh's
  `[Parser]::ParseFile` when possible, but remember PS 5.1 is the real target.

## 7. How to run & test (verified)

**MCP server for an external client (primary flow, no AI key in TD):**
```bash
git clone https://github.com/RedTeamRaccoon/threat-raccoon.git && cd threat-raccoon
npm install            # installs td.server, td.vue AND shared/tmcore
npm run build:server   # -> td.server/dist/mcp/stdioEntry.js
```
Then point the client at `node /abs/threat-raccoon/td.server/dist/mcp/stdioEntry.js /abs/model.json`.
Client config (Copilot CLI / Claude Code / OpenCode / Codex): `docs/usage/ai-assistant.md`.

**Full app (to view models / use the in-app assistant):** `npm install && npm start`, then Open a model `.json`.
In-app assistant needs `LLM_ENABLED=true` + a provider key (server) or BYO (desktop).

**Test artifacts:** `/tmp/iot-camera-platform/Aperture_A2_Platform_Design_Spec.pdf` (10-page realistic IoT
camera platform spec — the control input for prompt testing). Sample generated models were in `/tmp/aperture_*`
(may be gone after reboot — regenerate by handing the PDF to any MCP client).

## 8. Verification commands

```bash
cd shared/tmcore && npm test                 # node --test -> 18
cd td.server && npm run test:unit            # mocha -> 531
cd td.vue && npm run test:unit               # jest -> 1543
cd td.vue && npm run build                   # webpack, must be clean
npm run markdown:lint                        # docs lint
```
Note: `td.server` mocha must be run via `npm run test:unit` (a bare `mocha` invocation hits a yargs/ESM error).

## 9. Conventions

- Surgical changes; match existing style; tests green before/after.
- Squash-merge to fork `main`; delete branch; no co-author trailer.
- `gh` CLI is authed as `RedTeamRaccoon`. Git user `RedTeamRaccoon`.

## 10. Session-end status (Linux box, 2026-06-10)

- Nothing active: no agent teams, no background agents, no open branches; `main` in sync with origin.
- All four in-app providers exercised: Anthropic ✅ live, OpenAI ✅ live, Claude Code ✅ auth verified
  (account was rate-capped at test time), Copilot ⏳ pending a fresh token on the work PC (§6.1).
- The user runs this session's continuation on the **Windows 11 work PC** — see §0.

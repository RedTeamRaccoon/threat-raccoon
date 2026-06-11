# Threat Raccoon — Session Handoff Brief

> Working continuity doc so this effort can be picked up cold. Updated 2026-06-10 (first Windows 11 work-PC
> session; previous update same day at the end of the Linux-box session).

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

The work-PC setup is DONE (install, build, `.env` with a working Copilot `ghu_` token) and the **live Copilot
E2E passed** (§6) — all four providers are now verified. Next up: the user-driven interactive Copilot CLI
session (§6.1) and the user's UI/UX backlog.

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
- ✅ **Copilot live E2E DONE (work PC, 2026-06-10) — all four providers now live-verified.** Two tiers, both
  PASS with a full tool_use round-trip (tool_use stop → tool_result → text answer):
  1. Direct harness against the BUILT adapter (`dist/llm/providers/copilot.provider.js`): the `.env` `ghu_`
     token exchanged for a Copilot bearer and streamed correct normalized events.
  2. Full stack through a RUNNING server: minted JWT → bearer middleware → `/api/llm/complete` SSE →
     `provider: copilot`; `/api/llm/providers` lists copilot as default. The JWT trick: Node 26's lossy
     `'ascii'` IV round-trip is avoided by minting with an IV whose bytes are all <= 0x7F — bearer auth then
     verifies fine even on Node 26 (the work PC runs Node 26.3.0; REAL logins still need Node LTS because
     `encryptPromise` uses a random IV).
  The harnesses were temporary scripts (`td.server/tmp-{copilot-live,mint-jwt,sse-e2e}.cjs`), deleted after the
  run — trivial to recreate from this description.
- ✅ **MCP stdio server verified on Windows + Node 26** — spawned `dist/mcp/stdioEntry.js <model.json>` exactly
  as `%USERPROFILE%\.copilot\mcp-config.json` does: initialize handshake OK, 10 tools listed, and
  `createDiagram`/`addElement`/`getModelSummary` round-trip against a real file. Gotchas for harness writers:
  the model FILE MUST EXIST (the file store does a plain `readFileSync`; `setup-windows.ps1` seeds a blank one,
  and `threat-model.json` is present at the repo root on this PC), tool names are camelCase, `addElement` takes
  `kind` + `position` (not `elementType`), and `createDiagram` returns `{"diagramId":0}` — id 0 is falsy.

Still open (in likely priority order for the work PC):
1. **Interactive Copilot CLI → TD MCP session (small).** Wiring is verified end-to-end (CLI 1.0.61 installed,
   `mcp-config.json` correct, stdio server proven above) — but an actual `copilot` chat session driving the
   tools must be run BY THE USER: spawning an autonomous `copilot -p ... --allow-all-tools` agent is
   permission-gated for Claude. One manual session ("build a model from this PDF") closes this out.
2. **Root `npm start` is broken on Windows (found this session).** `start:server`/`start:site` invoke
   `pm2 ... start 'command with args'` — cmd.exe does not strip single quotes, so pm2 sees `--exec` as its own
   option and exits 1 (`error: unknown option '--exec'`). The build stages before it are fine. The npm scripts
   themselves are NOT yet fixed (confirm with the user before touching them). Instead this session added
   **`scripts/start-threatdragon.ps1`** — the single-entry launcher for coworkers (user-requested): installs/
   builds only what is missing, junctions repo-root `dist` -> `td.vue/dist` (the server serves the SPA from
   root `dist` with `publicPath: '/public'`; git already ignores `dist`), live-verifies the Copilot token
   (re-mints via `get-copilot-token.mjs` device flow if dead), starts ONE process (`node index.js` in
   `td.server`, minimized window), polls `/healthz`, then opens the default browser. Idempotent: re-run while
   healthy just opens the browser. `setup-windows.ps1` now chains into it as its final step and its next-steps
   text no longer recommends `npm start`. Both scripts verified: pure ASCII, 0 parse errors under PS 5.1,
   and a live run (SPA index + `/public` assets + `/api/config` all 200 on :3000).
3. ~~In-app assistant + local login = no auth~~ **RESOLVED this session (user-approved).** New env flag
   `LLM_LOCAL_SESSION` (default **false**; security note in `docs/configure/configure.md`): when true,
   `GET /api/login/local` mints a real JWT (`provider: 'local'`, user `local-user`) and the client's
   `AUTH_SET_LOCAL` action fetches it when `/api/config` advertises `llmLocalSession` (desktop excluded via
   `is-electron`). LOGOUT now revokes whenever a refresh token exists. `setup-windows.ps1` enables the flag
   (single-user machines are its audience). Built on the **encryption.helper IV fix**: new ciphertexts carry
   `ivEncoding: 'base64'` + utf8 text (legacy `'ascii'` ones still decrypt), which also makes JWTs work on
   Node 26 — live-verified: local JWT (random IV) -> bearer decrypt -> Copilot SSE tool round-trip on this
   Node 26.3.0 box.
   **Also added (same session): PDF + vision + bilingual support for the in-app assistant** (user has Chinese-
   and English-speaking coworkers; design PDFs contain diagrams): `td.vue/src/service/assistant/pdfAttachments.js`
   (lazy-loaded pdfjs-dist@3.11.174) extracts per-page text (CJK via cMaps, copied to `<publicPath>/pdfjs/` by
   vue.config CopyWebpackPlugin) AND renders each page to a JPEG image attachment (20-page cap);
   `openaiTranslate.js` now maps normalized image blocks to OpenAI `image_url` parts (Copilot vision
   live-verified: red PNG -> "Red"); the in-app system prompt says to reply in the user's language; full
   `assistant` i18n section added to `zh.js`. NOTE: composer-level PDF routing is unit-tested via the service;
   a human should click-test attach-a-real-PDF once in the browser.
4. User's **UI/UX backlog** — two items raised while live-testing the assistant, both FIXED this session:
   - **Trust-boundary BOX labels now default to top-left.** Root cause: `attrs: { label: '<string>' }` (in
     `default-properties.js` AND tmcore's `buildBoundaryBox`) — a bare string under a selector REPLACES the
     shape's whole label attr object, so X6 fell back to centered. Fixed to `{ text }` objects everywhere,
     shape define cleaned up (`textAnchor: 'start'`, `refX: 12`, `refY: 8` — the old 'bottom' anchor was
     invalid), tmcore `setCellName` keeps objects on rename, and the `diagram.js` load normalizer repairs
     string labels in older models. Bonus fix: tmcore boundary CURVES wrote `attrs.label`, which edges never
     render — they now emit `labels: [{ position: 0.5, attrs: { label: { text } } }]` (same hand-built shape
     as flows), and the normalizer migrates old curve cells.
   - **Assistant composer input did not clear after send** (bootstrap-vue's `b-form-textarea` under
     `@vue/compat` does not reliably reflect programmatic value changes — jsdom even shows the OPPOSITE
     direction broken, so unit tests can't fully reproduce browser behavior). Replaced with a native
     `<textarea v-model>` (`.form-control` class keeps the styling) and the composer now clears the model
     BEFORE emitting `send`. New `assistantComposer.spec.js` covers emit/clear/guard paths.
   - **Model selector now lists LIVE provider models** (user asked "what happens when gpt-4o is retired?").
     All four adapters got `listModels()` (Copilot `GET /models` on api.githubcopilot.com filtered to
     chat-capable; OpenAI/Anthropic/Claude Code via their SDK `models.list()`, OpenAI filtered through a
     NON_CHAT regex), surfaced at JWT-gated `GET /api/llm/models/:provider` (5-min cache, BYO-key bypasses
     cache, upstream errors normalized like the stream path so credentials never leak). The panel fetches the
     list on mount/provider-switch and prefers it over the env-configured single model; the env
     `LLM_<PROVIDER>_MODEL` is just the preferred default — if it's not in the live list (retired), the panel
     auto-picks an available model; if the fetch fails it falls back to the env list (old behavior). Desktop
     (BYO key, no backend) still uses the static `providerCatalog.js` — extending live lists to the desktop
     relay is an open nicety.
   - **Assistant everywhere + MCP editor awareness (user-requested trio, built via two parallel subagents):**
     1. *Editor context -> MCP*: browser reports the open page/model/diagram (`editorContextReporter.js`, hooks
        in ThreatModel/DiagramEdit/MainDashboard; only when a JWT exists, never on desktop) to JWT-gated
        `PUT /api/editor/context` (`editorContext.helper.js` sanitizes + stamps `updatedAt`, persists
        best-effort to `%USERPROFILE%\.threat-dragon\editor-context.json`, override `TD_EDITOR_CONTEXT_FILE`).
        New MCP tool `getEditorContext` on BOTH transports: stdio reads the state file (separate process!),
        HTTP reads memory-then-file. Tool description teaches stale-context fallback to getModelSummary.
     2. *Model-overview chat pane*: AssistantPanel gained `mode="model"` — binding is `modelBinding.js`, which
        runs the REAL tmcore ops against a clone of `state.threatmodel.data` then dispatches new
        `THREATMODEL_DATA_REPLACED` (+ modified; stash untouched). tmcore's node-only `validate.js` is swapped
        for a browser shim (`tmcoreValidate.js` via webpack NormalModuleReplacementPlugin + jest mapper) so the
        ONE ops core truly runs in the browser. `MODEL_MODE_CONTEXT` system-prompt suffix tells the model it's
        on the overview page (bulk work, diagramId required, getModelSummary first). Panel mounted on
        ThreatModel.vue (robot toggle, lg 9/3 split); conversation persists across pages.
     3. *Welcome tile*: 'Create a Threat Model with AI assistance' (robot icon, FIRST tile, local+desktop
        providers, en+zh i18n) -> `/local/threatmodel/new?assistant=1` -> NewThreatModel routes to the model
        OVERVIEW page with the panel auto-opened (`?assistant` handled in ThreatModel.vue mounted).
     Gates after the merge: tmcore 18, td.server mocha 585, td.vue jest 143 suites / 1567 tests, all green.
     Desktop nicety still open: desktop's in-app stdio MCP could surface editor context from renderer state.
   - **Placement safety net + concrete spacing guidance (tmcore):** elements added without a position now land
     on the next free grid slot (220x160) instead of stacking at the origin, and an explicit position dropped
     on top of an existing component is nudged diagonally until clear — local collision avoidance only,
     existing elements are never moved (algorithmic auto-layout remains deliberately rejected). The layout
     guidance now gives models a concrete grid recipe and a 60px trust-boundary padding rule. tmcore tests now
     **20**. Because this lives in the shared ops core, it benefits ALL bindings: in-app diagram mode, model
     mode, and external MCP clients.
   - **Long PDFs keep their text (images cap at 20 pages, text flows to a 250KB budget):** the first-20-pages
     cap dropped most of a long spec's TEXT (a real 445-page design doc lost 95%). Text extraction now
     continues past the image-page cap until a 250KB budget is spent; page images (the token-expensive part)
     still cap at 20. The truncation note (in-chat warning and in the attached text itself) states exactly how
     many pages of text and images were included, in en and zh. User's real corpus: mostly Chinese PDFs —
     master spec 445 pages, section docs 8-41 pages; standing advice stands that for very long specs the
     focused section PDFs are the better attachment.
5. Ask for further UI/UX items.
6. Optional: terser-flow-label guidance nudge (only low-risk lever for label overlap; auto-layout is off the table).

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
td.server test-runner notes (2026-06-11):

- The official td.server runner is **mocha** (591 passing). Do NOT run `npx jest` in td.server: jest resolves
  and runs the specs but skips the mocha root hooks in `test/test-setup.spec.js` (sinon-chai/chai-as-promised
  registration), so ~39 suites fail with `Invalid Chai property: calledWith` — a harness artifact, not real
  breakage.
- mocha was upgraded 10 -> 11 and nyc 15 -> 17: the old versions bundle yargs 16, whose extensionless
  `yargs/yargs` file Node 26 parses as ESM and crashes on. The old "bare mocha hits a yargs/ESM error" note
  is obsolete.
- `npm test`'s `pretest` used to run `eslint src --fix` (mutating). `lint` is now non-mutating, with the fix
  behaviour moved to an explicit `lint:fix`. The repo-wide `linebreak-style` eslint rule (eslint.shared.js)
  is now off: git `core.autocrlf` manages line endings, and the rule made every Windows checkout fail lint
  (4k+ CRLF errors) and made any `--fix` rewrite line endings repo-wide.

## 9. Conventions

- Surgical changes; match existing style; tests green before/after.
- Squash-merge to fork `main`; delete branch; no co-author trailer.
- `gh` CLI is authed as `RedTeamRaccoon`. Git user `RedTeamRaccoon`.

## 10. Session-end status (Windows 11 work PC, 2026-06-10)

- All four in-app providers now live-verified: Anthropic ✅, OpenAI ✅, Claude Code ✅ (auth seam; account was
  rate-capped at test time), **Copilot ✅ (this session — adapter direct AND full server SSE path, see §6)**.
- MCP stdio server verified on Windows + Node 26; Copilot CLI 1.0.61 wired via `mcp-config.json` and
  `threat-model.json` seeded — only an interactive `copilot` session remains (user-driven, §6.1).
- Work-PC environment: Node **26.3.0** (not LTS — real Git-provider logins will hit the `bad decrypt` JWT issue,
  §"Environment notes"; install `OpenJS.NodeJS.LTS` if needed), repo at `%USERPROFILE%\tools\threat-raccoon`,
  `.env` carries a working Copilot `ghu_` token, `LLM_PROVIDER=copilot`.
- Found: root `npm start` exits 1 on Windows at the pm2 stage (§6.2). New single-entry launcher
  `scripts/start-threatdragon.ps1` added (and chained into `setup-windows.ps1`); a launched server may still
  be running on :3000 (minimized node window) — it serves the REBUILT app including all features below.
- **Features built late in the session (user-approved, see §6.3): local-session assistant auth
  (`LLM_LOCAL_SESSION`) + encryption IV fix, and PDF/vision/bilingual attachments.** Gates after:
  td.server mocha **554**, td.vue jest **1526** (140 suites, 0 fail), both builds clean, eslint clean,
  markdown lint clean. Live E2E on the running server: config flag -> `/api/login/local` -> Copilot tool
  round-trip -> vision ("Red") all PASS. (Jest total differs from the older 1543/1545 notes in this doc;
  suites are fully green — treat PR CI as the arbiter.)
- All work is now **committed locally on `main`** (13 commits ahead of origin) — **push still pending user
  action**. Late-session batch also included the assistant UX polish (one chip per PDF attachment, working
  indicators while extracting/sending) and a live-verified `getEditorContext` round-trip (browser ->
  `PUT /api/editor/context` -> MCP tool). Final gates: tmcore **20**, td.server mocha **585**, td.vue jest
  **143 suites (1573+ tests)**, all green; vue production build clean. `git status` is clean of EOL noise: an
  `eslint --fix` pass had rewritten line endings repo-wide; unintended files were restored from the index —
  do NOT re-run `eslint --fix` repo-wide.
- User's `.env` now has `LLM_LOCAL_SESSION=true` and a working Copilot `ghu_` token; `threat-model.json`
  seeded at repo root; Copilot CLI MCP wiring verified (interactive session still pending, §6.1).

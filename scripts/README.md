# Scripts

Helper scripts for local maintainer convenience; they are not part of the deployed application.

| Script | Purpose |
| ------ | ------- |
| [`setup-windows.ps1`](./setup-windows.ps1) | One-shot Windows 11 setup: prerequisites + build + Copilot token + Copilot-CLI wiring + first launch |
| [`start-threatdragon.ps1`](./start-threatdragon.ps1) | Daily driver: verify token, build if needed, start Threat Dragon, open the browser |
| [`stop-threatdragon.ps1`](./stop-threatdragon.ps1) | Stop the running Threat Dragon instance, whichever terminal started it |
| [`setup-providers.ps1`](./setup-providers.ps1) | Interactively configure the in-app AI assistant's LLM providers (Copilot, Anthropic, OpenAI, Claude Code) and set the default provider + model in `.env` |
| [`get-copilot-token.mjs`](./get-copilot-token.mjs) | Generate a GitHub Copilot token (device flow) and store it in `.env` |
| [`td-build-desktop-linux-appimage.sh`](./td-build-desktop-linux-appimage.sh) | Build Linux AppImage (amd64) |
| [`td-trivy-check.sh`](./td-trivy-check.sh) | Run local Trivy scan (requires docker) |
| [`td-update-node-version.sh`](./td-update-node-version.sh) | Update Node version in docker and gh actions |

## GitHub Copilot onboarding

For teams whose only approved AI provider is **GitHub Copilot**.

### `setup-windows.ps1` — clean-machine Windows 11 setup

PowerShell blocks scripts by default, so from the repo folder run this once for the session, then the script:

```powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
.\scripts\setup-windows.ps1
```

It installs **Node.js LTS, Git and the GitHub Copilot CLI** with `winget` (refreshing `PATH` so they're usable
immediately), runs `npm install` and builds the MCP server, creates `.env` from `example.env`, runs the Copilot
token generator below, adds a `threat-dragon` server to `%USERPROFILE%\.copilot\mcp-config.json` (preserving
any existing MCP servers), and hands off to `start-threatdragon.ps1` so you end the setup with Threat Dragon
open in your browser. Safe to re-run. Use **Node LTS** — some bleeding-edge Node releases change
`Buffer` `'ascii'` behaviour, which the upstream auth helper relies on.

### `start-threatdragon.ps1` — start everything with one command

```powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass   # once per window
.\scripts\start-threatdragon.ps1
```

The day-to-day entry point (also the last step of `setup-windows.ps1`). It installs dependencies and builds the
app **only if missing**, verifies the `.env` Copilot token against GitHub and re-mints it (device flow) if it
has expired, starts a single server process that serves both the web app and the API on
[http://localhost:3000](http://localhost:3000), waits for the health check, and opens your default browser.
Re-running while Threat Dragon is already up just opens the browser. To stop it, close the minimized `node`
window (or use the `Stop-Process` command it prints). Use this instead of `npm start` on Windows — the npm
`start` script currently fails under `cmd.exe`.

### `setup-providers.ps1` — configure the in-app assistant's LLM providers

```powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass   # once per window
.\scripts\setup-providers.ps1
```

Run during `setup-windows.ps1` (step 4) or standalone any time you want to add or replace a provider. It presents
a multi-select menu of **GitHub Copilot, Anthropic (Claude), OpenAI (GPT) and Claude Code (OAuth)**. Picking any
non-Copilot provider triggers a confidential-data warning and a confirmation prompt, because on managed/work
machines Copilot is typically the only provider approved for proprietary documents (API providers send the
attached document text and images to that vendor). For each chosen provider it assists with the credential —
Copilot runs the device-flow token generator; the others open the vendor's key page and read the key/token
**hidden** (`Read-Host -AsSecureString`, never echoed) — and upserts the matching `LLM_*` key into `.env`. It then
sets `LLM_PROVIDER` to your chosen default, lets you pick that provider's `LLM_*_MODEL` (Enter accepts the
`example.env` default; Claude Code defaults to `claude-haiku-4-5` since Opus is rate-limited on subscription
tokens), and ensures `LLM_ENABLED=true`. A server restart (`stop-threatdragon.ps1` then `start-threatdragon.ps1`)
is required for the new `.env` values to take effect.

### `get-copilot-token.mjs` — generate + store a Copilot token (any OS)

```bash
node scripts/get-copilot-token.mjs           # writes ./.env
node scripts/get-copilot-token.mjs --print   # also echo the token
```

Runs the GitHub device flow against the Copilot OAuth app, displays a one-time code to approve in the browser,
verifies Copilot entitlement, and upserts `LLM_COPILOT_API_KEY` / `LLM_ENABLED=true` / `LLM_PROVIDER=copilot`
into `.env`. (A classic Personal Access Token will **not** work — only a Copilot-entitled OAuth token can be
exchanged for the Copilot bearer.)

### Two ways to use Copilot — both keep data on Copilot only

- **GitHub Copilot CLI → Threat Dragon MCP** (recommended; no Threat Dragon login). After setup, run `copilot`
  and ask it to build a model from your design doc; it drives Threat Dragon's tools and writes the model JSON,
  which you open in Threat Dragon to view. Copilot CLI uses its own subscription auth, so no `.env` key is needed
  for this path.
- **In-app assistant** (chat panel inside Threat Dragon) uses the `.env` Copilot key. The assistant is gated
  behind a login; `setup-windows.ps1` sets `LLM_LOCAL_SESSION=true` so the **local (no-login) session works
  out of the box on a single-user machine** (leave it `false` on shared or public servers — anyone reaching
  the server could spend the configured LLM key). Attach design docs directly: PDFs are read with CJK-capable
  text extraction, and every page is also shown to the model as an image so it can read the diagrams.

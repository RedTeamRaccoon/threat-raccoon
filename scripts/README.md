# Scripts

Helper scripts for local maintainer convenience; they are not part of the deployed application.

| Script | Purpose |
| ------ | ------- |
| [`setup-windows.ps1`](./setup-windows.ps1) | One-shot Windows 11 setup: prerequisites + build + Copilot token + Copilot-CLI wiring |
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
token generator below, and adds a `threat-dragon` server to `%USERPROFILE%\.copilot\mcp-config.json` (preserving
any existing MCP servers). Safe to re-run. Use **Node LTS** — some bleeding-edge Node releases change
`Buffer` `'ascii'` behaviour, which the upstream auth helper relies on.

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
- **In-app assistant** (chat panel inside Threat Dragon) uses the `.env` Copilot key. Note: the in-app assistant
  is gated behind a login, and the **local (no-login) session does not authenticate to the assistant** — use a
  configured Git provider login for the in-app panel, or prefer the MCP path above.

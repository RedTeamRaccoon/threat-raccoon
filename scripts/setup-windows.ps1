<#
.SYNOPSIS
  One-shot Windows 11 setup for Threat Dragon with GitHub Copilot.

.DESCRIPTION
  Assumes a clean machine. Installs prerequisites with winget (Node.js, Git,
  GitHub Copilot CLI), installs and builds Threat Dragon, creates a .env,
  generates a GitHub Copilot token for the in-app assistant, and wires the
  GitHub Copilot CLI to Threat Dragon's local MCP server. Safe to re-run.

.NOTES
  PowerShell blocks scripts by default. Run this first (one time, this window):
      Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
  Then:
      .\scripts\setup-windows.ps1
#>

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot

function Write-Step($msg)  { Write-Host "`n==> $msg" -ForegroundColor Cyan }
function Write-Ok($msg)    { Write-Host "    $msg" -ForegroundColor Green }
function Write-Warn2($msg) { Write-Host "    $msg" -ForegroundColor Yellow }

function Update-Path {
    # winget installs land in the machine/user PATH but not the current process;
    # re-read both so freshly-installed tools are callable without a new shell.
    $machine = [System.Environment]::GetEnvironmentVariable('Path', 'Machine')
    $user    = [System.Environment]::GetEnvironmentVariable('Path', 'User')
    $env:Path = "$machine;$user"
}

function Ensure-WingetPackage($id, $exe, $friendly) {
    if (Get-Command $exe -ErrorAction SilentlyContinue) {
        Write-Ok "$friendly already installed."
        return $true
    }
    Write-Step "Installing $friendly ($id) via winget..."
    try {
        # Out-Host keeps winget's output on the console and OUT of this function's
        # return value (which callers read as a boolean).
        winget install -e --id $id --accept-source-agreements --accept-package-agreements --silent | Out-Host
    } catch {
        Write-Warn2 "winget failed for $id : $($_.Exception.Message)"
    }
    Update-Path
    if (Get-Command $exe -ErrorAction SilentlyContinue) {
        Write-Ok "$friendly installed."
        return $true
    }
    Write-Warn2 "$friendly ($exe) still not on PATH. You may need to open a new terminal and re-run."
    return $false
}

Write-Host "Threat Dragon + GitHub Copilot - Windows 11 setup" -ForegroundColor White
Write-Host "Repo: $repoRoot"

# 1. Prerequisites ----------------------------------------------------------
if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
    throw "winget is required (ships with Windows 11). Install 'App Installer' from the Microsoft Store, then re-run."
}
Ensure-WingetPackage 'OpenJS.NodeJS.LTS' 'node' 'Node.js (LTS)' | Out-Null
Ensure-WingetPackage 'Git.Git' 'git' 'Git' | Out-Null
$haveCopilotCli = Ensure-WingetPackage 'GitHub.Copilot' 'copilot' 'GitHub Copilot CLI'

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    throw "Node.js is not available even after install. Open a new terminal and re-run this script."
}
Write-Ok ("node " + (node --version) + " / npm " + (npm --version))

# 2. Install + build Threat Dragon -----------------------------------------
Write-Step "Installing dependencies (td.server, td.vue, shared/tmcore)..."
Push-Location $repoRoot
try {
    npm install
    Write-Ok "Dependencies installed."

    Write-Step "Building the Threat Dragon MCP server..."
    npm run build:server
    Write-Ok "MCP server built -> td.server\dist\mcp\stdioEntry.js"

    # 3. .env --------------------------------------------------------------
    $envPath = Join-Path $repoRoot '.env'
    if (-not (Test-Path $envPath)) {
        Copy-Item (Join-Path $repoRoot 'example.env') $envPath
        Write-Ok "Created .env from example.env"
    } else {
        Write-Ok ".env already present (left as-is)."
    }

    # 4. Copilot token for the in-app assistant ----------------------------
    Write-Step "Generating a GitHub Copilot token for the Threat Dragon assistant..."
    Write-Warn2 "A browser code will be shown - approve it to link your Copilot subscription."
    node (Join-Path $repoRoot 'scripts\get-copilot-token.mjs')

    # Let the local (no-login) session use the in-app assistant. This setup
    # targets a single-user machine; on a shared/public server leave it false
    # (anyone reaching the server could use the configured LLM key).
    $envRaw = Get-Content $envPath -Raw
    if ($envRaw -match 'LLM_LOCAL_SESSION=') {
        $envRaw = $envRaw -replace 'LLM_LOCAL_SESSION=\S*', 'LLM_LOCAL_SESSION=true'
        Set-Content -Path $envPath -Value $envRaw -Encoding UTF8 -NoNewline
    } else {
        Add-Content -Path $envPath -Value "`nLLM_LOCAL_SESSION=true" -Encoding UTF8
    }
    Write-Ok "Enabled the in-app assistant for the local session (LLM_LOCAL_SESSION=true)."

    # 5. Wire the Copilot CLI to Threat Dragon's MCP server ----------------
    $modelPath = "$repoRoot\threat-model.json"
    if (-not (Test-Path $modelPath)) {
        $blank = '{"version":"2.0","summary":{"title":"My Threat Model","owner":"","description":"","id":0},"detail":{"contributors":[],"diagrams":[],"diagramTop":0,"reviewer":"","threatTop":0}}'
        Set-Content -Path $modelPath -Value $blank -Encoding UTF8
        Write-Ok "Created a blank model at $modelPath"
    }
    if ($haveCopilotCli) {
        Write-Step "Registering Threat Dragon with the GitHub Copilot CLI..."
        $copilotHome = Join-Path $env:USERPROFILE '.copilot'
        New-Item -ItemType Directory -Force -Path $copilotHome | Out-Null
        $mcpConfigPath = Join-Path $copilotHome 'mcp-config.json'
        $entry = @{
            type    = 'local'
            command = 'node'
            args    = @("$repoRoot\td.server\dist\mcp\stdioEntry.js", $modelPath)
            env     = @{}
            tools   = @('*')
        }
        if (Test-Path $mcpConfigPath) {
            $cfg = Get-Content $mcpConfigPath -Raw | ConvertFrom-Json
        } else {
            $cfg = [PSCustomObject]@{ mcpServers = [PSCustomObject]@{} }
        }
        if (-not $cfg.mcpServers) { $cfg | Add-Member -NotePropertyName mcpServers -NotePropertyValue ([PSCustomObject]@{}) -Force }
        $cfg.mcpServers | Add-Member -NotePropertyName 'threat-dragon' -NotePropertyValue $entry -Force
        $cfg | ConvertTo-Json -Depth 10 | Set-Content -Path $mcpConfigPath -Encoding UTF8
        Write-Ok "Wrote $mcpConfigPath (server 'threat-dragon')"
    } else {
        Write-Warn2 "GitHub Copilot CLI not found - skipped MCP wiring. Install it, then re-run, or add the server manually (see docs/usage/ai-assistant.md)."
    }
}
finally {
    Pop-Location
}

# 6. Next steps -------------------------------------------------------------
Write-Step "Setup complete. You're off to the races."
Write-Host @"

  Two ways to use GitHub Copilot with Threat Dragon - both keep data on Copilot only:

  A) GitHub Copilot CLI -> Threat Dragon MCP (recommended, no Threat Dragon login):
       copilot
       > "Read this design doc and build the threat model"   (it drives Threat Dragon's tools)
     The model is written to: $modelPath
     Open that file in Threat Dragon to view it.

  B) The Threat Dragon app (view/edit models; in-app chat panel needs a Git provider login):
       .\scripts\start-threatdragon.ps1
     One command: builds anything missing, checks the token, starts the app and
     opens your browser. (Avoid 'npm start' on Windows - it is currently broken.)

  Your Copilot token is stored in .env (LLM_COPILOT_API_KEY). Re-run any time:
       node scripts\get-copilot-token.mjs

"@ -ForegroundColor White

# 7. Launch ------------------------------------------------------------------
Write-Step "Starting Threat Dragon..."
& (Join-Path $repoRoot 'scripts\start-threatdragon.ps1')

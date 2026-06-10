<#
.SYNOPSIS
  One-command Threat Dragon launcher for Windows.

.DESCRIPTION
  Single entry point to get Threat Dragon running locally:
    - installs dependencies and builds the app if needed (first run only)
    - verifies the GitHub Copilot token in .env (re-mints it if missing/expired)
    - starts ONE server process that serves both the API and the web app
    - waits until the platform is healthy, then opens your default browser

  Safe to re-run: if Threat Dragon is already running it just opens the browser.

.NOTES
  PowerShell blocks scripts by default. Run this first (one time, this window):
      Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
  Then:
      .\scripts\start-threatdragon.ps1

  To stop Threat Dragon, close the minimized "node" window (or use the
  Stop-Process command printed at the end).
#>

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot

# api.github.com requires TLS 1.2; Windows PowerShell 5.1 may not enable it
[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12

function Write-Step($msg)  { Write-Host "`n==> $msg" -ForegroundColor Cyan }
function Write-Ok($msg)    { Write-Host "    $msg" -ForegroundColor Green }
function Write-Warn2($msg) { Write-Host "    $msg" -ForegroundColor Yellow }

$envPath = Join-Path $repoRoot '.env'

function Get-EnvValue($name) {
    if (-not (Test-Path $envPath)) { return $null }
    $match = Select-String -Path $envPath -Pattern ('^' + [regex]::Escape($name) + '=(.*)$') | Select-Object -First 1
    if ($match) { return $match.Matches[0].Groups[1].Value.Trim() }
    return $null
}

function Test-Healthy($baseUrl) {
    try {
        $resp = Invoke-WebRequest -Uri "$baseUrl/healthz" -UseBasicParsing -TimeoutSec 3
        return ($resp.StatusCode -eq 200)
    } catch {
        return $false
    }
}

function Test-CopilotToken($token) {
    # A raw GitHub token must exchange for a Copilot bearer; that exchange is
    # exactly what the server does, so it is the right liveness probe.
    if (-not $token) { return $false }
    if ($token -notmatch '^(gho_|ghu_|ghp_|ghs_|github_pat_)') {
        # not a GitHub token: assume it is a raw Copilot bearer and let the server use it
        return $true
    }
    try {
        $headers = @{ Authorization = "token $token"; 'User-Agent' = 'threat-dragon-start' }
        Invoke-RestMethod -Uri 'https://api.github.com/copilot_internal/v2/token' -Headers $headers -UseBasicParsing | Out-Null
        return $true
    } catch {
        return $false
    }
}

Write-Host "Threat Dragon - local start" -ForegroundColor White
Write-Host "Repo: $repoRoot"

# 1. Prerequisites -----------------------------------------------------------
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    throw "Node.js is not installed. Run .\scripts\setup-windows.ps1 first."
}

# 2. Install + build (skipped when already done) -----------------------------
Push-Location $repoRoot
try {
    if (-not (Test-Path (Join-Path $repoRoot 'node_modules'))) {
        Write-Step "Installing dependencies (first run, takes a few minutes)..."
        npm install
        if ($LASTEXITCODE -ne 0) { throw "npm install failed." }
        Write-Ok "Dependencies installed."
    }

    if (-not (Test-Path (Join-Path $repoRoot 'td.server\dist\app.js'))) {
        Write-Step "Building the Threat Dragon server..."
        npm run build:server
        if ($LASTEXITCODE -ne 0) { throw "Server build failed." }
        Write-Ok "Server built."
    }

    if (-not (Test-Path (Join-Path $repoRoot 'td.vue\dist\index.html'))) {
        Write-Step "Building the Threat Dragon web app (first run, takes a few minutes)..."
        npm run build:vue
        if ($LASTEXITCODE -ne 0) { throw "Web app build failed." }
        Write-Ok "Web app built."
    }
}
finally {
    Pop-Location
}

# The server serves the web app from <repo>\dist; the web app builds to
# td.vue\dist. A directory junction (no admin rights needed) joins the two.
$rootDist = Join-Path $repoRoot 'dist'
if (-not (Test-Path $rootDist)) {
    New-Item -ItemType Junction -Path $rootDist -Value (Join-Path $repoRoot 'td.vue\dist') | Out-Null
    Write-Ok "Linked $rootDist -> td.vue\dist"
}
if (-not (Test-Path (Join-Path $rootDist 'index.html'))) {
    throw "$rootDist exists but does not contain the built web app (index.html). Remove it and re-run."
}

# 3. .env + Copilot token ----------------------------------------------------
if (-not (Test-Path $envPath)) {
    Copy-Item (Join-Path $repoRoot 'example.env') $envPath
    Write-Ok "Created .env from example.env"
}

Write-Step "Verifying the GitHub Copilot token..."
$copilotKey = Get-EnvValue 'LLM_COPILOT_API_KEY'
if (Test-CopilotToken $copilotKey) {
    Write-Ok "Copilot token is valid."
} else {
    Write-Warn2 "Copilot token is missing or expired - generating a new one."
    Write-Warn2 "A browser code will be shown; approve it to link your Copilot subscription."
    node (Join-Path $repoRoot 'scripts\get-copilot-token.mjs')
    $copilotKey = Get-EnvValue 'LLM_COPILOT_API_KEY'
    if (Test-CopilotToken $copilotKey) {
        Write-Ok "Copilot token is valid."
    } else {
        Write-Warn2 "Still no valid Copilot token. Threat Dragon will run, but AI features stay off until you run: node scripts\get-copilot-token.mjs"
    }
}

# A blank model file so Copilot CLI MCP sessions have something to write to
$modelPath = Join-Path $repoRoot 'threat-model.json'
if (-not (Test-Path $modelPath)) {
    $blank = '{"version":"2.0","summary":{"title":"My Threat Model","owner":"","description":"","id":0},"detail":{"contributors":[],"diagrams":[],"diagramTop":0,"reviewer":"","threatTop":0}}'
    Set-Content -Path $modelPath -Value $blank -Encoding UTF8
    Write-Ok "Created a blank model at $modelPath"
}

# 4. Start the server --------------------------------------------------------
$port = Get-EnvValue 'PORT'
if (-not $port) { $port = '3000' }
$url = "http://localhost:$port"

if (Test-Healthy $url) {
    Write-Step "Threat Dragon is already running at $url - opening your browser."
    Start-Process $url
    exit 0
}

Write-Step "Starting Threat Dragon on $url ..."
$serverProc = Start-Process -FilePath 'node' -ArgumentList 'index.js' `
    -WorkingDirectory (Join-Path $repoRoot 'td.server') `
    -WindowStyle Minimized -PassThru

$healthy = $false
$deadline = (Get-Date).AddSeconds(60)
while ((Get-Date) -lt $deadline) {
    Start-Sleep -Seconds 2
    if ($serverProc.HasExited) { break }
    if (Test-Healthy $url) { $healthy = $true; break }
}

if (-not $healthy) {
    if (-not $serverProc.HasExited) { Stop-Process -Id $serverProc.Id -Force -ErrorAction SilentlyContinue }
    throw "Threat Dragon did not become healthy at $url. Check for port conflicts on $port, or run 'node index.js' inside td.server to see the error."
}

Write-Ok "Threat Dragon is healthy."
Start-Process $url

Write-Host @"

  Threat Dragon is running:  $url   (server PID $($serverProc.Id), minimized node window)
  Pick "Local Session" to open or create models - e.g. $modelPath

  To build a threat model from a design doc with AI (recommended):
      copilot
      > "Read <your design doc> and build the threat model"
  Copilot writes to $modelPath - open it in Threat Dragon to watch/edit.

  To stop Threat Dragon:  Stop-Process -Id $($serverProc.Id)   (or close the node window)

"@ -ForegroundColor White

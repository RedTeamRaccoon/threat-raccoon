<#
.SYNOPSIS
  Stops a running local Threat Dragon instance.

.DESCRIPTION
  Finds the process listening on Threat Dragon's port (PORT from .env, default
  3000) and stops it, regardless of which terminal or script started it. Only
  node processes are stopped; anything else on the port is reported instead.

.NOTES
  Run from the repo folder:
      Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass   # once per window
      .\scripts\stop-threatdragon.ps1
#>

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot

$port = '3000'
$envPath = Join-Path $repoRoot '.env'
if (Test-Path $envPath) {
    $match = Select-String -Path $envPath -Pattern '^PORT=(.*)$' | Select-Object -First 1
    if ($match) { $port = $match.Matches[0].Groups[1].Value.Trim() }
}

$conns = Get-NetTCPConnection -LocalPort ([int]$port) -State Listen -ErrorAction SilentlyContinue
if (-not $conns) {
    Write-Host "Threat Dragon is not running (nothing is listening on port $port)." -ForegroundColor Yellow
    exit 0
}

$stopped = $false
foreach ($processId in ($conns | Select-Object -ExpandProperty OwningProcess -Unique)) {
    $proc = Get-Process -Id $processId -ErrorAction SilentlyContinue
    if (-not $proc) { continue }
    if ($proc.ProcessName -eq 'node') {
        Stop-Process -Id $processId -Force -Confirm:$false
        Write-Host "Stopped Threat Dragon (node, PID $processId, port $port)." -ForegroundColor Green
        $stopped = $true
    } else {
        Write-Host "Port $port is held by '$($proc.ProcessName)' (PID $processId), which does not look like Threat Dragon - left it alone." -ForegroundColor Yellow
    }
}

if (-not $stopped) {
    exit 1
}

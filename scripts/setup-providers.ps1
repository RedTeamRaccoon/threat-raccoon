<#
.SYNOPSIS
  Interactively configure the Threat Dragon in-app AI assistant's LLM providers.

.DESCRIPTION
  Lets you pick one or more LLM providers (GitHub Copilot, Anthropic, OpenAI,
  Claude Code OAuth), assists with obtaining each credential, writes the keys to
  .env, then sets the default provider and model. Safe to run standalone at any
  time - a returning user can re-run it to add or replace a provider. All edits
  go to .env (created from example.env when missing). A server restart is needed
  to pick up the changes.

.NOTES
  PowerShell blocks scripts by default. Run this first (one time, this window):
      Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
  Then:
      .\scripts\setup-providers.ps1
#>

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot

function Write-Step($msg)  { Write-Host "`n==> $msg" -ForegroundColor Cyan }
function Write-Ok($msg)    { Write-Host "    $msg" -ForegroundColor Green }
function Write-Warn2($msg) { Write-Host "    $msg" -ForegroundColor Yellow }

# .env upsert: replace an existing '^NAME=...' line or append 'NAME=value'.
# Operates on the file as an array of lines, preserves everything else, writes
# UTF8. Handles the file having or lacking a trailing newline.
function Set-EnvVar($path, $name, $value) {
    if (Test-Path $path) {
        $lines = @(Get-Content -Path $path -Encoding UTF8)
    } else {
        $lines = @()
    }
    $pattern = '^' + [regex]::Escape($name) + '='
    $found = $false
    for ($i = 0; $i -lt $lines.Count; $i++) {
        if ($lines[$i] -match $pattern) {
            $lines[$i] = "$name=$value"
            $found = $true
            break
        }
    }
    if (-not $found) {
        $lines += "$name=$value"
    }
    Set-Content -Path $path -Value $lines -Encoding UTF8
}

# Read a secret without echoing it, returning the plain text (PS 5.1 compatible).
function Read-Secret($prompt) {
    $secure = Read-Host -Prompt $prompt -AsSecureString
    $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
    try {
        $plain = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
    } finally {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
    }
    if ($null -eq $plain) { return '' }
    return $plain.Trim()
}

Write-Host "Threat Dragon - AI assistant provider setup" -ForegroundColor White
Write-Host "Repo: $repoRoot"

# 1. Locate / create .env ---------------------------------------------------
$envPath = Join-Path $repoRoot '.env'
if (-not (Test-Path $envPath)) {
    Copy-Item (Join-Path $repoRoot 'example.env') $envPath
    Write-Ok "Created .env from example.env"
} else {
    Write-Ok ".env already present (editing in place)."
}

# Provider catalogue. Index in the menu maps to these by position.
$providers = @(
    [PSCustomObject]@{ Key = 'copilot';    Name = 'GitHub Copilot';     Desc = 'recommended; works with your Copilot subscription; the only provider approved for confidential data on managed/work machines' }
    [PSCustomObject]@{ Key = 'anthropic';  Name = 'Anthropic (Claude)'; Desc = 'pay-as-you-go API key' }
    [PSCustomObject]@{ Key = 'openai';     Name = 'OpenAI (GPT)';       Desc = 'pay-as-you-go API key' }
    [PSCustomObject]@{ Key = 'claudecode'; Name = 'Claude Code (OAuth)';Desc = 'uses a Claude subscription token; subscription models are rate-limited, Haiku is the reliable pick' }
)

# 2. Multi-select menu ------------------------------------------------------
Write-Step "Choose which AI providers to configure"
Write-Host ""
for ($i = 0; $i -lt $providers.Count; $i++) {
    Write-Host ("    {0}) {1} - {2}" -f ($i + 1), $providers[$i].Name, $providers[$i].Desc)
}
Write-Host ""
Write-Host "    Enter the numbers you want, separated by commas or spaces (e.g. 1,3)." -ForegroundColor White
Write-Host "    Press Enter on an empty line to skip provider configuration." -ForegroundColor White

$selected = @()
while ($true) {
    $raw = Read-Host -Prompt 'Selection'
    if ([string]::IsNullOrWhiteSpace($raw)) {
        Write-Warn2 "No providers selected - nothing to configure. Exiting."
        return
    }
    $tokens = $raw -split '[,\s]+' | Where-Object { $_ -ne '' }
    $nums = @()
    $bad = $false
    foreach ($t in $tokens) {
        $n = 0
        if ([int]::TryParse($t, [ref]$n) -and $n -ge 1 -and $n -le $providers.Count) {
            if ($nums -notcontains $n) { $nums += $n }
        } else {
            $bad = $true
        }
    }
    if ($bad -or $nums.Count -eq 0) {
        Write-Warn2 "Please enter only numbers between 1 and $($providers.Count) (e.g. 1,3)."
        continue
    }
    $selected = $nums | Sort-Object | ForEach-Object { $providers[$_ - 1] }
    break
}

# 3. Confidential-data warning for any non-Copilot selection ----------------
$hasCopilot    = @($selected | Where-Object { $_.Key -eq 'copilot' }).Count -gt 0
$nonCopilot    = @($selected | Where-Object { $_.Key -ne 'copilot' })
if ($nonCopilot.Count -gt 0) {
    Write-Host ""
    Write-Warn2 "CONFIDENTIAL DATA WARNING"
    Write-Warn2 "On managed / work machines GitHub Copilot is typically the ONLY provider"
    Write-Warn2 "approved for confidential or proprietary documents. Anthropic, OpenAI and"
    Write-Warn2 "Claude Code send the attached document text and images to that vendor."
    Write-Warn2 "Only continue with non-Copilot providers if you are cleared to do so."
    Write-Host ""
    $ans = Read-Host -Prompt 'Continue with the non-Copilot providers? (y/N)'
    if ($ans -notmatch '^(y|yes)$') {
        Write-Warn2 "Dropping the non-Copilot providers."
        $selected = @($selected | Where-Object { $_.Key -eq 'copilot' })
        if ($selected.Count -eq 0) {
            Write-Warn2 "Nothing left to configure. Exiting."
            return
        }
    }
}

# 4. Per-provider setup -----------------------------------------------------
$configured = @()   # keys that were successfully set up
foreach ($p in $selected) {
    switch ($p.Key) {
        'copilot' {
            Write-Step "GitHub Copilot"
            Write-Host "    Copilot uses the GitHub device flow: a one-time code is shown, you" -ForegroundColor White
            Write-Host "    approve it in your browser, and the token is written to .env for you." -ForegroundColor White
            Write-Warn2 "A browser code will be shown - approve it to link your Copilot subscription."
            try {
                node (Join-Path $repoRoot 'scripts\get-copilot-token.mjs')
                if ($LASTEXITCODE -ne 0) { throw "token generator exited with code $LASTEXITCODE" }
                Write-Ok "Copilot token written to .env (LLM_COPILOT_API_KEY)."
                $configured += 'copilot'
            } catch {
                Write-Warn2 "Copilot token setup failed: $($_.Exception.Message)"
                Write-Warn2 "You can retry later with: node scripts\get-copilot-token.mjs"
            }
        }
        'anthropic' {
            Write-Step "Anthropic (Claude)"
            Write-Host "    Opening the Anthropic API keys page in your browser." -ForegroundColor White
            Write-Host "    Create a key there, then paste it below (input is hidden)." -ForegroundColor White
            try { Start-Process 'https://console.anthropic.com/settings/keys' } catch { Write-Warn2 "Could not open the browser - go to https://console.anthropic.com/settings/keys" }
            $key = Read-Secret 'Anthropic API key'
            if ([string]::IsNullOrWhiteSpace($key)) {
                Write-Warn2 "No key entered - skipping Anthropic."
            } else {
                if ($key -notmatch '^sk-ant-') { Write-Warn2 "That key does not start with 'sk-ant-' - saving it anyway." }
                Set-EnvVar $envPath 'LLM_ANTHROPIC_API_KEY' $key
                Write-Ok "Saved LLM_ANTHROPIC_API_KEY."
                $configured += 'anthropic'
            }
        }
        'openai' {
            Write-Step "OpenAI (GPT)"
            Write-Host "    Opening the OpenAI API keys page in your browser." -ForegroundColor White
            Write-Host "    Create a key there, then paste it below (input is hidden)." -ForegroundColor White
            try { Start-Process 'https://platform.openai.com/api-keys' } catch { Write-Warn2 "Could not open the browser - go to https://platform.openai.com/api-keys" }
            $key = Read-Secret 'OpenAI API key'
            if ([string]::IsNullOrWhiteSpace($key)) {
                Write-Warn2 "No key entered - skipping OpenAI."
            } else {
                if ($key -notmatch '^sk-') { Write-Warn2 "That key does not start with 'sk-' - saving it anyway." }
                Set-EnvVar $envPath 'LLM_OPENAI_API_KEY' $key
                Write-Ok "Saved LLM_OPENAI_API_KEY."
                $configured += 'openai'
            }
        }
        'claudecode' {
            Write-Step "Claude Code (OAuth)"
            Write-Host "    This token comes from a Claude Code / OAuth login (a Claude subscription)." -ForegroundColor White
            Write-Host "    It is NOT an x-api-key value. Opening https://claude.ai/ in your browser." -ForegroundColor White
            Write-Host "    Paste the OAuth token below (input is hidden)." -ForegroundColor White
            try { Start-Process 'https://claude.ai/' } catch { Write-Warn2 "Could not open the browser - go to https://claude.ai/" }
            $key = Read-Secret 'Claude Code OAuth token'
            if ([string]::IsNullOrWhiteSpace($key)) {
                Write-Warn2 "No token entered - skipping Claude Code."
            } else {
                Set-EnvVar $envPath 'LLM_CLAUDECODE_OAUTH_TOKEN' $key
                Write-Ok "Saved LLM_CLAUDECODE_OAUTH_TOKEN."
                Write-Warn2 "Tip: subscription models are rate-limited - use 'claude-haiku-4-5' for reliable use."
                $configured += 'claudecode'
            }
        }
    }
}

if ($configured.Count -eq 0) {
    Write-Warn2 "No providers were configured successfully. Nothing else to do."
    return
}

# 5. Default provider + model ----------------------------------------------
$nameByKey = @{}
foreach ($p in $providers) { $nameByKey[$p.Key] = $p.Name }

Write-Step "Choose the default provider"
$defaultKey = $null
if ($configured.Count -eq 1) {
    $defaultKey = $configured[0]
    Write-Ok ("Only one provider configured - using {0} as the default." -f $nameByKey[$defaultKey])
} else {
    Write-Host ""
    for ($i = 0; $i -lt $configured.Count; $i++) {
        Write-Host ("    {0}) {1}" -f ($i + 1), $nameByKey[$configured[$i]])
    }
    Write-Host ""
    while ($true) {
        $raw = Read-Host -Prompt ("Default provider [1-{0}]" -f $configured.Count)
        $n = 0
        if ([int]::TryParse(($raw.Trim()), [ref]$n) -and $n -ge 1 -and $n -le $configured.Count) {
            $defaultKey = $configured[$n - 1]
            break
        }
        Write-Warn2 "Please enter a number between 1 and $($configured.Count)."
    }
}
Set-EnvVar $envPath 'LLM_PROVIDER' $defaultKey
Write-Ok ("Default provider set to {0} (LLM_PROVIDER={1})." -f $nameByKey[$defaultKey], $defaultKey)

# Model defaults from example.env, plus a Claude Code subscription-safe suggestion.
$modelVarByKey = @{
    copilot    = 'LLM_COPILOT_MODEL'
    anthropic  = 'LLM_ANTHROPIC_MODEL'
    openai     = 'LLM_OPENAI_MODEL'
    claudecode = 'LLM_CLAUDECODE_MODEL'
}
$modelDefaultByKey = @{
    copilot    = 'gpt-4o'
    anthropic  = 'claude-opus-4-8'
    openai     = 'gpt-4o'
    claudecode = 'claude-haiku-4-5'
}
$modelVar     = $modelVarByKey[$defaultKey]
$modelDefault = $modelDefaultByKey[$defaultKey]

Write-Step ("Set the model for {0}" -f $nameByKey[$defaultKey])
if ($defaultKey -eq 'claudecode') {
    Write-Warn2 "Opus is rate-limited on subscription tokens - 'claude-haiku-4-5' is the reliable pick."
}
Write-Host ("    Press Enter to accept the default ({0}), or type a model id." -f $modelDefault) -ForegroundColor White
$modelRaw = Read-Host -Prompt 'Model'
if ([string]::IsNullOrWhiteSpace($modelRaw)) {
    $model = $modelDefault
} else {
    $model = $modelRaw.Trim()
}
Set-EnvVar $envPath $modelVar $model
Write-Ok ("Set {0}={1}." -f $modelVar, $model)

# Make sure the assistant is enabled.
Set-EnvVar $envPath 'LLM_ENABLED' 'true'
Write-Ok "Enabled the assistant (LLM_ENABLED=true)."

# 6. Summary ----------------------------------------------------------------
Write-Step "Provider setup complete"
$configuredNames = ($configured | ForEach-Object { $nameByKey[$_] }) -join ', '
Write-Host ""
Write-Host ("    Configured providers: {0}" -f $configuredNames) -ForegroundColor White
Write-Host ("    Default provider:     {0}" -f $nameByKey[$defaultKey]) -ForegroundColor White
Write-Host ("    Default model:        {0}" -f $model) -ForegroundColor White
Write-Host ""
Write-Warn2 "A server RESTART is required to pick up these .env changes (.env is read at startup):"
Write-Warn2 "    .\scripts\stop-threatdragon.ps1"
Write-Warn2 "    .\scripts\start-threatdragon.ps1"
Write-Host ""
Write-Host "    In the running app, the provider dropdown then lists your configured providers" -ForegroundColor White
Write-Host "    and fetches each account's live model list." -ForegroundColor White
Write-Host ""

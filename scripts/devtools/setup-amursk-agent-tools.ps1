#requires -Version 5.1
<#
.SYNOPSIS
  Prepare / install a project-scoped coding-agent tools pilot on the Amursk Windows development server.
.DESCRIPTION
  Default mode: diagnostic preflight only. -Apply installs tools ONLY in a separate
  Codex profile and a clean checkout of the experimental GitHub branch.
  Never touches existing Arthur processes, services, databases, Tailscale, or 1C.
.EXAMPLE
  .\scripts\devtools\setup-amursk-agent-tools.ps1
.EXAMPLE
  .\scripts\devtools\setup-amursk-agent-tools.ps1 -Apply -ExpectedHost DESKTOP-6NKDIC8
#>
[CmdletBinding()]
param(
  [switch] $Apply,
  [string] $ExpectedHost = ""
)
$ErrorActionPreference = "Stop"
$repositoryUrl = "https://github.com/sergeykuschev-ai/AI-Ecosystem-Sergey.git"
$pilotBranch = "experiment/agent-tools-20261009"
$machine = [Environment]::MachineName
$root = Join-Path ([Environment]::GetFolderPath("LocalApplicationData")) "Arthur-AgentTools-Pilot"
$pilotCheckout = Join-Path $root "AI-Ecosystem-Sergey"
$codexPilotHome = Join-Path $root "codex-home"

Write-Host "Mode: $(if ($Apply) { 'APPLY' } else { 'PREFLIGHT (NO CHANGES)' })"
Write-Host "Computer: $machine"
Write-Host "Pilot directory: $root"
Write-Host "Target repository: $repositoryUrl ($pilotBranch)"
foreach ($name in @("git","node","codex","uv","uvx")) {
  $cmd = Get-Command $name -ErrorAction SilentlyContinue
  if ($null -ne $cmd) {
    Write-Host ("{0}: {1}" -f $name,$cmd.Source)
  } else {
    Write-Warning "$name not found on PATH"
  }
}
if (-not $Apply) {
  Write-Host "No installation performed. Run -Apply -ExpectedHost <verified-Amursk-hostname> after review."
  return
}

if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT) {
  throw "This script targets the Amursk Windows development server only."
}
if ([string]::IsNullOrWhiteSpace($ExpectedHost) -or $machine -ine $ExpectedHost) {
  throw "Host mismatch. Provide the exact Amursk hostname via -ExpectedHost to prevent installing on another machine."
}
if ([Security.Principal.WindowsIdentity]::GetCurrent().Name -match '(?i)\\SYSTEM$') {
  throw "Refusing installation under the production SYSTEM account."
}
foreach ($name in @("git","node","codex","uvx")) {
  if (-not (Get-Command $name -ErrorAction SilentlyContinue)) {
    throw "Missing required tool: $name. No automatic system-wide package manager installs are allowed."
  }
}
if (Test-Path $pilotCheckout) {
  throw "Pilot checkout already exists at $pilotCheckout. Inspect it manually before retrying; nothing was overwritten."
}
New-Item -ItemType Directory -Force -Path $root,$codexPilotHome | Out-Null
$env:CODEX_HOME = $codexPilotHome
$env:PONYTAIL_DEFAULT_MODE = "lite"
Write-Host "Isolated CODEX_HOME = $env:CODEX_HOME"

& git clone --depth 1 --branch $pilotBranch $repositoryUrl $pilotCheckout
if ($LASTEXITCODE -ne 0) { throw "Pilot checkout failed." }
Push-Location $pilotCheckout
try {
  & codex plugin marketplace add DietrichGebert/ponytail
  if ($LASTEXITCODE -ne 0) { throw "Ponytail marketplace installation failed." }
  & codex plugin add ponytail@ponytail
  if ($LASTEXITCODE -ne 0) { throw "Ponytail plugin installation failed." }

  & codex plugin marketplace add addyosmani/agent-skills
  if ($LASTEXITCODE -ne 0) { throw "Agent Skills marketplace installation failed." }
  & codex plugin add agent-skills@agent-skills
  if ($LASTEXITCODE -ne 0) { throw "Agent Skills plugin installation failed." }

  & uvx --from "graphifyy==0.9.81" graphify agents/purchasing --no-viz
  if ($LASTEXITCODE -ne 0) { throw "Graphify CLI pilot graph failed." }

  $graph = Join-Path $pilotCheckout "agents\purchasing\graphify-out\graph.json"
  if (-not (Test-Path $graph)) { throw "Graphify did not generate graph.json." }
  Write-Host "PILOT PASS: Graphify graph present: $graph"
  Write-Host "Ponytail + Agent Skills installed ONLY in pilot CODEX_HOME, not activated in production."
  Write-Host "Inspect and trust Ponytail hooks manually in pilot Codex /hooks before activating."
} finally {
  Pop-Location
}

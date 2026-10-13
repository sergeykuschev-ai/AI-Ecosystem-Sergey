#requires -Version 5.1
<#
.SYNOPSIS
  Guarded setup / status check for the isolated Amursk development plugin pilot.
.DESCRIPTION
  No impact on production Codex profiles, Docker, Tailscale, databases, sites,
  Arthur services or AgentControl queues. Without -Apply: READ-ONLY.
  With -Apply: refuses other hosts and pre-existing pilot checkouts.
.EXAMPLE
  .\scripts\devtools\setup-amursk-agent-tools.ps1
.EXAMPLE
  .\scripts\devtools\setup-amursk-agent-tools.ps1 -Apply -ExpectedHost DESKTOP-6NKDIC8
#>
[CmdletBinding()]
param(
  [switch] $Apply,
  [string] $ExpectedHost = ''
)
$ErrorActionPreference = 'Stop'
$hostName = [Environment]::MachineName
$pilotRoot = 'C:\AI\AgentToolsPilot20261009'
$pilotCheckout = Join-Path $pilotRoot 'AI-Ecosystem-Sergey'
$venvPython = Join-Path $pilotRoot '.venv\Scripts\python.exe'
$repoUrl = 'https://github.com/sergeykuschev-ai/AI-Ecosystem-Sergey.git'
$pilotBranch = 'experiment/agent-tools-20261009'
$tools = @('git', 'node', 'python', 'codex')
Write-Host "HOST=$hostName MODE=$(if($Apply){'APPLY'}else{'READ_ONLY'})"
Write-Host "PILOT=$pilotRoot"
foreach ($tool in $tools) {
  $found = Get-Command $tool -ErrorAction SilentlyContinue
  Write-Host "$($tool)=$(if($found){$found.Source}else{'MISSING'})"
}
Write-Host "PILOT_EXISTS=$(Test-Path -LiteralPath $pilotCheckout)"
Write-Host "VENV_EXISTS=$(Test-Path -LiteralPath $venvPython)"
if (-not $Apply) {
  Write-Host 'PREFLIGHT_COMPLETE_NO_CHANGES'
  return
}
if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT) {
  throw 'Windows Amursk host required.'
}
if ([string]::IsNullOrWhiteSpace($ExpectedHost) -or $hostName -ine $ExpectedHost) {
  throw 'Host mismatch. Provide the exact Amursk hostname in -ExpectedHost.'
}
if ($hostName -ine 'DESKTOP-6NKDIC8') {
  throw 'This pilot is restricted to the known Amursk machine.'
}
if (Test-Path -LiteralPath $pilotCheckout) {
  Write-Host 'ALREADY_PRESENT_NO_CHANGES: inspect the existing pilot instead of reinstalling.'
  return
}
foreach ($tool in @('git', 'node', 'python')) {
  if (-not (Get-Command $tool -ErrorAction SilentlyContinue)) {
    throw "Missing prerequisite: $tool. No system-level installation attempted."
  }
}
New-Item -ItemType Directory -Force -Path $pilotRoot | Out-Null
& git clone --depth 1 --single-branch --branch $pilotBranch $repoUrl $pilotCheckout
if ($LASTEXITCODE -ne 0) { throw 'Pilot checkout clone failed' }
& python -m venv (Join-Path $pilotRoot '.venv')
if ($LASTEXITCODE -ne 0) { throw 'Pilot Python virtual environment failed' }
& $venvPython -m pip install --disable-pip-version-check --no-input 'graphifyy==0.9.81'
if ($LASTEXITCODE -ne 0) { throw 'Graphify installation failed' }

$upstreamRoot = Join-Path $pilotRoot 'upstream'
New-Item -ItemType Directory -Force -Path $upstreamRoot | Out-Null
$sources = @(
  @{ Name = 'ponytail'; Url = 'https://github.com/DietrichGebert/ponytail.git' },
  @{ Name = 'agent-skills'; Url = 'https://github.com/addyosmani/agent-skills.git' }
)
foreach ($entry in $sources) {
  $destination = Join-Path $upstreamRoot $entry.Name
  & git clone --depth 1 $entry.Url $destination
  if ($LASTEXITCODE -ne 0) { throw "Failed to fetch $($entry.Name)" }
}
$selected = @(
  @{ Name = 'ponytail'; Source = 'ponytail\skills\ponytail' },
  @{ Name = 'test-driven-development'; Source = 'agent-skills\skills\test-driven-development' },
  @{ Name = 'code-review-and-quality'; Source = 'agent-skills\skills\code-review-and-quality' },
  @{ Name = 'security-and-hardening'; Source = 'agent-skills\skills\security-and-hardening' }
)
$skillsDir = Join-Path $pilotCheckout '.agents\skills'
New-Item -ItemType Directory -Force -Path $skillsDir | Out-Null
foreach ($entry in $selected) {
  $source = Join-Path $upstreamRoot $entry.Source
  if (-not (Test-Path -LiteralPath (Join-Path $source 'SKILL.md'))) {
    throw "Missing upstream skill: $($entry.Name)"
  }
  Copy-Item -LiteralPath $source -Destination (Join-Path $skillsDir $entry.Name) -Recurse
  Write-Host "PROJECT_SKILL=$($entry.Name)"
}
# Deliberately no native marketplace plugin activation or lifecycle hooks.
# Graphify's deterministic scan is manual or via a separately tested quality gate.
Write-Host 'PILOT_SETUP_DONE_PROJECT_ONLY'

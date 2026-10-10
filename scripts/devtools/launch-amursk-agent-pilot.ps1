#requires -Version 5.1
<#
.SYNOPSIS
  Open Codex only in the isolated agent-tools pilot, through the existing SSH tunnel.
.DESCRIPTION
  Read-only preflight by default. -Launch opens Codex interactively in a known
  pilot directory; it never changes the production Codex profile, system proxy
  settings, scheduled tasks, Tailscale, Docker or services. Do not run elevated.
.EXAMPLE
  .\scripts\devtools\launch-amursk-agent-pilot.ps1 -Project purchasing
.EXAMPLE
  .\scripts\devtools\launch-amursk-agent-pilot.ps1 -Project arthur -Launch -ExpectedHost DESKTOP-6NKDIC8
#>
[CmdletBinding()]
param(
  [ValidateSet('purchasing','arthur','business-kpi','stores','vozdooh')]
  [string] $Project = 'purchasing',
  [switch] $Launch,
  [string] $ExpectedHost = ''
)
$ErrorActionPreference = 'Stop'
$root = 'C:\AI\AgentToolsPilot20261009\AI-Ecosystem-Sergey'
$venvScripts = 'C:\AI\AgentToolsPilot20261009\.venv\Scripts'
$proxy = 'http://127.0.0.1:8443'
$allowed = @{
  'purchasing' = 'agents\purchasing'
  'arthur' = 'agents\arthur-core'
  'business-kpi' = 'apps\business-kpi-web'
  'stores' = 'apps\stores-web'
  'vozdooh' = 'apps\vozdooh-web'
}
$workspace = Join-Path $root $allowed[$Project]
$portOpen = $false
try {
  $socket = New-Object System.Net.Sockets.TcpClient
  $async = $socket.BeginConnect('127.0.0.1', 8443, $null, $null)
  $portOpen = $async.AsyncWaitHandle.WaitOne(2000, $false)
  $socket.Close()
} catch {}
Write-Host "Host=$([Environment]::MachineName)"
Write-Host "Pilot workspace=$workspace"
Write-Host "Graphify installed=$(Test-Path (Join-Path $venvScripts 'graphify.exe'))"
Write-Host "Pilot skills present=$(Test-Path (Join-Path $root '.agents\skills\ponytail\SKILL.md'))"
Write-Host "Existing outbound tunnel listening=$portOpen"
if (-not $Launch) {
  Write-Host 'PREFLIGHT_COMPLETE_NO_CHANGES'
  return
}
if ($ExpectedHost -ine 'DESKTOP-6NKDIC8' -or [Environment]::MachineName -ine $ExpectedHost) {
  throw 'Host mismatch: no Codex launched.'
}
if (-not (Test-Path (Join-Path $workspace 'graphify-out\graph.json'))) {
  throw 'Project knowledge graph missing. Build a code-only graph first.'
}
if (-not (Test-Path (Join-Path $venvScripts 'graphify.exe'))) {
  throw 'Pilot Graphify virtual environment not found.'
}
if (-not $portOpen) { throw 'Existing SSH tunnel on 127.0.0.1:8443 is unavailable.' }
$codex = Get-Command codex.exe -ErrorAction Stop
# Process-scoped proxy configuration; no persistent machine changes.
$env:HTTP_PROXY = $proxy
$env:HTTPS_PROXY = $proxy
$env:ALL_PROXY = $proxy
$env:PATH = $venvScripts + ';' + $env:PATH
$env:PONYTAIL_DEFAULT_MODE = 'lite'
Write-Host 'Starting interactive Codex with existing proxy in isolated pilot checkout.'
& $codex.Source -C $workspace
exit $LASTEXITCODE

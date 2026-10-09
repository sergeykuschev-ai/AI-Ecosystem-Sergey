$ErrorActionPreference = 'Stop'
$env:ARTHUR_DEV_WORKER_REPORT_DIR = 'C:\AI-Ecosystem\local-services\arthur-dev-worker-reports'
$node = 'C:\Program Files\nodejs\node.exe'
$runner = Join-Path $PSScriptRoot 'monitor_runner.js'
if (!(Test-Path -LiteralPath $node) -or !(Test-Path -LiteralPath $runner)) {
  Write-Output 'DEV_WORKER_NOT_CONFIGURED'
  exit 4
}
& $node $runner
exit $LASTEXITCODE

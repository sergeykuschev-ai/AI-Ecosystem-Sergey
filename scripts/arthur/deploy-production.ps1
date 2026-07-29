$ErrorActionPreference = 'Stop'

$ComposeFile = if ($env:ARTHUR_COMPOSE_FILE) { $env:ARTHUR_COMPOSE_FILE } else { 'docker/arthur/compose.yml' }
$N8nContainer = if ($env:N8N_CONTAINER) { $env:N8N_CONTAINER } else { 'n8n' }
$NetworkName = if ($env:ARTHUR_N8N_NETWORK) { $env:ARTHUR_N8N_NETWORK } else { 'arthur_n8n' }
$EnvFile = if ($env:ARTHUR_ENV_FILE) { $env:ARTHUR_ENV_FILE } else { 'docker/arthur/.env' }

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) { throw 'Docker is required' }
if (-not (Test-Path $ComposeFile)) { throw "Compose file not found: $ComposeFile" }
if (-not (Test-Path $EnvFile)) { throw "Environment file not found: $EnvFile" }

docker inspect $N8nContainer *> $null
if ($LASTEXITCODE -ne 0) { throw "n8n container not found: $N8nContainer" }

Write-Host 'Starting Arthur Core...'
docker compose --env-file $EnvFile -f $ComposeFile up -d --build --wait
if ($LASTEXITCODE -ne 0) { throw 'Arthur Core startup failed' }

Write-Host "Connecting existing n8n container to $NetworkName..."
docker network inspect $NetworkName *> $null
if ($LASTEXITCODE -ne 0) {
  docker network create $NetworkName *> $null
  if ($LASTEXITCODE -ne 0) { throw "Failed to create network $NetworkName" }
}

$NetworksJson = docker inspect -f '{{json .NetworkSettings.Networks}}' $N8nContainer
if ($NetworksJson -notmatch [regex]::Escape('"' + $NetworkName + '"')) {
  docker network connect $NetworkName $N8nContainer
  if ($LASTEXITCODE -ne 0) { throw 'Failed to connect n8n to Arthur network' }
}

Write-Host 'Verifying Arthur Core from n8n network...'
docker run --rm --network $NetworkName node:22-alpine node -e "fetch('http://arthur-api:8787/health').then(async r=>{const b=await r.json();if(!r.ok||b.ok!==true)process.exit(1)}).catch(()=>process.exit(1))"
if ($LASTEXITCODE -ne 0) { throw 'Arthur Core network healthcheck failed' }

Write-Host 'Deployment complete. Arthur Core is internal-only and reachable from n8n as http://arthur-api:8787'

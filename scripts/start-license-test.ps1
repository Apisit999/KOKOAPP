$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$serverUrl = 'http://127.0.0.1:8787'

try {
  $health = Invoke-RestMethod -Uri "$serverUrl/health" -TimeoutSec 3
} catch {
  throw 'Local License Server is not running. Start it first with: npm.cmd run license:server'
}
if (-not $health.ok) { throw 'Local License Server health check failed.' }

$publicKeyPath = Join-Path $projectRoot 'secrets/license-public.pem'
if (-not (Test-Path -LiteralPath $publicKeyPath)) { throw 'Missing secrets/license-public.pem. Generate local signing keys first.' }
$publicKey = Get-Content -LiteralPath $publicKeyPath -Raw
$trustedKeys = @{ 'koko-local-dev-1' = $publicKey } | ConvertTo-Json -Compress

$env:KOKO_LICENSE_API_BASE_URL = $serverUrl
$env:KOKO_LICENSE_PRODUCT_ID = 'koko-photobooth'
$env:KOKO_LICENSE_TRUSTED_KEYS_JSON = $trustedKeys

Push-Location $projectRoot
try {
  npm.cmd start
} finally {
  Pop-Location
}

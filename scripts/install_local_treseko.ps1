param(
  [int]$HttpPort = 9095,
  [switch]$WithDemo,
  [switch]$Reset,
  [switch]$Force
)

$ErrorActionPreference = "Stop"

function New-TresekoSecret {
  param([int]$Length)
  $chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_"
  $bytes = New-Object byte[] $Length
  $fillMethod = [System.Security.Cryptography.RandomNumberGenerator].GetMethod("Fill", [type[]]@([byte[]]))
  if ($null -ne $fillMethod) {
    [System.Security.Cryptography.RandomNumberGenerator]::Fill($bytes)
  } else {
    $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    try {
      $rng.GetBytes($bytes)
    } finally {
      $rng.Dispose()
    }
  }
  $result = New-Object System.Text.StringBuilder
  foreach ($b in $bytes) {
    [void]$result.Append($chars[$b % $chars.Length])
  }
  return $result.ToString()
}

function Require-Command {
  param([string]$Name)
  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
    throw "Falta el comando local '$Name'. Instala Docker Desktop con Compose v2."
  }
}

function Assert-LastExitCode {
  param([string]$Operation)
  if ($LASTEXITCODE -ne 0) {
    throw "$Operation fallo con codigo $LASTEXITCODE."
  }
}

Require-Command docker

docker compose version *> $null
if ($LASTEXITCODE -ne 0) {
  throw "Docker Compose v2 no esta disponible. Instala Docker Desktop actualizado."
}

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot = Resolve-Path (Join-Path $ScriptDir "..")
$LocalDir = Join-Path $RepoRoot ".treseko-local"
$SecretsDir = Join-Path $LocalDir "secrets"
$EnvFile = Join-Path $RepoRoot "compose.production.env"
$AdminEmail = "admin@qa.local"

if ((Test-Path $EnvFile) -and -not ($Force -or $Reset)) {
  throw "Ya existe $EnvFile. Usa -Force para regenerar o -Reset para recrear todo el entorno local."
}

New-Item -ItemType Directory -Force -Path $SecretsDir | Out-Null

$AdminPassword = New-TresekoSecret 24
$DbPassword = New-TresekoSecret 32
$SecretKey = New-TresekoSecret 64
$AiCredentialsMasterKey = New-TresekoSecret 64
$AiEngineInternalToken = New-TresekoSecret 64
$DatabaseUrl = "postgresql+asyncpg://treseko:${DbPassword}@db:5432/treseko"

$DbPasswordFile = Join-Path $SecretsDir "db-password"
$DatabaseUrlFile = Join-Path $SecretsDir "database-url"
$SecretKeyFile = Join-Path $SecretsDir "secret-key"
$AiCredentialsMasterKeyFile = Join-Path $SecretsDir "ai-credentials-master-key"
$AiEngineInternalTokenFile = Join-Path $SecretsDir "ai-engine-internal-token"
$AdminPasswordFile = Join-Path $SecretsDir "admin-password"
$ComposeDbPasswordFile = $DbPasswordFile.Replace('\', '/')
$ComposeDatabaseUrlFile = $DatabaseUrlFile.Replace('\', '/')
$ComposeSecretKeyFile = $SecretKeyFile.Replace('\', '/')
$ComposeAiCredentialsMasterKeyFile = $AiCredentialsMasterKeyFile.Replace('\', '/')
$ComposeAiEngineInternalTokenFile = $AiEngineInternalTokenFile.Replace('\', '/')

[System.IO.File]::WriteAllText($DbPasswordFile, $DbPassword)
[System.IO.File]::WriteAllText($DatabaseUrlFile, $DatabaseUrl)
[System.IO.File]::WriteAllText($SecretKeyFile, $SecretKey)
[System.IO.File]::WriteAllText($AiCredentialsMasterKeyFile, $AiCredentialsMasterKey)
[System.IO.File]::WriteAllText($AiEngineInternalTokenFile, $AiEngineInternalToken)
[System.IO.File]::WriteAllText($AdminPasswordFile, $AdminPassword)

@"
APP_ENV=production
TRESEKO_HTTP_PORT=$HttpPort
TRESEKO_DB_PASSWORD_FILE=$ComposeDbPasswordFile
TRESEKO_DATABASE_URL_FILE=$ComposeDatabaseUrlFile
TRESEKO_SECRET_KEY_FILE=$ComposeSecretKeyFile
TRESEKO_AI_CREDENTIALS_MASTER_KEY_FILE=$ComposeAiCredentialsMasterKeyFile
TRESEKO_AI_ENGINE_INTERNAL_TOKEN_FILE=$ComposeAiEngineInternalTokenFile
DB_USER=treseko
DB_NAME=treseko
AUTO_BACKUP_ENABLED=true
LOG_LEVEL=INFO
"@ | Set-Content -Encoding UTF8 -Path $EnvFile

Push-Location $RepoRoot
try {
  if ($Reset) {
    Write-Host "Reiniciando entorno local y volumenes..."
    docker compose -f docker-compose.prod.yml --env-file compose.production.env down -v --remove-orphans
    Assert-LastExitCode "La limpieza del entorno Docker"
  }

  Write-Host "Construyendo y levantando Treseko local..."
  docker compose -f docker-compose.prod.yml --env-file compose.production.env build
  Assert-LastExitCode "La construccion de las imagenes Docker"
  docker compose -f docker-compose.prod.yml --env-file compose.production.env up -d db redis
  Assert-LastExitCode "El arranque de PostgreSQL y Redis"
  docker compose -f docker-compose.prod.yml --env-file compose.production.env run --rm migrator
  Assert-LastExitCode "Las migraciones de la base de datos"
  Get-Content -Raw -Path $AdminPasswordFile |
    docker compose -f docker-compose.prod.yml --env-file compose.production.env run --rm -T `
      --entrypoint python backend /app/seed_admin.py --password-stdin
  Assert-LastExitCode "La creacion del administrador inicial"
  docker compose -f docker-compose.prod.yml --env-file compose.production.env up -d backend engine frontend
  Assert-LastExitCode "El arranque de backend, Engine y frontend"

  if ($WithDemo) {
    Write-Host "Cargando datos demo..."
    docker compose -f docker-compose.prod.yml --env-file compose.production.env run --rm `
      --entrypoint python backend /app/seed_demo_showcase.py
    Assert-LastExitCode "La carga de datos demo"
  }
}
finally {
  Pop-Location
}

Write-Host ""
Write-Host "Treseko Community local quedo listo."
Write-Host ""
Write-Host "URL:"
Write-Host "  http://localhost:$HttpPort"
Write-Host ""
Write-Host "Usuario inicial:"
Write-Host "  $AdminEmail"
Write-Host ""
Write-Host "Contrasena temporal:"
Write-Host "  $AdminPassword"
Write-Host ""
Write-Host "Guarda esta contrasena ahora. Treseko pedira cambiarla en el primer login."

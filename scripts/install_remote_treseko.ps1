param(
  [Parameter(Mandatory = $true, Position = 0)]
  [string]$Target,

  [int]$SshPort = 22,
  [string]$RemoteDir = "/opt/treseko-platform",
  [int]$HttpPort = 9095,
  [switch]$SkipDockerInstall
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
    throw "Falta el comando local '$Name'. En Windows instala OpenSSH Client y tar."
  }
}

function ConvertTo-BashSingleQuoted {
  param([string]$Value)
  return "'" + ($Value -replace "'", "'\''") + "'"
}

Require-Command ssh
Require-Command scp
Require-Command tar

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot = Resolve-Path (Join-Path $ScriptDir "..")
$Archive = Join-Path $env:TEMP ("treseko-platform-{0}.tgz" -f ([guid]::NewGuid().ToString("N")))
$RemoteArchive = "/tmp/treseko-platform.tgz"

$AdminEmail = "admin@qa.local"
$AdminPassword = New-TresekoSecret 24
$DbPassword = New-TresekoSecret 32
$SecretKey = New-TresekoSecret 64
$InstallDocker = if ($SkipDockerInstall) { "false" } else { "true" }

try {
  Write-Host "Preparando paquete local..."
  tar `
    --exclude .git `
    --exclude node_modules `
    --exclude "*/node_modules" `
    --exclude dist `
    --exclude "*/dist" `
    --exclude .venv `
    --exclude "*/.venv" `
    --exclude logs `
    --exclude "*/logs" `
    -czf $Archive `
    -C $RepoRoot .

  Write-Host "Subiendo paquete a $Target..."
  scp -P $SshPort $Archive "${Target}:${RemoteArchive}"

  $RemoteScript = @'
set -euo pipefail

SUDO=""
if [ "$(id -u)" -ne 0 ]; then
  if ! command -v sudo >/dev/null 2>&1; then
    echo "El usuario remoto no es root y sudo no esta disponible." >&2
    exit 1
  fi
  SUDO="sudo"
fi

if ! command -v docker >/dev/null 2>&1; then
  if [ "${TRESEKO_INSTALL_DOCKER}" != "true" ]; then
    echo "Docker no esta instalado y se pidio no instalarlo automaticamente." >&2
    exit 1
  fi
  if ! command -v apt-get >/dev/null 2>&1; then
    echo "Docker no esta instalado. Instala Docker Compose v2 manualmente o usa Ubuntu/Debian con apt." >&2
    exit 1
  fi
  echo "Instalando Docker y Compose plugin..."
  $SUDO apt-get update
  $SUDO apt-get install -y docker.io docker-compose-plugin
  $SUDO systemctl enable --now docker || true
fi

if ! docker compose version >/dev/null 2>&1; then
  echo "Docker Compose v2 no esta disponible. Instala docker-compose-plugin." >&2
  exit 1
fi

$SUDO mkdir -p "${TRESEKO_REMOTE_DIR}"
$SUDO tar -xzf /tmp/treseko-platform.tgz -C "${TRESEKO_REMOTE_DIR}"
$SUDO mkdir -p "${TRESEKO_REMOTE_DIR}/secrets"

DATABASE_URL="postgresql+asyncpg://treseko:${TRESEKO_DB_PASSWORD}@db:5432/treseko"

printf '%s' "${TRESEKO_DB_PASSWORD}" | $SUDO tee "${TRESEKO_REMOTE_DIR}/secrets/db-password" >/dev/null
printf '%s' "${DATABASE_URL}" | $SUDO tee "${TRESEKO_REMOTE_DIR}/secrets/database-url" >/dev/null
printf '%s' "${TRESEKO_SECRET_KEY}" | $SUDO tee "${TRESEKO_REMOTE_DIR}/secrets/secret-key" >/dev/null
printf '%s' "${TRESEKO_ADMIN_PASSWORD}" | $SUDO tee "${TRESEKO_REMOTE_DIR}/secrets/admin-password" >/dev/null
$SUDO chmod 0600 "${TRESEKO_REMOTE_DIR}"/secrets/*

$SUDO tee "${TRESEKO_REMOTE_DIR}/compose.production.env" >/dev/null <<ENV
APP_ENV=production
TRESEKO_HTTP_PORT=${TRESEKO_HTTP_PORT}
TRESEKO_DB_PASSWORD_FILE=${TRESEKO_REMOTE_DIR}/secrets/db-password
TRESEKO_DATABASE_URL_FILE=${TRESEKO_REMOTE_DIR}/secrets/database-url
TRESEKO_SECRET_KEY_FILE=${TRESEKO_REMOTE_DIR}/secrets/secret-key
DB_USER=treseko
DB_NAME=treseko
AUTO_BACKUP_ENABLED=true
LOG_LEVEL=INFO
ENV
$SUDO chmod 0600 "${TRESEKO_REMOTE_DIR}/compose.production.env"

cd "${TRESEKO_REMOTE_DIR}"
$SUDO docker compose -f docker-compose.prod.yml --env-file compose.production.env build
$SUDO docker compose -f docker-compose.prod.yml --env-file compose.production.env up -d db redis
$SUDO docker compose -f docker-compose.prod.yml --env-file compose.production.env run --rm migrator
$SUDO docker compose -f docker-compose.prod.yml --env-file compose.production.env run --rm \
  -v "${TRESEKO_REMOTE_DIR}/secrets/admin-password:/run/secrets/admin-password:ro" \
  --entrypoint python backend /app/seed_admin.py --password-file /run/secrets/admin-password
$SUDO docker compose -f docker-compose.prod.yml --env-file compose.production.env up -d backend engine frontend

rm -f /tmp/treseko-platform.tgz
'@

  Write-Host "Instalando Treseko en $Target..."
  $Bootstrap = @"
TRESEKO_REMOTE_DIR=$(ConvertTo-BashSingleQuoted $RemoteDir)
TRESEKO_HTTP_PORT=$(ConvertTo-BashSingleQuoted ([string]$HttpPort))
TRESEKO_INSTALL_DOCKER=$(ConvertTo-BashSingleQuoted $InstallDocker)
TRESEKO_DB_PASSWORD=$(ConvertTo-BashSingleQuoted $DbPassword)
TRESEKO_SECRET_KEY=$(ConvertTo-BashSingleQuoted $SecretKey)
TRESEKO_ADMIN_PASSWORD=$(ConvertTo-BashSingleQuoted $AdminPassword)
export TRESEKO_REMOTE_DIR TRESEKO_HTTP_PORT TRESEKO_INSTALL_DOCKER TRESEKO_DB_PASSWORD TRESEKO_SECRET_KEY TRESEKO_ADMIN_PASSWORD

$RemoteScript
"@
  $Bootstrap | ssh -p $SshPort $Target bash -s

  $HostName = $Target -replace '^.*@', ''

  Write-Host ""
  Write-Host "Treseko Community quedo instalado."
  Write-Host ""
  Write-Host "URL:"
  Write-Host "  http://${HostName}:${HttpPort}"
  Write-Host ""
  Write-Host "Usuario inicial:"
  Write-Host "  $AdminEmail"
  Write-Host ""
  Write-Host "Contrasena temporal:"
  Write-Host "  $AdminPassword"
  Write-Host ""
  Write-Host "Guarda esta contrasena ahora. Treseko pedira cambiarla en el primer login."
}
finally {
  if (Test-Path $Archive) {
    Remove-Item $Archive -Force
  }
}

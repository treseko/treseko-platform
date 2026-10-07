param(
  [ValidateRange(1, 65535)][int]$HttpPort = 9095,
  [ValidateSet("127.0.0.1", "0.0.0.0")][string]$BindAddress = "127.0.0.1",
  [switch]$WithDemo,
  [switch]$Update,
  [switch]$Uninstall,
  [switch]$PurgeData,
  [switch]$ConfirmPurge,
  [switch]$Reset,
  [switch]$ConfirmReset,
  [string]$InstallRoot
)

$ErrorActionPreference = "Stop"

if ($Update -and $Uninstall) { throw "-Update y -Uninstall son incompatibles." }
if ($PurgeData -and -not $Uninstall) { throw "-PurgeData solo se puede usar junto con -Uninstall." }
if ($ConfirmPurge -and -not $PurgeData) { throw "-ConfirmPurge solo se puede usar junto con -PurgeData." }
if ($PurgeData -and -not $ConfirmPurge) { throw "La purga requiere -ConfirmPurge explicito." }
if ($Update -and $WithDemo) { throw "-WithDemo no se puede combinar con -Update." }
if ($Reset -and -not $ConfirmReset) { throw "La recreacion destructiva requiere -ConfirmReset explicito." }
if ($ConfirmReset -and -not $Reset) { throw "-ConfirmReset solo se puede usar junto con -Reset." }

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
$InstallRoot = if ([string]::IsNullOrWhiteSpace($InstallRoot)) { $RepoRoot.Path } else { (Resolve-Path -LiteralPath $InstallRoot).Path }
$LocalDir = Join-Path $InstallRoot ".treseko-local"
$SecretsDir = Join-Path $LocalDir "secrets"
$EnvFile = Join-Path $InstallRoot "compose.production.env"
$AdminEmail = "admin@qa.local"

$ProjectName = $null
if ($Update -or $Uninstall -or $Reset) {
  $ProjectNameLine = Get-Content -LiteralPath $EnvFile | Where-Object { $_ -match '^TRESEKO_COMPOSE_PROJECT_NAME=' } | Select-Object -Last 1
  if ($ProjectNameLine) { $ProjectName = $ProjectNameLine.Substring('TRESEKO_COMPOSE_PROJECT_NAME='.Length) }
  if ([string]::IsNullOrWhiteSpace($ProjectName)) {
    $composeProjectsJson = & docker compose ls --all --format json
    Assert-LastExitCode "La consulta de proyectos Compose existentes"
    $composeProjects = ($composeProjectsJson | Out-String) | ConvertFrom-Json
    $oldComposePath = [System.IO.Path]::GetFullPath((Join-Path $InstallRoot "docker-compose.prod.yml"))
    $matches = @($composeProjects | Where-Object {
      $project = $_
      @(([string]$project.ConfigFiles).Split(',')) | Where-Object {
        [string]::Equals([System.IO.Path]::GetFullPath($_.Trim()), $oldComposePath, [System.StringComparison]::OrdinalIgnoreCase)
      } | Select-Object -First 1
    } | Select-Object -ExpandProperty Name -Unique)
    if ($matches.Count -eq 1) { $ProjectName = [string]$matches[0] }
  }
  if ($ProjectName -notmatch '^[a-z0-9][a-z0-9_-]*$') {
    throw "No se pudo identificar sin ambiguedad el proyecto Compose existente; se cancela para evitar crear volumenes paralelos."
  }
  if ($Update -and -not $ProjectNameLine) {
    $envItem = Get-Item -LiteralPath $EnvFile -Force
    if ($envItem.Attributes -band [System.IO.FileAttributes]::ReparsePoint) {
      throw "El archivo de ambiente no puede ser un enlace simbolico."
    }
    Add-Content -LiteralPath $EnvFile -Value "TRESEKO_COMPOSE_PROJECT_NAME=$ProjectName" -Encoding ASCII
  }
}

function Invoke-Compose {
  param([Parameter(ValueFromRemainingArguments = $true)][string[]]$Arguments)
  $composePreference = $ErrorActionPreference
  try {
    # Windows PowerShell 5.1 promotes native stderr (including Compose
    # progress) to ErrorRecord objects. Capture it without Stop aborting before
    # the real native exit code can be checked.
    $ErrorActionPreference = "Continue"
    if ($ProjectName) {
      $composeOutput = & docker compose --project-directory $RepoRoot.Path -p $ProjectName -f (Join-Path $RepoRoot.Path "docker-compose.prod.yml") --env-file $EnvFile @Arguments 2>&1
    } else {
      $composeOutput = & docker compose -f (Join-Path $RepoRoot.Path "docker-compose.prod.yml") --env-file $EnvFile @Arguments 2>&1
    }
    $composeExitCode = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $composePreference
  }
  foreach ($line in $composeOutput) { Write-Host $line }
  if ($composeExitCode -ne 0) {
    throw "Docker Compose fallo con codigo $composeExitCode."
  }
}

function Test-RecognizedInstallation {
  if (-not (Test-Path -LiteralPath $EnvFile -PathType Leaf)) { return $false }
  if (-not (Test-Path -LiteralPath (Join-Path $InstallRoot "docker-compose.prod.yml") -PathType Leaf)) { return $false }
  if (-not (Test-Path -LiteralPath $SecretsDir -PathType Container)) { return $false }
  foreach ($name in @("db-password", "database-url", "secret-key", "ai-credentials-master-key", "ai-engine-internal-token", "admin-password")) {
    if (-not (Test-Path -LiteralPath (Join-Path $SecretsDir $name) -PathType Leaf)) { return $false }
  }
  return $true
}

function Assert-PurgePaths {
  $root = (Resolve-Path -LiteralPath $InstallRoot).Path.TrimEnd('\', '/')
  $local = [System.IO.Path]::GetFullPath($LocalDir).TrimEnd('\', '/')
  $env = [System.IO.Path]::GetFullPath($EnvFile)
  if ($local -ne "$root$([System.IO.Path]::DirectorySeparatorChar).treseko-local") { throw "Ruta de purga insegura: $LocalDir" }
  if ($env -ne "$root$([System.IO.Path]::DirectorySeparatorChar)compose.production.env") { throw "Ruta de purga insegura: $EnvFile" }
}

if (($Update -or $Uninstall) -and -not (Test-RecognizedInstallation)) {
  throw "No existe $EnvFile; no se puede actualizar o desinstalar sin la configuracion existente."
}

Push-Location $RepoRoot.Path
try {
  if ($Uninstall) {
    if ($PurgeData) {
      Assert-PurgePaths
      Write-Host "PURGA: deteniendo contenedores y eliminando volumenes y configuracion local de $RepoRoot."
      Invoke-Compose down '-v' --remove-orphans
    } else {
      Write-Host "Desinstalacion conservadora: se conservan volumenes y configuracion."
      Invoke-Compose down --remove-orphans
    }
    if ($PurgeData) {
      Remove-Item -LiteralPath $LocalDir -Recurse -Force -ErrorAction SilentlyContinue
      Remove-Item -LiteralPath $EnvFile -Force -ErrorAction SilentlyContinue
    }
    exit 0
  }
  if ($Update) {
    $pythonCommand = Get-Command python -ErrorAction SilentlyContinue
    $pythonLauncher = Get-Command py -ErrorAction SilentlyContinue
    if (-not $pythonCommand -and -not $pythonLauncher) {
      throw "Falta Python 3 para ejecutar la actualizacion atomica (comando python o launcher py)."
    }
    $expectedVersion = (Get-Content -Raw -Path (Join-Path $RepoRoot "VERSION")).Trim()
    $atomicUpdateScript = Join-Path $RepoRoot.Path "scripts/atomic_local_update.py"
    if ($pythonCommand) {
      & $pythonCommand.Source $atomicUpdateScript --docker (Get-Command docker).Source --project $ProjectName `
        --candidate-root $RepoRoot.Path --install-root $InstallRoot --env-file $EnvFile --version $expectedVersion
    } else {
      & $pythonLauncher.Source -3 $atomicUpdateScript --docker (Get-Command docker).Source --project $ProjectName `
        --candidate-root $RepoRoot.Path --install-root $InstallRoot --env-file $EnvFile --version $expectedVersion
    }
    Assert-LastExitCode "La actualizacion atomica"
    exit 0
  }
} finally {
  Pop-Location
}

if ($Reset -and (Test-RecognizedInstallation)) {
  Assert-PurgePaths
  Push-Location $RepoRoot
  try {
    Write-Host "Reiniciando entorno local y volumenes..."
    Invoke-Compose down '-v' --remove-orphans
  } finally {
    Pop-Location
  }
  Remove-Item -LiteralPath $LocalDir -Recurse -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $EnvFile -Force -ErrorAction SilentlyContinue
}

if (Test-Path -LiteralPath $EnvFile -PathType Leaf) {
  throw "Ya existe $EnvFile. Usa -Update para actualizar o -Uninstall para retirarlo de forma conservadora."
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
TRESEKO_BIND_ADDRESS=$BindAddress
TRESEKO_DB_PASSWORD_FILE=$ComposeDbPasswordFile
TRESEKO_DATABASE_URL_FILE=$ComposeDatabaseUrlFile
TRESEKO_SECRET_KEY_FILE=$ComposeSecretKeyFile
TRESEKO_AI_CREDENTIALS_MASTER_KEY_FILE=$ComposeAiCredentialsMasterKeyFile
TRESEKO_AI_ENGINE_INTERNAL_TOKEN_FILE=$ComposeAiEngineInternalTokenFile
DB_USER=treseko
DB_NAME=treseko
AUTO_BACKUP_ENABLED=true
LOG_LEVEL=INFO
QA_ORGANIZACION_ID=
"@ | Set-Content -Encoding UTF8 -Path $EnvFile

if ([string]::IsNullOrWhiteSpace($ProjectName)) {
  $newConfigJson = & docker compose --project-directory $RepoRoot.Path -f (Join-Path $RepoRoot.Path "docker-compose.prod.yml") --env-file $EnvFile config --format json
  Assert-LastExitCode "La identidad Compose de la nueva instalacion"
  $newConfig = ($newConfigJson | Out-String) | ConvertFrom-Json
  $ProjectName = [string]$newConfig.name
  if ($ProjectName -notmatch '^[a-z0-9][a-z0-9_-]*$') { throw "Docker Compose devolvio una identidad invalida para la nueva instalacion." }
  Add-Content -LiteralPath $EnvFile -Value "TRESEKO_COMPOSE_PROJECT_NAME=$ProjectName" -Encoding ASCII
}

Push-Location $RepoRoot.Path
try {
  if ($Reset) {
    Write-Host "Reiniciando entorno local y volumenes..."
    Invoke-Compose down '-v' --remove-orphans
  }

  Write-Host "Construyendo y levantando Treseko local..."
  Invoke-Compose build
  Invoke-Compose up '-d' db redis
  Invoke-Compose run --rm migrator
  Get-Content -Raw -Path $AdminPasswordFile |
    docker compose -f docker-compose.prod.yml --env-file compose.production.env run --rm -T `
      --entrypoint python backend /app/seed_admin.py --password-stdin
  Assert-LastExitCode "La creacion del administrador inicial"
  Invoke-Compose '--profile' 'automation' up '-d' backend engine frontend automation-worker
  Assert-LastExitCode "El arranque de backend, Engine, Worker y frontend"

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

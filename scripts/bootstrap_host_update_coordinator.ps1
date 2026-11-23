[CmdletBinding()]
param(
  [Parameter(Mandatory = $true, Position = 0)]
  [ValidateSet("preflight", "prepare", "plan", "install", "migrate")]
  [string]$Command,
  [Parameter(Mandatory = $true)]
  [string]$InstallRoot,
  [string]$EnvFile,
  [string]$Distro,
  [string]$Package,
  [string]$Manifest
)

$ErrorActionPreference = "Stop"
$Protocol = "treseko-host-update-coordinator/v1"
$taskCreated = $false

function Invoke-Wsl {
  param([string[]]$WslArgs)
  $previousErrorActionPreference = $ErrorActionPreference
  try {
    # Windows PowerShell 5.1 turns native stderr into ErrorRecords. Keep those
    # inside this function so the WSL exit code can produce the adapter's own
    # actionable error instead of aborting on a localized stderr message.
    $ErrorActionPreference = "Continue"
    $output = & wsl.exe @WslArgs 2>&1
    $wslExitCode = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $previousErrorActionPreference
  }
  if ($wslExitCode -ne 0) {
    throw "La operación WSL falló. Verifica WSL 2, Docker Desktop con integración habilitada, acceso del usuario al daemon, systemd activo y linger."
  }
  return ($output | Out-String).Trim()
}

if (-not (Get-Command wsl.exe -ErrorAction SilentlyContinue)) {
  throw "Treseko Flow en Windows requiere WSL 2 y Docker Desktop con integración WSL habilitada."
}
$installRootIsLinuxPath = $InstallRoot.StartsWith("/")
if (-not $installRootIsLinuxPath) {
  $InstallRoot = (Resolve-Path -LiteralPath $InstallRoot).Path
}
if ([string]::IsNullOrWhiteSpace($EnvFile)) {
  if ($installRootIsLinuxPath) {
    $EnvFile = $InstallRoot.TrimEnd("/") + "/compose.production.env"
  } else {
    $EnvFile = Join-Path $InstallRoot "compose.production.env"
  }
}
if (-not $EnvFile.StartsWith("/")) {
  $EnvFile = (Resolve-Path -LiteralPath $EnvFile).Path
}
$ReleaseRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$LinuxAdapter = Join-Path $ReleaseRoot "scripts/bootstrap_host_update_coordinator.sh"

$wslPrefix = @()
if (-not [string]::IsNullOrWhiteSpace($Distro)) {
  $wslPrefix = @("--distribution", $Distro)
}
$kernel = Invoke-Wsl ($wslPrefix + @("--exec", "uname", "-r"))
if ($kernel -notmatch "microsoft-standard-WSL2") {
  throw "La distribución seleccionada no ejecuta un kernel WSL 2."
}
$linuxUser = Invoke-Wsl ($wslPrefix + @("--exec", "id", "-un"))
$distroLabel = if ([string]::IsNullOrWhiteSpace($Distro)) { "predeterminada" } else { $Distro }
try {
  $dockerCli = Invoke-Wsl ($wslPrefix + @("--user", $linuxUser, "--exec", "which", "docker"))
} catch {
  throw "No se encuentra el CLI Docker para el usuario '$linuxUser' en la distribución WSL '$distroLabel'. Habilita la integración WSL de Docker Desktop."
}
try {
  Invoke-Wsl ($wslPrefix + @("--exec", "test", "-S", "/var/run/docker.sock")) | Out-Null
} catch {
  throw "No existe el socket Docker de WSL en /var/run/docker.sock. Inicia Docker Desktop y habilita la integración para la distribución '$distroLabel'."
}
try {
  Invoke-Wsl ($wslPrefix + @("--user", $linuxUser, "--exec", "docker", "info")) | Out-Null
} catch {
  throw "WSL está activo, pero el usuario '$linuxUser' no puede acceder al daemon Docker. Habilita la integración de Ubuntu en Docker Desktop y verifica el acceso del usuario al socket /var/run/docker.sock."
}
try {
  Invoke-Wsl ($wslPrefix + @("--user", $linuxUser, "--exec", "systemctl", "--user", "is-system-running")) | Out-Null
} catch {
  throw "No está disponible el bus systemd del usuario WSL. Habilita systemd en /etc/wsl.conf; en Ubuntu mínimo instala dbus-user-session y reinicia la distribución."
}
$linuxUid = Invoke-Wsl ($wslPrefix + @("--user", $linuxUser, "--exec", "id", "-u"))
try {
  $linger = Invoke-Wsl ($wslPrefix + @("--exec", "loginctl", "show-user", $linuxUid, "-p", "Linger", "--value"))
} catch {
  throw "No se pudo consultar loginctl para el usuario WSL '$linuxUser'; verifica que systemd esté activo en '$distroLabel'."
}
if ($linger -ne "yes") {
  throw "Treseko Flow en Windows requiere linger habilitado para el usuario WSL."
}

function Convert-ToWslPath {
  param([string]$Path)
  if ($Path.StartsWith("/")) {
    return $Path
  }
  return Invoke-Wsl ($wslPrefix + @("--exec", "wslpath", "-u", $Path))
}

function Resolve-WslPath {
  param([string]$Path, [string]$Kind)
  if ($Path.StartsWith("/")) {
    $testFlag = if ($Kind -eq "directory") { "-d" } else { "-f" }
    Invoke-Wsl ($wslPrefix + @("--user", $linuxUser, "--exec", "test", $testFlag, $Path)) | Out-Null
    return Invoke-Wsl ($wslPrefix + @("--user", $linuxUser, "--exec", "realpath", "-e", "--", $Path))
  }
  return (Resolve-Path -LiteralPath $Path).Path
}

$InstallRoot = Resolve-WslPath $InstallRoot "directory"
$EnvFile = Resolve-WslPath $EnvFile "file"
$linuxInstallRoot = Convert-ToWslPath $InstallRoot
$linuxEnvFile = Convert-ToWslPath $EnvFile
$linuxReleaseRoot = Convert-ToWslPath $ReleaseRoot
$linuxAdapter = Convert-ToWslPath $LinuxAdapter
$linuxDocker = Invoke-Wsl ($wslPrefix + @("--user", $linuxUser, "--exec", "sh", "-lc", "command -v docker"))
if ($Command -eq "migrate") {
  if ([string]::IsNullOrWhiteSpace($Package)) {
    throw "migrate requiere -Package con el OTA firmado o el bundle descargable único."
  }
  $linuxPackage = Convert-ToWslPath (Resolve-Path -LiteralPath $Package).Path
  $adapterArgs = @("--user", $linuxUser, "--exec", "env",
    "TRESEKO_HOST_BOOTSTRAP_PROTOCOL=$Protocol", "bash", $linuxAdapter, "migrate",
    "--install-root", $linuxInstallRoot, "--env-file", $linuxEnvFile,
    "--docker", $linuxDocker, "--package", $linuxPackage)
  if (-not [string]::IsNullOrWhiteSpace($Manifest)) {
    $linuxManifest = Convert-ToWslPath (Resolve-Path -LiteralPath $Manifest).Path
    $adapterArgs += @("--manifest", $linuxManifest)
  }
} else {
  $adapterArgs = @(
    "--user", $linuxUser,
    "--exec", "env", "TRESEKO_HOST_BOOTSTRAP_PROTOCOL=$Protocol", "bash", $linuxAdapter,
    $Command,
    "--install-root", $linuxInstallRoot,
    "--env-file", $linuxEnvFile,
    "--docker", $linuxDocker,
    "--source-release-root", $linuxReleaseRoot
  )
}
if (-not [string]::IsNullOrWhiteSpace($Distro)) {
  $adapterArgs = @("--distribution", $Distro) + $adapterArgs
}

if ($Command -eq "install") {
  $planArgs = @(
    "--user", $linuxUser,
    "--exec", "env", "TRESEKO_HOST_BOOTSTRAP_PROTOCOL=$Protocol", "bash", $linuxAdapter,
    "plan",
    "--install-root", $linuxInstallRoot,
    "--env-file", $linuxEnvFile,
    "--docker", $linuxDocker,
    "--source-release-root", $linuxReleaseRoot
  )
  if (-not [string]::IsNullOrWhiteSpace($Distro)) {
    $planArgs = @("--distribution", $Distro) + $planArgs
  }
  $plan = (Invoke-Wsl $planArgs | ConvertFrom-Json)
  $taskName = "Treseko-Update-Spool-$($plan.project)"
  $timerUnit = "treseko-update-spool-$($plan.project).timer"
  $wslCommand = Get-Command wsl.exe
  $taskArguments = @()
  if (-not [string]::IsNullOrWhiteSpace($Distro)) {
    $taskArguments += @("--distribution", $Distro)
  }
  $taskArguments += @("--user", $linuxUser, "--exec", "systemctl", "--user", "start", $timerUnit)
  $action = New-ScheduledTaskAction -Execute $wslCommand.Source -Argument (($taskArguments | ForEach-Object {
    if ($_ -match '[\s"]') { '"' + ($_ -replace '"', '\"') + '"' } else { $_ }
  }) -join ' ')
  $trigger = New-ScheduledTaskTrigger -AtLogOn -User "$env:USERDOMAIN\$env:USERNAME"
  $settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -MultipleInstances IgnoreNew
  $description = "Inicia el coordinador local de actualizaciones Treseko en WSL 2."
  $existingTask = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
  if ($null -ne $existingTask) {
    $ownedAction = $existingTask.Actions | Where-Object {
      $_.Execute -eq $wslCommand.Source -and $_.Arguments -match [regex]::Escape($timerUnit)
    }
    if ($existingTask.Description -ne $description -or $null -eq $ownedAction) {
      throw "Ya existe una tarea '$taskName' que no pertenece a este coordinador; no se modificó."
    }
  } else {
    Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings `
      -Description $description | Out-Null
    $taskCreated = $true
  }
}

try {
  # $adapterArgs already includes the selected distribution when -Distro is set.
  # Prefixing $wslPrefix here a second time makes WSL reject the request.
  $result = Invoke-Wsl $adapterArgs
  if ($Command -eq "migrate") {
    $planArgs = @("--user", $linuxUser, "--exec", "env",
      "TRESEKO_HOST_BOOTSTRAP_PROTOCOL=$Protocol", "bash", $linuxAdapter, "plan",
      "--install-root", $linuxInstallRoot, "--env-file", $linuxEnvFile,
      "--docker", $linuxDocker, "--source-release-root", $linuxReleaseRoot)
    if (-not [string]::IsNullOrWhiteSpace($Distro)) {
      $planArgs = @("--distribution", $Distro) + $planArgs
    }
    $plan = (Invoke-Wsl $planArgs | ConvertFrom-Json)
    $taskName = "Treseko-Update-Spool-$($plan.project)"
    $timerUnit = "treseko-update-spool-$($plan.project).timer"
    $taskArguments = @()
    if (-not [string]::IsNullOrWhiteSpace($Distro)) {
      $taskArguments += @("--distribution", $Distro)
    }
    $taskArguments += @("--user", $linuxUser, "--exec", "systemctl", "--user", "start", $timerUnit)
    $wslCommand = Get-Command wsl.exe
    $action = New-ScheduledTaskAction -Execute $wslCommand.Source -Argument (($taskArguments | ForEach-Object {
      if ($_ -match '[\s"]') { '"' + ($_ -replace '"', '\"') + '"' } else { $_ }
    }) -join ' ')
    $trigger = New-ScheduledTaskTrigger -AtLogOn -User "$env:USERDOMAIN\$env:USERNAME"
    $settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -MultipleInstances IgnoreNew
    $taskDescription = "Inicia el coordinador local de actualizaciones Treseko en WSL 2."
    $existingTask = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
    if ($null -eq $existingTask) {
      Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings `
        -Description $taskDescription | Out-Null
      $taskCreated = $true
    } elseif ($existingTask.Description -ne $taskDescription -or
      -not ($existingTask.Actions | Where-Object { $_.Execute -eq $wslCommand.Source -and $_.Arguments -match [regex]::Escape($timerUnit) })) {
      throw "La aplicación quedó actualizada, pero existe una tarea de Windows ajena. Ejecuta install después de resolver '$taskName'."
    }
  }
  if ($Command -eq "install") {
    Start-ScheduledTask -TaskName $taskName
    $task = Get-ScheduledTask -TaskName $taskName
    if ($task.State -eq "Disabled") {
      throw "Windows no pudo activar la tarea de inicio del coordinador."
    }
  } elseif ($Command -eq "migrate") {
    Start-ScheduledTask -TaskName $taskName
  }
  Write-Output $result
} catch {
  if ($Command -eq "install" -and $taskCreated) {
    Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue
  }
  throw
}

<!-- Language: en -->

# Experimental graphical installer for Windows

`scripts/install_local_treseko_assisted.ps1` is a proof of concept for
evaluating a guided Treseko Community installation.

The window can:

- check Docker Desktop, Docker Compose, WSL2, the selected port, and available
  disk space;
- detect existing Treseko installations, group containers by Compose project,
  show their ports/state, and read the backend version from `/VERSION`;
- select an existing installation and update it while preserving
  `compose.production.env`, secrets, and volumes;
- create a local configuration backup before copying files and running the
  build, migrations, and health checks;
- request confirmation before attempting to install Docker Desktop through
  `winget`;
- request WSL installation when Windows does not have it yet;
- display process logs;
- run the stable installer `install_local_treseko.ps1`;
- start Docker Desktop when it is installed but stopped;
- restart Treseko services from the same window;
- install with demo data or recreate the environment using the received
  parameters.
- show differentiated visual notices for information, success, warning, and
  error states, including UAC permissions, occupied ports, and critical steps.

## Running it

From PowerShell at the repository root:

```powershell
Set-ExecutionPolicy -Scope Process Bypass
.\scripts\install_local_treseko_assisted.ps1
```

With demo data:

```powershell
.\scripts\install_local_treseko_assisted.ps1 -WithDemo
```

With another port:

```powershell
.\scripts\install_local_treseko_assisted.ps1 -HttpPort 9096
```

## Scope of this experiment

This is an evaluation layer and does not yet replace the stable installer.
The actual installation remains the responsibility of
`install_local_treseko.ps1`, avoiding two implementations of the secrets,
Compose, migrations, and administrator creation logic.

Installing Docker Desktop and WSL may require UAC, license acceptance, and a
Windows restart. The script must not hide those steps: it always asks for
confirmation and displays the result.

The **Restart Treseko** button restarts the local `docker-compose` services
without removing volumes or regenerating secrets. If WSL2 or a Docker update
requires a Windows restart, the application must ask for confirmation; that
restart is never performed silently.

Critical messages appear in a highlighted banner above the buttons instead of
only in the technical log. The log keeps diagnostic detail, while the banner
summarizes the action the user must take.

## Next evaluation

1. Run the window on a clean Windows machine.
2. Test Docker already installed and Docker absent.
3. Test WSL absent and the post-restart scenario.
4. Test a port that is already in use and confirm the existing project's
   version is displayed without stopping it.
5. Confirm that the temporary password is displayed once and remains outside
   persistent logs.
6. Select an existing installation and update it without `down -v`, secret
   regeneration, or volume deletion.
7. Validate a clean installation, an installation with demo data, and failure
   recovery.

## Updating an existing installation

After **Verify requirements**, the selector shows one entry for each detected
Treseko Compose project. The version is read from `/VERSION` inside the
`backend` container. If that container is unavailable, the value is shown as
`N/D` and the update must not be considered validated until the project is
reviewed manually.

The **Update existing** button requires confirmation and:

1. backs up `compose.production.env` and secrets under
   `.treseko-local/installer-backups/<timestamp>/`;
2. copies the current package without overwriting the environment file or
   secrets directory;
3. runs `build`, starts `db` and `redis`, runs the migrator, and starts
   `backend`, `engine`, and `frontend`;
4. checks the backend version and displays the backup location.

It never runs `down -v`, deletes volumes, stops another installation, or
regenerates credentials. If a stage fails, it reports the backup location for
manual recovery and does not present the update as completed.

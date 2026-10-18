# Contract for Preparing Update Packages

<!-- Language: en -->

This document is mandatory for any AI or agent preparing a Treseko update. A
package must be executable by the installed updater, reproducible, verifiable,
and reversible.

## Operational Goal

An update must move an installation from one version to another without asking
the user to rebuild containers, copy directories, or edit files. The package
must contain the artifacts and instructions required to prepare, apply,
validate, and reverse the change.

The main flow is:

```text
validate -> download -> verify -> backup -> pre-update -> maintenance
-> replace components -> migrate -> restart -> health checks -> activate
-> clean up or roll back
```

## Compatibility Rule

A package must not depend exclusively on logic from the version being updated.
The installation must retain a stable `updater-bootstrap` that can read the
package and execute its plan.

The bootstrap must process `manifest.json`, `VERSION`, `update-plan.json`,
consecutive updates, migrations, and rollback. If the bootstrap format changes,
a compatible version or migration bridge must be published first. Do not assume
that `1.0.0` understands a future version's format.

## Package Structure

```text
treseko-update-v<VERSION>.tar.gz
├── manifest.json
├── VERSION
├── CHANGELOG.md
├── update-plan.json
├── updater/
│   ├── update.py                 # optional: validated special logic
│   ├── pre-update.sh             # optional: preparation step
│   ├── post-update.sh            # optional: follow-up tasks
│   └── rollback.sh               # optional: specific rollback
├── backend/
├── frontend/dist/
├── engine/
├── automation-worker/
├── plugin-runner/             # when declared in the component manifest
└── source-release/            # optional: complete public release for atomic Compose
```

The three component-contract metadata files—`manifest.json`,
`update-plan.json`, and `runtime-builds.json`—travel together. If a package
includes any of them, all three are required, and their inventories, versions,
and origins must agree with one another and with the signed manifest. An
incomplete payload is rejected during staging before any component is
prepared; synthetic test payloads follow the same rule.

If the manifest declares `deployment.mode=complete-source`,
`source-release/`, its `VERSION`, the Compose file, all Dockerfiles/build
contexts, and the atomic installer scripts are also required. This tree must
come only from `public-release/treseko-platform` and exclude caches, installed
dependencies, local `.env` configuration (while preserving versioned
`.env*.example` templates), persistent static data, attachments, evidence, and
local identity files. The descriptor must match in the signed manifest, internal
manifest, and `update-plan.json`; the publisher and stager verify these paths
before accepting or extracting the package.

In this mode, `SOURCE_DIR` and `TRESEKO_UPDATE_SOURCE_RELEASE_DIR` must point
to the same public checkout. The builder checks this before compiling or
creating output files and rejects different checkouts, so the component
runtime, changelog, and complete Compose tree cannot represent different
revisions.

The signed outer manifest includes `components.source-release=true` when it
declares `deployment.mode=complete-source`. This marker stays out of the
internal `manifest.json` so the package remains compatible with the legacy
bootstrap. The current stager requires the marker and activates the complete
tree; a 1.0.6 helper rejects it as an unknown component before touching
services, preventing a runtime-only update that leaves the old Compose file.
The builder also keeps a separate component-only bootstrap archive and signed
manifest under `packages/<version>/bootstrap/`. It has its own checksum and
omits `source-release` and `.env*.example` templates, because the old helper
classifies those paths as local state. Use it only to install bridge 1.0.7
with the 1.0.6 helper. After bootstrapping, use the main archive and manifest
from Settings -> Updates.

**Content does not equal activation:** the coordinator validates, prepares,
and routes `complete-source` to the atomic Compose installer. It installs the
complete versioned public tree, including the application, Dockerfiles,
Compose file, scripts, and documentation. It excludes local data/configuration
(`.env`, `backend/app/static`, volumes, attachments, evidence, and installation
identity) plus caches and generated dependencies. The local 1.0.6 -> 1.0.7
installer was tested on Linux with an injected rollback, successful retry,
migration, persisted database sentinel, service/version checks, Plugin Runner,
and login. This validates the Compose installer, not Settings -> Updates.

**1.0.6 compatibility:** its installed bridge recognizes component updates but
not `deployment.mode=complete-source`. The 1.0.6 helper installer can validate
a signed package and copy its backend into a new isolated version. The full
1.0.7 package therefore carries the compatible bridge, and the supported
transition for coordinated installations is:

1. Place the bootstrap archive and its manifest from
   `packages/1.0.7/bootstrap/` at the private
   `cache/<checksum_sha256>.tar.gz` and `manifest` paths declared in the
   existing HelperInstallation configuration. Keep the main complete-source
   archive and manifest for the later Settings update.
2. Run `scripts/bootstrap_update_helpers_docker.sh` with the immutable 1.0.6
   helper image, the existing Docker/socket/network settings, and the same
   private configuration. The 1.0.6 installer verifies the signature and
   checksum, then publishes the 1.0.7 helper backend and wrappers using its
   journal and rollback. It does not stop services or apply Compose.
3. Verify the installation receipt reports `version=1.0.7` and includes
   `treseko-update-host-bridge`; validate the project and private-state mounts
   against `atomic_compose`.
4. Apply the main manifest (with `components.source-release=true`) from
   Settings -> Updates. The 1.0.6 backend
   already delegates coordinated transactions to the helper; bridge 1.0.7
   prepares and applies the complete tree with the atomic Compose installer.

Linux QA runs the actual 1.0.6 helper installer with the component-only
bootstrap artifact and confirms that it installs bridge 1.0.7 in a temporary
prefix without starting services. Separately, the package smoke compares the
SHA-256 of every eligible `source-release` file with all 2,022 files in the
checkout, including the six versioned configuration examples. These checks do
not perform a real UI rollout or by themselves enable publication. The local
Compose 1.0.6 -> 1.0.7 upgrade also passed with injected
rollback, retry, migration, a persisted database sentinel, service checks,
Plugin Runner, and login.

This sequence applies to installations already using coordinated mode
and configured with the host helper. A legacy installation without a
coordinator cannot replace its Compose through the embedded updater; it needs
an operator-managed migration to the coordinator or the local Compose
installer with `--update` / `-Update`. Do not offer `complete-source` through
Settings until the bootstrap is complete on each target installation.

The builder requires `TRESEKO_COMPLETE_SOURCE_ENABLED=true` and
`TRESEKO_BRIDGE_BOOTSTRAP_VERIFIED=true` when 1.0.6 is a supported origin; the
signed manifest records that attestation. The publisher checks it again and
rejects component-only artifacts or packages without the mark. The Compose
installer test alone is insufficient: separately validate the 1.0.6 helper
bootstrap and Settings -> Updates with the bridge installed on an isolated
instance, then verify the complete tree is active.

Hooks are optional. If none are present, the bootstrap uses the product's
standard operations.

## Building a Community 1.0.2 -> 1.0.3 Update

From the repository root, prepare this version's package with the reproducible
builder. `PREVIOUS_VERSION` and `FROM_VERSIONS` must explicitly declare the
supported origin so the manifest and `update-plan.json` are unambiguous:

```bash
VERSION_VALUE=1.0.3 \
PREVIOUS_VERSION=1.0.2 \
FROM_VERSIONS=1.0.2 \
OUTPUT_ROOT="$PWD/.treseko/updates" \
TRESEKO_UPDATE_SKIP_BUILD=false \
bash scripts/build_update_package.sh
```

The artifact is written to
`.treseko/updates/packages/1.0.3/treseko-update-v1.0.3.tar.gz`, alongside its
manifest and channel index. The builder calculates SHA-256 and size with
Python for consistent operation on macOS and Linux, and adds the declarative
plan to the package. `COPYFILE_DISABLE=1` only disables AppleDouble metadata
from a macOS producer; it is harmless for a Linux tar and does not change the
content consumed by Docker. Run the package, upgrade/rollback, and release
checks before distribution; creating the archive alone is not publication.

Before creating the tar, the builder validates the staged tree: it rejects
`__MACOSX` directories, AppleDouble `._*` files, null bytes, and invalid Python
syntax. The pre-publication check inspects every `.tar.gz` member again, so a
contaminated archive cannot pass to the Update Server. The artifact can be
installed through the supported macOS, Linux, and Windows flows, including
their Docker targets; this does not declare native Windows support for running
`build_update_package.sh`. The producer requires Bash, Python, and the
packaging tools available in its environment.

## Declarative Plan

`update-plan.json` must describe special operations:

```json
{
  "version": "1.0.1",
  "previous_versions": ["1.0.0", "1.0.0-rc.1"],
  "components": {
    "backend": "replace",
    "frontend": "replace",
    "engine": "replace",
    "automation_worker": "replace",
    "plugin_runner": "replace"
  },
  "migrations": true,
  "restart": true,
  "health_checks": ["backend", "frontend", "engine", "worker", "database"],
  "rollback": {
    "enabled": true,
    "restore_database_on_migration_failure": true
  },
  "cleanup": {
    "keep_backups": 3,
    "delete_temporary_files_after_success": true
  }
}
```

`plugin_runner` is an optional runtime component in each installation's
topology. The package includes and validates it when the signed manifest
declares it, but must not create it accidentally on a 1.0.3 installation
without the `plugins` profile. When declared, the artifact must contain its
`Dockerfile`, `package.json`, and `src/`; its recipe must be in
`runtime-builds.json`, and it must be built, activated, and validated with the
other versioned components. If active, it must be present in the inventory,
image preparation, update participant, and verification/rollback path. If any
link is missing, the operation must be blocked before services stop.

The plan must not contain secrets, tokens, private keys, or machine-specific
paths.

## Apply Order and Version Confirmation

Confirming an update is the last step, never the first. Until a component is on
the target release, the installation must not report that release or mark the
update task as applied.

The legacy route (`backend/entrypoint.sh`) runs in this order:

```text
replace components -> database backup -> migrate
-> component convergence -> confirm installed VERSION
-> write update-applied -> disable maintenance -> start backend
```

Required invariants:

1. Write the installed `VERSION` (`$APP_DIR/VERSION` and, if present,
   `TRESEKO_VERSION_FILE`) only after migration and convergence. If anything
   fails first, rollback restores the previous `VERSION`; it must never have
   been changed.
2. Write `update-applied` and disable maintenance only after confirming
   `VERSION`. An update that does not converge must never reach
   `update-applied`.
3. Converge every component rewritten by the payload: Frontend (`VERSION` plus
   `version.json` plus its consumed restart marker), Engine (health reports the
   target version plus its consumed marker), and Automation Worker (runtime
   `VERSION` whenever included in the payload, plus its consumed restart marker
   when `.runner-token` exists).
4. If convergence does not complete within
   `TRESEKO_UPDATE_COMPONENT_CONVERGENCE_TIMEOUT_SECONDS` (180 seconds by
   default), startup fails, code rollback runs, and `update-failed` remains.

This does not make the legacy path atomic: it retains a window while services
restart later. Atomicity is provided by `scripts/atomic_local_update.py` (the
installer's `--update` path) and the transactional coordinator
(`update_transaction.py`). This rule ensures only that the legacy path never
reports an incomplete release.

## Allowed Hooks

### `pre-update`

Runs before replacing components. It may create directories, transform old
configuration, prepare data, check dependencies, prepare an exceptional build,
or stop processes in a controlled way.

It must be idempotent. If it fails, no component is replaced.

### `post-update`

Runs after copying components and applying migrations. It may regenerate
indexes or assets, validate data, remove temporary files, and record
diagnostics. The bootstrap's health checks make the final decision.

### `rollback`

Use only for special operations that the standard rollback cannot resolve. It
must restore only resources modified by the hook.

## Maintenance Screen

Before a long preparation or build, the bootstrap must create the maintenance
marker and keep a page accessible. Keep the visible states simple:

1. `Preparing update...`
2. `Saving a backup...`
3. `Installing components...`
4. `Checking services...`
5. `Update completed.`

Technical details belong in logs.

## Backups and Cleanup

Before modifying the installation, create backups of code, Frontend, Engine,
Worker, migrations, and the database where applicable. Persistent attachments,
evidence, and branding must not be removed during code replacement.

Remove temporary files only after health checks pass. Keep the configured most
recent backups for rollback and diagnosis.

During automatic rollback, the backend must temporarily lock the Engine and
Worker persistent volumes before restoring them. This prevents a deferred
restart from running `npm ci` or recreating `node_modules` while the backup is
being copied. Remove the lock only after code restoration finishes; if
restoration fails, record the failure and preserve state for diagnosis.

## Required Validation

```bash
python3 scripts/check_frontend_version_json.py
python3 scripts/test_frontend_entrypoint_version_guard.py
python3 scripts/test_update_upgrade_rollback.py
python3 scripts/check_update_system_readiness.py --skip-public-domains
scripts/validate_change.sh
```

The complete Docker transaction also requires two tests with real images: a
chain of at least two consecutive releases that confirms Backend, Frontend,
Engine, Automation Worker, `plugin_runner` when installed, and PostgreSQL; and
a second failed jump after the first jump has committed, which must restore
exactly the five images from the last committed release and preserve the
PostgreSQL revision. Testing only the initial jump or only confirming images
build is insufficient.

All these values must agree:

```text
manifest.version
VERSION
frontend/dist/VERSION
frontend/dist/version.json.version
engine/VERSION
engine/package.json.version
automation-worker/VERSION
automation-worker/package.json.version
```

The participant must validate the complete package before changing services:
the signed component inventory must match the internal manifest,
`update-plan.json`, `runtime-builds.json`, and the archive's actual paths. Each
declared component must have its runtime and Dockerfile; if Plugin Runner is
declared, it must also be part of the same inventory. Source versions
(`from_versions` / `previous_versions`) must agree across the signature,
internal manifest, and plan. Any difference must block staging, even if each
individual file is valid. Historical packages without these three internal
metadata files may use the legacy compatibility path; a new package must not
partially omit this contract.

This check is independent of testing the complete chain: every release must be
applicable from its declared origins, and rollback must restore the last
committed state of every participant, including PostgreSQL and Plugin Runner
when active. The same protocol should cover, for example, 1.0.3 -> 1.0.4 and
then 1.0.4 -> 1.0.5, without assuming that Frontend alone represents the
installed version.

## Instructions for Another AI

Before building a package, the AI must:

1. Read this document and the `docs/AI_*.md` context files.
2. Identify the source and target versions.
3. Review schema, file, configuration, and runtime changes.
4. Create or update `update-plan.json`.
5. Add hooks only if the standard flow is insufficient.
6. Make every hook idempotent and reversible.
7. Do not include secrets or modify private infrastructure.
8. Build with `scripts/build_update_package.sh`.
9. Validate the package, rollback, and public release.
10. Document special operations in `CHANGELOG.md`.

Do not claim an update is ready just because the `.tar.gz` was created; there
must be validation, health-check, and rollback evidence.

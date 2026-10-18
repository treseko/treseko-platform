# Treseko 1.0.7

## Integrity and safe updates

- Premium update checks now report an up-to-date installation as `no_update` instead of an error.
- Pins `jsonschema` to 4.26.0 so rebuilding the backend during a Premium update does not select a different 4.x dependency.
- Fixes verification of older immutable releases when file filters change between versions. The updater validates hashes recorded by the original manifest while continuing to reject modified or unexpected files.
- Allows existing 1.0.6 installations to be verified and updated without misclassifying historical files excluded from the current source tree.
- Validates the spool, bridge, and controller configuration chain and its mounts before installing the coordinated update helper.
- Accepts the `/` prefix documented for real installations while continuing to reject other broad paths.
- Mounts the dedicated control directory inside the coordinated backend so its admission fence works during updates.
- Includes all host bridge Python dependencies in the trusted helper image so its build and startup are reproducible.
- Avoids mounting the host bridge spool file twice; the wrapper already mounts it as read-only configuration.


## Fixes and Premium update

- The Premium `1.0.7` update is distributed through `premium-stable` for `1.0.6` installations; Community remains on `1.0.6`.
- Stories and test cases preserve scope, clarifications, and generation rules across retries; review of assumptions and proposals is improved before applying them, and implicit scenario limits no longer drop cases.
- Compose updates apply the complete source tree atomically, preserve configuration and volumes, check services, and support transactional recovery.
- Worker and AI Engine retain persistent execution paths and compatibility with earlier installations during the update.
- MCP keeps compatible resolution during the transition so connected assistants are not interrupted.


## Maintenance fix

- Fixes the maintenance countdown and keeps its deadline from restarting after it expires while the server is still restarting.

## Assistants and MCP

- The MCP catalog brings together 65 tools for viewing and managing QA workflows. Each tool follows its scope, user permissions, and required confirmations.
- Assistants can explore accessible public websites and record requirements, user stories, test cases, and observed manual results. Compatible automated cases run through the Treseko worker.

## User stories, test cases, and suites

- Generation preserves scope, clarifications, and acceptance criteria, and adds traceability and review before proposals are applied.
- Recovery from incomplete responses and provider errors is improved, and unanswered questions are preserved when generation resumes.
- Suites protect changes, make it easier to restore and reorder folders, copy only current versions, and respect active builds when archiving cases.

## Execution, tracking, and reports

- Execution saves recover progress and prevent duplicates. History improves pagination, filters, and evidence lookup for API and conversational formats.
- Bug Tracker and Incident Center improve filters, drafts, permissions, and links between duplicate bugs. Projects and inventory better preserve data context and relationships.
- Reports distinguish running executions from final results, preserve context when refreshed, and correct metrics and exports.

## AI engine

- Scheduling withstands temporary errors and duplicate submissions, and preserves tasks when a build is protected.
- AI evaluation requires evidence to assert states, including an empty cart, and checks the target and click effect after recovering from a failed click. Confidence scores are identified as internal and uncalibrated.

## Installation, security, and privacy

- Plugin Runner keeps the release version when it is rebuilt during an atomic update.
- Keeps Docker 1.0.6 installations compatible while runtime components update: it accepts the previous MCP resolver path and stores evidence in existing persistent volumes.
- The local atomic installer applies the full release Compose file with volume backups and rollback. For Premium 1.0.6, install bridge 1.0.7 using the upgrade guide first; then Settings → Updates applies the complete release.
- The main manifest marks the complete Compose tree; the 1.0.6 helper rejects that path before changing services. A component-only bootstrap package with its own checksum and signature installs bridge 1.0.7 first.
- The complete package preserves all six `.env*.example` templates while excluding local `.env` configuration, so upgrades include current examples without copying secrets.
- Bridge staging now preserves `.env*.example` templates inside the public source tree while continuing to reject local `.env` files and identity markers.
- The coordinator requires Plugin Runner to pass its healthcheck before activating a complete Compose release.
- The update coordinator verifies the active release and rejects older candidates before changing services or data.
- The in-app updater requires the atomic coordinator before accepting an update; local Compose installations without that coordinator must use the full release installer.
- Fixes read permissions for static resources when installing packages extracted with restrictive permissions.
- The coordinator stops legacy 1.0.6 frontends with `SIGTERM`, and the current frontend forwards `SIGQUIT` to Nginx for clean Compose shutdowns.
- Graphical installers are temporarily removed. Bash and PowerShell installation scripts remain available.
- Updates the worker's Handlebars dependency to 4.7.10, which includes a security fix for earlier versions.
- The installation ping is optional and disabled by default.

# Treseko 1.0.6

This release brings together improvements accumulated since Treseko 1.0.2. When
you upgrade, you will find new ways to test, organize, and share QA work, with
clearer controls for managing your team and maintaining your installation.

## New testing tools

- Create and run API tests with variables and validations, with results recorded
  alongside their evidence.
- Prepare multi-turn conversational tests and review their responses, timings,
  and results in the context of each case.
- Use AI assistance to draft and improve requirements, user stories, and test
  cases; proposals are available for review before they are applied.
- Configure AI profiles and choose models and workflows for each task.

## Organization and tracking

- View executive and team reports that preserve a shareable view of results,
  with options to revoke access or let it expire.
- Follow relationships among requirements, user stories, cases, executions,
  and bugs with more context and traceability.
- Manage organizations, members, roles, and permissions with clearer controls
  over available features.
- Access the Wiki and asset inventory from the platform when enabled for your
  edition.
- Use automation with registered workers, visible status, and safeguards
  against assigning work to inactive or revoked workers.

## Integrations and user experience

- Connect compatible tools through governed integration functions and explicit
  permissions to view or modify information.
- Find improvements to navigation, evidence, attachments, reports, and use on
  screens of different sizes.
- The interface is available in Spanish, English, and Portuguese.

## Updates and security

- Updates prepare and verify components before activation. If an update fails
  during the process, a recovery path with a backup is preserved.
- A new version is confirmed only after its components have started and passed
  their checks.
- Protection of sensitive data, connection validation, and credential and
  permission management have been strengthened.
- Unknown automation results are no longer presented as passing tests.

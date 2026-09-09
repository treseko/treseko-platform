# Data, persistence and backups

<!-- Language: en -->

Treseko uses PostgreSQL and persistent volumes for attachments, backups,
frontend files, the Engine and the worker runtime.

## Information retained

| Area | Information |
|---|---|
| Organization and projects | Solutions, projects, components, builds, teams, environments and datasets. |
| Design | Suites, cases, versions, steps, requirements, stories and links. |
| Execution | Runs, results, snapshots, observations, duration and statuses. |
| API and conversation | Frozen contract, assertions, turns, transcript and evaluation. |
| Quality | Bugs, comments, statuses, deduplication, history and metrics. |
| Administration | Users, roles, capabilities, preferences, license and audit. |
| Portability | Batches, hashes, external references and rollback. |

Attachments and binary evidence are outside PostgreSQL. Restoring only the
database does not recover those files.

## Snapshots and evidence

An execution keeps the configuration, permitted variables and result used. API
and conversational executions may keep the contract, assertions, turns,
responses, latencies and evaluation. History is read from snapshots, not from
the current case.

Normal evidence is sanitized and limited. `evidence_policy` and
`public_test_data` indicate the treatment applied. `public_test_data` is enabled
only for data explicitly marked as public; it never includes tokens, cookies,
credentials or real personal information.

## Backups and migrations

1. Back up PostgreSQL.
2. Back up attachments and evidence.
3. Keep secrets outside the repository.
4. Test restoration in an isolated instance.

The database and attachments must correspond to the same moment. Run the
migrator from the same version before starting the updated backend. Do not delete
volumes to solve a migration without a tested backup.

| Situation | Review |
|---|---|
| Result differs from the current case | Check the snapshot. |
| Evidence is missing | Restore the attachments volume as well. |
| Historical report does not open | Snapshot, permissions and storage. |
| Import must be reverted | Batch and one-hour window. |

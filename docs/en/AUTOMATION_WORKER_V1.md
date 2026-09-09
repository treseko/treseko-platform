# Automation worker

<!-- Language: en -->

A worker executes automated tests prepared by Treseko and records their results, evidence and history. Treseko remains the source of truth for cases, builds and executions; the same worker runs classic browser tests and automated API suites.

## Before starting

- Have edit permission in **Automation**.
- Prepare a machine with the required framework and browsers.
- Confirm that the worker can connect to the Treseko URL.
- Use an identifiable name, for example `QA Windows - Playwright`.

## Link a local worker

1. Start the worker on the machine that will run the tests.
2. The worker displays a temporary linking code.
3. In Treseko open **Automation → Workers**.
4. Find the pending request, review its capabilities and approve it.
5. Confirm that the worker appears as available before starting an automated execution.

The work token is stored locally on the worker and is not shown again in the interface. If you suspect it was exposed, revoke or re-link the worker.

## Run a test

1. Select one or more cases in **Execute Tests**.
2. Choose **Automated execution**.
3. Select the environment, dataset and compatible worker when applicable.
4. Start the execution.
5. Review the result and evidence in the execution or in **Run History**.

The worker receives a frozen job: script or API definition, framework, build, case, environment, dataset and variables. Later case changes do not alter that job.

The queue is isolated by solution and project. Each claimed job uses a lease renewed by heartbeat, so two workers cannot confirm the same job. If the backend is unavailable, the result remains in a local spool and the worker keeps the lease alive while retrying. The file is removed only after Treseko confirms receipt; after a restart, the same event identifier is reused to avoid duplicate results.

Automated API suites do not require another worker installation. The existing worker advertises `treseko-api/declarative`, runs cases in order and carries shared `api.*` variables forward. Manual API runs are performed directly from Treseko. Do not declare API + AI available without verifying a certified route, workflow, permissions and evidence in the specific installation.

The API job uses `treseko.api-worker-job/v1` and returns `treseko.api-result/v1`. The declarative runtime applies the environment allowlist, time and size limits, and redacts evidence before persistence. An API case imported from Postman does not automatically change executor: the normal path remains Treseko's declarative contract.

Do not confuse this with the external reporting API. An external runner uses `POST /external/executions/report`; it does not claim worker jobs or receive Treseko's snapshot.

## Evidence and results

The worker can return logs, screenshots and other artifacts. Treseko associates them with the execution and its steps so they are available when analyzing a failure or creating an internal bug.

For API jobs, the sensitive payload remains encrypted until the authenticated worker claims the job. State variables travel separately from visible evidence and are not included in reports.

## Troubleshooting

| Situation | What to review |
|---|---|
| The worker does not appear | Connectivity, the linking code and permissions in Automation. |
| The worker shows offline | That the process is still running and can reach Treseko. |
| It does not pick up jobs | That its frameworks and browsers are compatible with the case. |
| A result is pending delivery | Connectivity to Treseko; do not delete the local spool while the worker retries. |
| The test fails before starting | Framework version, dependencies, variables and case data. |
| There is no evidence | Worker configuration and attachment permissions. |

Community allows one basic local worker. Distributed administration of multiple workers and the advanced scheduler require the corresponding Premium capabilities.

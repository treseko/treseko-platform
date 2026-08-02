# Automation worker

<!-- Language: en -->

A worker executes automated tests that Treseko prepares and records their
results, evidence and history. Treseko keeps the source of truth for
cases, builds and executions; the worker only runs the assigned job.

## Before starting

- Have edit permission in **Automation**.
- Prepare a machine that has the required framework and browsers.
- Confirm the worker can connect to the Treseko URL.
- Use an identifiable name, for example `QA Windows - Playwright`.

## Link a local worker

1. Start the worker on the machine that will run the tests.
2. The worker will show a temporary linking code.
3. In Treseko open **Automation → Workers**.
4. Look for the pending request, review its capabilities and approve it.
5. Confirm the worker appears as available before starting an automated
   execution.

The work token is stored locally on the worker and is not shown again
in the interface. If you suspect it was exposed, revoke or re-link the worker.

## Run a test

1. Select one or more cases in **Run Tests**.
2. Choose **Automated execution**.
3. Select the environment, dataset and compatible worker when applicable.
4. Start the execution.
5. Review the result and evidence in the execution or in **Run History**.

The worker receives a frozen job: script, framework, build, case, environment,
dataset and variables. Post-case changes do not alter that job.

## Evidence and results

The worker can return logs, screenshots and other artifacts. Treseko associates them with
the execution and its steps so they are available when analyzing a failure or
creating an internal bug.

## Troubleshooting

| Situation | What to review |
|---|---|
| The worker does not appear | Connectivity, the linking code and the permissions in Automation. |
| The worker shows offline | That the process is still running and can reach Treseko. |
| It does not pick up jobs | That its frameworks and browsers are compatible with the case. |
| The test fails before starting | The framework version, dependencies, variables and case data. |
| There is no evidence | The worker configuration and the attachment permissions. |

Community allows a basic local worker. Distributed administration of
multiple workers and the advanced scheduler require the corresponding Premium
capabilities.
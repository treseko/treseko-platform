# Automation guide

<!-- Language: en -->

**Automation** centralizes workers, reusable functions and integration codes for the selected project.

There are two distinct paths:

- The **unified Automation Worker** executes jobs prepared by Treseko, including classic cases and declarative API cases.
- The **external API** receives results from a runner executed outside Treseko. It does not start jobs and is not another worker.

## Requirements

Select a solution and project. To execute against a build, also select an active build. Visible options depend on your permissions and the installed edition.

## Workers

A worker receives automated execution jobs and returns results to Treseko.

1. Open **Automation**.
2. Review the worker status and last heartbeat.
3. Start the local worker with its approved configuration and link it using the screen code when you have edit permission.
4. Confirm that it remains **online** before sending automated tests.

Community allows one local worker per solution. Distributed administration of multiple workers and the scheduler require the corresponding capabilities.

## Reusable functions

In **Automated Functions Library** you can create functions shared by cases. Document their purpose, parameters and expected effect. Before deleting or modifying a function, review which scripts use it.

## Codes for external automation

This section also provides the context needed to connect an external runner or service. The API is authenticated with an API key created from **Settings → Preferences → External automation API keys**.

Follow the [external automation guide](API_USAGE_GUIDE.md) to create the key and report results securely.

## Evidence and snapshots

Automated jobs run with a frozen case, build, environment, dataset and variable definition. For API tests, `treseko.api-result/v1` is preserved with time/size limits, and sensitive variables remain separate from visible evidence.

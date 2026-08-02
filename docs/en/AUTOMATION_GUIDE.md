# Automation guide

<!-- Language: en -->

**Automation** centralizes workers, reusable functions and integration codes for the selected project.

## Requirements

Select solution and project. To execute against a build, also select an active build. The visible options depend on your permissions and the installed edition.

## Workers

A worker receives automated execution jobs and returns results to Treseko.

1. Open **Automation**.
2. Check the worker's status and last heartbeat.
3. Start the local worker with its approved configuration and link it using the screen code when you have edit permission.
4. Confirm it stays **online** before sending automated tests.

Community allows one local worker per solution. Distributed administration of multiple workers and the scheduler require the corresponding capabilities.

## Reusable functions

In **Automated Functions Library** you can create functions shared by cases. Document their purpose, parameters and expected effect. Before deleting or modifying a function, review which scripts use it.

## Codes for external automation

The section also provides the context needed to connect an external runner or service. The API is authenticated with an API key created from **Settings → Preferences → External automation API keys**.

Follow the [external automation guide](API_USAGE_GUIDE.md) to create the key and report the results securely.
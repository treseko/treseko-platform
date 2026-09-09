# API testing guide

<!-- Language: en -->

Treseko supports declarative API testing and separates two integrations that are often confused.

## Run inside Treseko

The case uses the `API` format and a declarative configuration. The runner resolves variables from the environment and dataset, applies the allowlist, sends the request and evaluates its assertions.

- **Manual:** the request and verdict are managed from the API console.
- **Automated:** the unified Automation Worker claims the job, advertises `treseko-api/declarative` and returns `treseko.api-result/v1`.
- **AI:** do not declare it available until you verify the route and evidence in the specific installation.

There is no separate API worker.

## Report from an external runner

An external runner executes the test and only reports the result:

```http
POST /external/executions/report
Authorization: Bearer <API_KEY_DE_AUTOMATIZACION_EXTERNA>
Content-Type: application/json
```

This API does not start jobs or receive the snapshot of an internal case. The API key must be stored as a CI secret and have only the minimum required scope. The contract is atomic: an invalid batch returns an error and does not save any part of the batch. Exact limits and examples for `steps`, `api` and `chatbot` payloads are in [External automation API](EXTERNAL_AUTOMATION_API.md).

## Evidence and security

- The environment defines permitted destinations.
- The response has time and size limits.
- Sensitive values are redacted before persistence or sharing.
- Permitted state variables use the `api.*` namespace and are not shared between independent executions.
- A blocked or unresolvable destination must be documented as a technical problem, not as an invented failure of the system under test.

## Checklist

- [ ] The case has `API` format and a valid configuration.
- [ ] The destination is permitted by the environment.
- [ ] Credentials come from protected configuration.
- [ ] Assertions express understandable expected results.
- [ ] You chose Automation Worker or external API according to the real flow.
- [ ] You reviewed the snapshot and evidence before creating a bug.
- [ ] External retries use a stable identifier.
- [ ] The payload uses `steps` only for `CLASICA`, `api` only for `API` and `chatbot` only for `CONVERSACIONAL`.

Also see [Test types and execution modes](TEST_TYPES_AND_EXECUTION.md), [Automation Worker](AUTOMATION_WORKER_V1.md) and [Bug Tracker](BUG_TRACKER.md).

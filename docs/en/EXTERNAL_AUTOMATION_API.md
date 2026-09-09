# External API for reporting automated executions

<!-- Language: en -->

This document defines the Premium contract for external runners such as Playwright, Selenium, Cypress, Pytest or CI/CD pipelines to report results to the system. Confirm that the license includes the external API before integrating it.

The goal is to cover the flow equivalent to `reportTCResult` in TestLink,
adapted to Treseko 1.0.3's hierarchy and available formats:

```mermaid
flowchart LR
  S[Solution] --> P[Project]
  P --> C[Component]
  C --> B[Build]
  B --> TC[Case]
  TC --> CL[CLASSIC: steps]
  TC --> API[API: requests and assertions]
  TC --> CHAT[CONVERSATIONAL: turns and evaluation]
```

## What this integration does

- Uses short and stable identifiers for solution, project, component, build and case.
- Allows reporting one or more cases assigned to an active build.
- Accepts overall results and, when applicable, per-step results.
- Keeps the external result alongside Treseko's execution history.

## Short codes

Each entity must have a short external code.

Valid examples:

```text
Solution:   SOL-a8f31c22
Project:    PRJ-b91e02aa
Component:  CMP-77ac10ff
Build:      BLD-3f91ad44
Case:       TC-0005
```

Use these criteria when configuring the runner:

- `SOL-xxxxxxxx`, `PRJ-xxxxxxxx`, `CMP-xxxxxxxx`, `BLD-xxxxxxxx`.
- The suffix must be generated randomly or with a compact, non-semantic identifier.
- Do not use names such as `BLD-1-5-0-RC`, because the visible name may change.
- Codes must be unique within their natural scope.

Suggested scope:

| Entity | Field | Uniqueness |
|---|---|---|
| Solution / organization | `codigo` | Global |
| Project | `codigo` | Within the solution |
| Component | `codigo` | Within the project |
| Build | `codigo` | Within the component |
| Case | `codigo` | Within the project or component, according to the final system rule |

## External automation API key

The API key is generated and managed from the Treseko interface, not through API endpoints:

1. Log in with the user who will use the runner.
2. Open **Settings → Preferences → External automation API keys**.
3. Create an identifiable key for the pipeline or runner.
4. Copy it when you create it and store it as a CI secret.

The key inherits that user's permissions. To report executions, the user must have execution permission and edit access to the project and build. Revoke the key from the same section if it stops being used or is exposed.

Recommended format:

```http
Authorization: Bearer treseko_xxxxxxxxxxxxxxxxx
```

Also accepted:

```http
X-QA-API-Key: treseko_xxxxxxxxxxxxxxxxx
```

The API key:

- must belong to an active user;
- must be active;
- inherits the user's permissions;
- validates execution permission;
- records its last use;
- is stored hashed in the database;
- does not replace or require an API login.

The current model does not define an automatic expiration date for these keys. Revoke a key manually when it is no longer used or is exposed.

## Main endpoint

```http
POST /external/executions/report
Authorization: Bearer treseko_xxxxxxxxxxxxxxxxx
Content-Type: application/json
```

This endpoint allows reporting one or more cases in a single call.

## Payload

```json
{
  "solution_code": "SOL-a8f31c22",
  "project_code": "PRJ-b91e02aa",
  "component_code": "CMP-77ac10ff",
  "build_code": "BLD-3f91ad44",
  "external_run_id": "pytest-2026-06-20-001",
  "environment": "qa",
  "overwrite": true,
  "cases": [
    {
      "case_code": "TC-0005",
      "status": "FALLO",
      "observations": "El botón de login no estuvo visible.",
      "duration_seconds": 18,
      "evidence_url": "https://ci.example.com/artifacts/login-fail.png",
      "external_case_run_id": "pytest::test_login_invalid",
      "steps": [
        {
          "number": 1,
          "status": "PASO",
          "observations": "Se abrio la pagina de login."
        },
        {
          "number": 2,
          "status": "FALLO",
          "observations": "El botón de login no estuvo visible.",
          "evidence_url": "https://ci.example.com/artifacts/step-2.png"
        }
      ]
    },
    {
      "case_code": "TC-0008",
      "status": "PASO",
      "observations": "Flujo completado correctamente.",
      "duration_seconds": 9
    }
  ]
}
```

## Request fields

| Field | Required | Description |
|---|---:|---|
| `solution_code` | Yes | Short code of the solution/organization. |
| `project_code` | Yes | Short code of the project. |
| `component_code` | Yes | Short code of the component. |
| `build_code` | Yes | Opaque short code of the build. |
| `external_run_id` | Recommended | External run ID. Used to deduplicate CI retries. |
| `environment` | No | Environment reported by the external runner. E.g.: `qa`, `uat`, `staging`. |
| `overwrite` | No | If `true`, allows updating the result of the same case within the same `external_run_id`. |
| `cases` | Yes | List of cases to report. |

Request limits: `cases` accepts between 1 and 500 items; solution, project, component, build and case codes accept up to 80 characters; `external_run_id` accepts up to 120 and `environment` up to 80. `overwrite` is a strict boolean and defaults to `true`.

## Fields per case

| Field | Required | Description |
|---|---:|---|
| `case_code` | Yes | Short case code. E.g.: `TC-0005`. |
| `status` | Yes | Final case result. Values: `PASO`, `FALLO`, `BLOQUEADO`. |
| `observations` | No | General execution observation. |
| `duration_seconds` | No | Total case duration. |
| `evidence_url` | No | General evidence URL. |
| `external_case_run_id` | No | Test ID in the external framework. |
| `steps` | No | Optional list of executed steps. |

`observations` accepts up to 4000 characters, `duration_seconds` ranges from 0 to 604800, `evidence_url` accepts up to 1000 and `external_case_run_id` up to 120. A case can include at most 250 steps.

## Fields per step

| Field | Required | Description |
|---|---:|---|
| `number` | Yes | Step number in the case. |
| `status` | Yes | Step result: `PASO`, `FALLO`, `BLOQUEADO`, `SIN_CORRER`. |
| `observations` | No | Step observation. |
| `evidence_url` | No | Specific step evidence. |
| `error_log` | No | Technical error log. |

`number` must be between 1 and 1000. Observations accept up to 4000 characters, the URL up to 1000 and `error_log` up to 12000.

## API and conversational evidence

The shape of `cases[].api` or `cases[].chatbot` must match the saved case's `formato_prueba`. Both fields cannot be sent in the same case.

For an `API` case, send `api` as a JSON object containing observed evidence. Canonical evidence produced by Treseko is accepted, for example:

```json
{
  "schema_version": "treseko.api-result/v1",
  "status": "PASSED",
  "duration_ms": 184,
  "steps": [
    {
      "index": 1,
      "status": "PASSED",
      "request": {"method": "GET", "url": "https://api.example.test/health"},
      "response": {"status_code": 200},
      "assertions": [
        {"status": "PASSED", "source": "response.status", "expected": 200, "actual": 200}
      ]
    }
  ],
  "variables_extracted": [],
  "variables_used": {},
  "errors": [],
  "evidence_policy": {"public_test_data": false}
}
```

Treseko does not use external evidence to replace the case's expected configuration. The serialized `api` JSON object may be at most 512 KiB; sensitive values are sanitized before persistence.

For a `CONVERSACIONAL` case, send `chatbot` with at least one turn:

```json
{
  "schema_version": 1,
  "protocol": "treseko.chatbot/v1",
  "conversation_strategy": "external_api",
  "session_id": "session-ci-001",
  "turns": [
    {
      "status": "PASSED",
      "request": {"body": {"message": "Hola"}},
      "response": {"text": "Hola, ¿en qué puedo ayudarte?"},
      "latencyMs": 184,
      "assertions": [{"passed": true, "rule": "must_include", "expected": "Hola"}]
    }
  ],
  "performance": {"total_latency_ms": 184},
  "conversation": [],
  "assertions": [],
  "security_findings": [],
  "memory_checks": [],
  "tools": [],
  "http_errors": [],
  "metadata": {},
  "profile": {},
  "variables": {},
  "human_evaluation": {},
  "judge": {}
}
```

Each turn must have `status` `PASSED`, `FAILED` or `BLOCKED`. `turns` accepts between 1 and 250 turns; if `technical_index` is provided, it must be zero-based, integer and consecutive. Each turn accepts up to 256 KiB and the complete `chatbot` object up to 512 KiB. The `conversation` and `assertions` lists accept 500 items; `security_findings` 100; `memory_checks`, `tools` and `http_errors` 250. `protocol` and `conversation_strategy` accept 80 characters, `session_id` 255, `status` 30 and `error_code` 120.

The final case status must be consistent with the evidence: a `PASO` case may contain only successful steps or turns; a `FALLO` case must contain at least one failure; and a `BLOQUEADO` case must contain at least one block. Do not use classic `steps` in a conversational case.

## Successful response

```json
{
  "run_id": "3d1c0d79-73af-4c8b-a3d9-5e8b7b0f2c10",
  "external_run_id": "pytest-2026-06-20-001",
  "solution_code": "SOL-a8f31c22",
  "project_code": "PRJ-b91e02aa",
  "component_code": "CMP-77ac10ff",
  "build_code": "BLD-3f91ad44",
  "processed": 2,
  "rejected": 0,
  "results": [
    {
      "case_code": "TC-0005",
      "status": "saved",
      "execution_id": "7d20f8bc-6fb4-40f7-8a36-8e8f56755829",
      "final_status": "FALLO"
    },
    {
      "case_code": "TC-0008",
      "status": "saved",
      "execution_id": "aa78e56d-0c71-4c4f-a2fa-f087d89d26b5",
      "final_status": "PASO"
    }
  ]
}
```

## Atomic processing and errors

The endpoint validates the complete request before saving. It does not process part of the batch: if a case is missing, is not assigned to the build, the build is inactive, evidence is incompatible with the format or a duplicate exists with `overwrite=false`, the entire request is rejected and none of its cases are saved.

An HTTP 200 response contains only `saved` results, with `rejected: 0`. Authentication, permission, validation or business-rule errors are returned as an HTTP error (for example, 400, 401 or 403) with a `correlation_id`; in those cases do not use `processed` as partial confirmation.

## What Treseko validates

Before saving a report, Treseko validates:

1. A valid and active API key.
2. An active user.
3. A user with permission to execute tests.
4. That `solution_code` exists.
5. That `project_code` belongs to the solution.
6. That `component_code` belongs to the project.
7. That `build_code` belongs to the component.
8. That the build is active if the policy requires reporting only on active builds.
9. That each `case_code` exists.
10. That each case belongs to the indicated project/component.
11. That each case is assigned to the build.
12. That the sent states are valid.
13. If steps are sent, that their numbers exist or that an overall result can be recorded when no steps are defined.

## `external_run_id` semantics

`external_run_id` allows retries to be deduplicated.

Recommendation:

- If it does not exist, create a `TestRun` with source `EXTERNAL_API`.
- If it exists for the same build, reuse it.
- If the same case arrives with `overwrite=true`, update that case's previous execution within the same run.
- If the same case arrives with `overwrite=false`, reject the entire request as a duplicate; do not save part of the batch.

## States

| External state | Internal state |
|---|---|
| `PASO` | `PASO` |
| `FALLO` | `FALLO` |
| `BLOQUEADO` | `BLOQUEADO` |
| `SIN_CORRER` | `SIN_CORRER`, valid only as a step state. |

It is not recommended to accept abbreviations such as `p`, `f`, `b` in the main contract. If TestLink-style compatibility is desired, an optional normalization mode could be added.

## Python example

```python
import os
import requests

BASE_URL = os.getenv("TRESEKO_API_URL", "http://localhost:9095/api")
API_KEY = os.getenv("TRESEKO_EXTERNAL_API_KEY", "treseko_xxxxxxxxxxxxxxxxx")

payload = {
    "solution_code": "SOL-a8f31c22",
    "project_code": "PRJ-b91e02aa",
    "component_code": "CMP-77ac10ff",
    "build_code": "BLD-3f91ad44",
    "external_run_id": "pytest-2026-06-20-001",
    "environment": "qa",
    "overwrite": True,
    "cases": [
        {
            "case_code": "TC-0005",
            "status": "FALLO",
            "observations": "El botón de login no estuvo visible.",
            "duration_seconds": 18,
            "evidence_url": "https://ci.example.com/artifacts/login-fail.png",
            "steps": [
                {
                    "number": 1,
                    "status": "PASO",
                    "observations": "Se abrio la pagina de login."
                },
                {
                    "number": 2,
                    "status": "FALLO",
                    "observations": "El botón no estuvo visible."
                }
            ]
        }
    ]
}

response = requests.post(
    f"{BASE_URL}/external/executions/report",
    headers={
        "Authorization": f"Bearer {API_KEY}",
        "Content-Type": "application/json",
    },
    json=payload,
    timeout=30,
)

response.raise_for_status()
data = response.json()

print("Resultado reportado")
print("Run:", data.get("run_id"))
print("Procesados:", data.get("processed"))
print("Rechazados:", data.get("rejected"))
```

## Minimal example for a single case

```json
{
  "solution_code": "SOL-a8f31c22",
  "project_code": "PRJ-b91e02aa",
  "component_code": "CMP-77ac10ff",
  "build_code": "BLD-3f91ad44",
  "external_run_id": "playwright-main-20260620-001",
  "cases": [
    {
      "case_code": "TC-0008",
      "status": "PASO",
      "observations": "Prueba ejecutada desde Playwright."
    }
  ]
}
```

## Checklist before activating the runner

1. Generate the API key from **Settings → Preferences → External automation API keys**.
2. Confirm that the key's user has execution permission and access to the project and build.
3. Test the minimal example with a non-critical test case.
4. Configure a stable `external_run_id` so retries are safe.
5. Store the API key only in the CI secret store.
